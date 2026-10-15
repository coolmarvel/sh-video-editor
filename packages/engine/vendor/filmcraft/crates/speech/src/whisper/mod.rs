//! Whisper speech recognition in pure Rust (candle, CPU).
//!
//! Transcription follows the procedure described with the model (sequential 30-second windows):
//!
//! 1. The whole clip's log-mel spectrogram is computed once ([`crate::mel`]), padded with 30 s of
//!    silence. A window of 3000 frames starting at `seek` is encoded.
//! 2. **Language**: unless given, the first window's decoder logits after `<|startoftranscript|>`
//!    are compared over the language tokens and the most likely language is used.
//! 3. **Decoding** is greedy with timestamp tokens: the first token must be a timestamp (≤ 1 s),
//!    timestamps come in pairs and never go backwards, timestamps win whenever their summed
//!    probability beats the best text token, and special tokens are suppressed. Windows whose
//!    `<|nospeech|>` probability exceeds 0.6 while the text is improbable are skipped. A loop
//!    guard stops a window that keeps repeating itself.
//! 4. `seek` advances to the last complete timestamp pair (or the whole window). When the window
//!    ends on a single timestamp (the model closed its last segment and stopped) with at least 3 s
//!    of the window left and at least 1 s of that voiced ([`crate::vad`]), `seek` resumes at that
//!    timestamp instead: the model stopped early, and jumping the whole window would drop the
//!    speech after it (sh-video-editor change; the reference procedure always jumps). Endings in
//!    the last 3 s still jump: the audio there is the tail of the last word, and decoding it again
//!    repeats or invents words.
//! 5. **Word timestamps**: the window's text tokens are run once more through the decoder
//!    (`<|notimestamps|>` prompt) and the cross-attention logits of the model's alignment heads
//!    (`generation_config.json`; default: every head of the second half of the decoder) are
//!    softmaxed over the window's audio frames, standardised per token, median-filtered (width 7)
//!    and averaged; dynamic time warping through the negated matrix gives each token's start frame
//!    (20 ms resolution). Tokens are grouped into words at spaces, punctuation joins its word.
//!
//! 6. Word bounds are tightened past silent frames ([`crate::vad`]), so pauses stay pauses.
//!
//! Optional speaker labelling runs afterwards ([`crate::diarize`]).

mod align;
mod model;
pub mod tokenizer;

use std::path::Path;
use std::sync::Mutex;

use candle_core::Tensor;
use filmcraft_project::{Transcript, Word};

use crate::{Options, ProgressFn, SpeechError, Transcriber, sample_tick};
use model::{Config, Model};
use tokenizer::Tokenizer;

/// Mel frames per window (30 s).
const N_FRAMES: usize = 3000;
/// Mel frames per timestamp step (0.02 s).
const FRAMES_PER_TS: usize = 2;
const SAMPLES_PER_FRAME: usize = crate::mel::HOP;
const MAX_TOKENS: usize = 224;
/// A single-timestamp ending resumes there only if the timestamp is at least this far in (mel
/// frames, 1 s), so a window that stops at once still moves on,
const MIN_RESUME_FRAMES: usize = 100;
/// at least this much of the window is left after it (3 s),
const MIN_TAIL_FRAMES: usize = 300;
/// and that rest holds at least this much voiced audio (10 ms frames, 1 s).
const MIN_VOICED_FRAMES: usize = 100;

fn merr(e: candle_core::Error) -> SpeechError {
    SpeechError::Model(e.to_string())
}

pub struct Whisper {
    id: String,
    model: Mutex<Model>,
    tok: Tokenizer,
    alignment_heads: Vec<(usize, usize)>,
    suppress: Vec<u32>,
    begin_suppress: Vec<u32>,
}

impl Whisper {
    /// Load a model directory (`config.json`, `generation_config.json`, `tokenizer.json`,
    /// `model.safetensors`).
    pub fn load(dir: &Path, id: &str) -> Result<Self, SpeechError> {
        let read = |n: &str| std::fs::read(dir.join(n)).map_err(|e| SpeechError::Model(format!("{}: {e}", dir.join(n).display())));
        Self::from_bytes(&read("config.json")?, &read("generation_config.json")?, &read("tokenizer.json")?, read("model.safetensors")?, id)
    }

    /// Load a model from the bytes of its four files (hosts without a file system: the web keeps
    /// them in OPFS and hands them over).
    pub fn from_bytes(config: &[u8], generation_config: &[u8], tokenizer: &[u8], weights: Vec<u8>, id: &str) -> Result<Self, SpeechError> {
        let cfg: Config = serde_json::from_slice(config).map_err(|e| SpeechError::Model(format!("config.json: {e}")))?;
        let gen_cfg: serde_json::Value = serde_json::from_slice(generation_config).unwrap_or_default();
        let tok = Tokenizer::from_json(&String::from_utf8_lossy(tokenizer))?;
        let alignment_heads = gen_cfg["alignment_heads"]
            .as_array()
            .map(|a| a.iter().filter_map(|p| Some((p[0].as_u64()? as usize, p[1].as_u64()? as usize))).collect::<Vec<_>>())
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| (cfg.decoder_layers / 2..cfg.decoder_layers).flat_map(|l| (0..cfg.decoder_attention_heads).map(move |h| (l, h))).collect());
        let mut suppress: Vec<u32> =
            gen_cfg["suppress_tokens"].as_array().map(|a| a.iter().filter_map(|x| x.as_u64().map(|v| v as u32)).collect()).unwrap_or_default();
        suppress.extend(tok.non_text_specials());
        suppress.sort_unstable();
        suppress.dedup();
        let begin_suppress = gen_cfg["begin_suppress_tokens"]
            .as_array()
            .map(|a| a.iter().filter_map(|x| x.as_u64().map(|v| v as u32)).collect())
            .unwrap_or_else(|| vec![220, tok.eot]);
        let model = Model::load(cfg, weights).map_err(merr)?;
        Ok(Self { id: id.to_string(), model: Mutex::new(model), tok, alignment_heads, suppress, begin_suppress })
    }

    pub fn languages(&self) -> Vec<String> {
        self.tok.languages.iter().map(|l| l.0.clone()).collect()
    }

    fn window(mel: &[f32], n_mels: usize, frames: usize, seek: usize) -> Vec<f32> {
        let mut w = vec![0f32; n_mels * N_FRAMES];
        for m in 0..n_mels {
            let end = (seek + N_FRAMES).min(frames);
            if seek < end {
                w[m * N_FRAMES..m * N_FRAMES + end - seek].copy_from_slice(&mel[m * frames + seek..m * frames + end]);
            }
        }
        w
    }

    fn detect_language(&self, m: &mut Model, xa: &Tensor) -> Result<String, SpeechError> {
        m.decoder.reset();
        let (logits, _) = m.decoder.forward(&[self.tok.sot], xa, false, None).map_err(merr)?;
        let l = Model::last_logits(&logits).map_err(merr)?;
        let best = self.tok.languages.iter().max_by(|a, b| l[a.1 as usize].total_cmp(&l[b.1 as usize])).map(|x| x.0.clone());
        Ok(best.unwrap_or_else(|| "en".into()))
    }

    /// Apply the timestamp rules and suppression to `logits` for the next token after `seq`
    /// (sampled tokens of this window, prompt excluded).
    fn constrain(&self, logits: &mut [f32], seq: &[u32], max_ts: Option<u32>) {
        let tb = self.tok.timestamp_begin as usize;
        let ninf = f32::NEG_INFINITY;
        for &s in &self.suppress {
            if let Some(v) = logits.get_mut(s as usize) {
                *v = ninf;
            }
        }
        if seq.is_empty() {
            for &s in &self.begin_suppress {
                if let Some(v) = logits.get_mut(s as usize) {
                    *v = ninf;
                }
            }
        }
        let last_ts = seq.last().is_some_and(|&t| self.tok.is_timestamp(t));
        let penult_ts = seq.len() < 2 || self.tok.is_timestamp(seq[seq.len() - 2]);
        if last_ts {
            if penult_ts {
                logits[tb..].iter_mut().for_each(|v| *v = ninf);
            } else {
                logits[..self.tok.eot as usize].iter_mut().for_each(|v| *v = ninf);
            }
        }
        if let Some(&last) = seq.iter().rev().find(|&&t| self.tok.is_timestamp(t)) {
            let lim = (if last_ts && !penult_ts { last } else { last + 1 } as usize).min(logits.len());
            logits[tb..lim].iter_mut().for_each(|v| *v = ninf);
        }
        if seq.is_empty() {
            logits[..tb].iter_mut().for_each(|v| *v = ninf);
            if let Some(m) = max_ts {
                let cut = (tb + m as usize + 1).min(logits.len());
                logits[cut..].iter_mut().for_each(|v| *v = ninf);
            }
        }
        // timestamps win when their total probability beats every text token
        let max = logits.iter().copied().fold(ninf, f32::max);
        if max.is_finite() {
            let lse = |s: &[f32]| -> f32 {
                let m = s.iter().copied().fold(ninf, f32::max);
                if !m.is_finite() {
                    return ninf;
                }
                m + s.iter().map(|v| (v - m).exp()).sum::<f32>().ln()
            };
            let ts = lse(&logits[tb..]);
            let best_text = logits[..tb].iter().copied().fold(ninf, f32::max);
            if ts > best_text {
                logits[..tb].iter_mut().for_each(|v| *v = ninf);
            }
        }
    }

    /// Greedy decode of one window. Returns sampled tokens (no prompt, no end-of-text), the mean
    /// log-probability and the no-speech probability.
    fn decode_window(&self, m: &mut Model, xa: &Tensor, prompt: &[u32]) -> Result<(Vec<u32>, f32, f32), SpeechError> {
        m.decoder.reset();
        let mut seq: Vec<u32> = Vec::new();
        let (logits, _) = m.decoder.forward(prompt, xa, true, None).map_err(merr)?;
        // no-speech probability from the start-of-transcript position
        let first = logits.get(0).and_then(|l| l.get(0)).and_then(|l| l.to_vec1::<f32>()).map_err(merr)?;
        let no_speech = self.tok.no_speech.map(|ns| softmax_at(&first, ns as usize)).unwrap_or(0.0);
        let mut cur = Model::last_logits(&logits).map_err(merr)?;
        let mut sum_lp = 0f32;
        for _ in 0..MAX_TOKENS.min(m.cfg.max_target_positions / 2) {
            let lp = log_softmax(&cur);
            self.constrain(&mut cur, &seq, Some(50));
            let next = argmax(&cur);
            sum_lp += lp[next as usize];
            if next == self.tok.eot {
                break;
            }
            seq.push(next);
            if repeating(&seq, self.tok.timestamp_begin) {
                break;
            }
            let (logits, _) = m.decoder.forward(&[next], xa, true, None).map_err(merr)?;
            cur = Model::last_logits(&logits).map_err(merr)?;
        }
        let avg = sum_lp / (seq.len() + 1) as f32;
        Ok((seq, avg, no_speech))
    }
}

fn softmax_at(x: &[f32], i: usize) -> f32 {
    let m = x.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    let s: f32 = x.iter().map(|v| (v - m).exp()).sum();
    x.get(i).map(|v| (v - m).exp() / s).unwrap_or(0.0)
}

fn log_softmax(x: &[f32]) -> Vec<f32> {
    let m = x.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    let lse = m + x.iter().map(|v| (v - m).exp()).sum::<f32>().ln();
    x.iter().map(|v| v - lse).collect()
}

fn argmax(x: &[f32]) -> u32 {
    let mut best = 0;
    for (i, v) in x.iter().enumerate() {
        if *v > x[best] {
            best = i;
        }
    }
    best as u32
}

/// The tail of `seq` (text tokens) repeats a short pattern many times: a decoding loop.
fn repeating(seq: &[u32], tb: u32) -> bool {
    let text: Vec<u32> = seq.iter().copied().filter(|&t| t < tb).collect();
    for n in 1..=8 {
        let reps = if n == 1 { 12 } else { 5 };
        if text.len() < n * reps {
            continue;
        }
        let tail = &text[text.len() - n * reps..];
        if (1..reps).all(|r| tail[r * n..(r + 1) * n] == tail[..n]) {
            return true;
        }
    }
    false
}

/// Where the next window starts and how much of this window's text it covers.
#[derive(Debug, PartialEq, Eq)]
struct Advance {
    /// Mel frames to move `seek` by (at least 1, at most the window).
    frames: usize,
    /// Tokens of the window whose text is kept (the rest is decoded again from the next window).
    text_upto: usize,
    /// Resumed at a single-timestamp ending because voiced audio follows it.
    resumed: bool,
}

/// Plan the next window from this window's tokens: `ts_frames[i]` is the mel frame of token `i`
/// when it is a timestamp. A complete pair ends the window at its start; a single-timestamp ending
/// covers the whole window unless `voiced_after(frame)` (voiced 10 ms frames from `frame` to the
/// window's end) shows speech the model never got to, then the window ends at that timestamp.
fn plan_advance(ts_frames: &[Option<usize>], seg_frames: usize, voiced_after: impl Fn(usize) -> usize) -> Advance {
    let n = ts_frames.len();
    let is_ts = |i: usize| ts_frames[i].is_some();
    let single_ending = n >= 2 && !is_ts(n - 2) && is_ts(n - 1);
    let last_pair = (1..n).rev().find(|&i| is_ts(i) && is_ts(i - 1));
    if let Some(i) = last_pair
        && !single_ending
    {
        let frames = ts_frames[i - 1].unwrap_or(seg_frames).clamp(1, seg_frames);
        return Advance { frames, text_upto: i, resumed: false };
    }
    if single_ending
        && let Some(end) = ts_frames[n - 1]
        && end >= MIN_RESUME_FRAMES
        && end + MIN_TAIL_FRAMES <= seg_frames
        && voiced_after(end) >= MIN_VOICED_FRAMES
    {
        return Advance { frames: end, text_upto: n, resumed: true };
    }
    Advance { frames: seg_frames, text_upto: n, resumed: false }
}

impl Transcriber for Whisper {
    fn id(&self) -> String {
        self.id.clone()
    }

    fn transcribe(&self, audio: &[f32], opts: &Options, progress: ProgressFn) -> Result<Transcript, SpeechError> {
        let mut m = self.model.lock().unwrap_or_else(|e| e.into_inner());
        let n_mels = m.cfg.num_mel_bins;
        let content_frames = audio.len() / SAMPLES_PER_FRAME;
        let mut padded = audio.to_vec();
        padded.extend(std::iter::repeat_n(0.0, N_FRAMES * SAMPLES_PER_FRAME));
        if !progress(0.0, "Analysing audio") {
            return Err(SpeechError::Cancelled);
        }
        let trace = std::env::var_os("FILMCRAFT_SPEECH_TRACE").is_some();
        let clock = web_time::Instant::now();
        let (frames, mel) = crate::mel::log_mel(&padded, n_mels);
        if trace {
            eprintln!("mel {:.3}s", clock.elapsed().as_secs_f64());
        }
        let mut language = opts.language.clone().filter(|l| !l.is_empty() && l != "auto");
        if language.as_deref().is_some_and(|l| self.tok.multilingual() && self.tok.language_token(l).is_none()) {
            return Err(SpeechError::Model(format!("the model does not know the language `{}`", language.unwrap_or_default())));
        }
        // voiced 10 ms frames (one per mel frame), for resuming after an early single-timestamp ending
        let db = crate::vad::frame_db(audio);
        let th = crate::vad::threshold(&db);
        let voiced: Vec<bool> = db.iter().map(|&v| v >= th).collect();
        let mut words: Vec<Word> = Vec::new();
        let mut seek = 0usize;
        while seek < content_frames {
            let frac = seek as f32 / content_frames.max(1) as f32;
            if !progress(frac * 0.95, &format!("Transcribing {:.0}%", frac * 100.0)) {
                return Err(SpeechError::Cancelled);
            }
            let seg_frames = N_FRAMES.min(content_frames - seek);
            let win = Self::window(&mel, n_mels, frames, seek);
            let x = Tensor::from_vec(win, (1, n_mels, N_FRAMES), &m.device).map_err(merr)?;
            let xa = m.encoder.forward(&x).map_err(merr)?;
            if trace {
                eprintln!("encode {:.3}s", clock.elapsed().as_secs_f64());
            }
            let mut prompt = vec![self.tok.sot];
            if self.tok.multilingual() {
                if language.is_none() {
                    language = Some(self.detect_language(&mut m, &xa)?);
                }
                let lang = language.as_deref().unwrap_or("en");
                prompt.push(self.tok.language_token(lang).unwrap_or(self.tok.sot + 1));
                prompt.push(self.tok.transcribe);
            }
            let (toks, avg_lp, no_speech) = self.decode_window(&mut m, &xa, &prompt)?;
            if trace {
                eprintln!("decode {} tokens {:.3}s", toks.len(), clock.elapsed().as_secs_f64());
            }
            let skip = no_speech > 0.6 && avg_lp < -1.0;
            if trace {
                eprintln!(
                    "window seek {:.2}s frames {seg_frames} no_speech {no_speech:.3} avg_lp {avg_lp:.3} skip {skip} tokens {}",
                    seek as f64 * 0.01,
                    toks.len()
                );
            }
            // where the next window starts
            let ts_frames: Vec<Option<usize>> =
                toks.iter().map(|&t| self.tok.is_timestamp(t).then(|| (t - self.tok.timestamp_begin) as usize * FRAMES_PER_TS)).collect();
            let voiced_after = |from: usize| voiced.get(seek + from..seek + seg_frames).map_or(0, |v| v.iter().filter(|&&x| x).count());
            let step = plan_advance(&ts_frames, seg_frames, voiced_after);
            let advance = step.frames;
            if trace {
                let ts: Vec<String> = ts_frames.iter().flatten().map(|f| format!("{:.2}", *f as f64 * 0.01)).collect();
                eprintln!("  timestamps [{}] advance {:.2}s resumed {}", ts.join(" "), advance as f64 * 0.01, step.resumed);
            }
            let text: Vec<u32> = toks.iter().copied().filter(|&t| t < self.tok.eot).collect();
            if !skip && !text.is_empty() {
                // the text up to the last complete segment (what `advance` covers)
                let upto = step.text_upto;
                let text: Vec<u32> = toks[..upto].iter().copied().filter(|&t| t < self.tok.eot).collect();
                let mut aprompt = prompt.clone();
                aprompt.push(self.tok.no_timestamps);
                let times = align::align(&mut m, &xa, &aprompt, &text, self.tok.eot, &self.alignment_heads, seg_frames).map_err(merr)?;
                let offset = seek * SAMPLES_PER_FRAME;
                let limit = (seek + advance) * SAMPLES_PER_FRAME;
                for (wtext, r) in tokenizer::group_words(&self.tok, &text) {
                    let (s, e) = (times[r.start].0, times[r.end - 1].1);
                    let a = (offset + s * SAMPLES_PER_FRAME).min(limit);
                    let b = (offset + e * SAMPLES_PER_FRAME).min(limit).max(a);
                    words.push(Word::new(wtext, sample_tick(a as i64), sample_tick(b as i64)));
                }
            }
            if trace {
                eprintln!("align {:.3}s", clock.elapsed().as_secs_f64());
            }
            seek += advance;
        }
        let mut t = Transcript { language: language.unwrap_or_else(|| "en".into()), source: self.id.clone(), speakers: Vec::new(), words };
        t.normalize();
        crate::vad::tighten_words(audio, &mut t.words);
        if opts.diarize && !t.words.is_empty() {
            if !progress(0.96, "Labelling speakers") {
                return Err(SpeechError::Cancelled);
            }
            let p = crate::diarize::Params { max_speakers: opts.max_speakers, ..Default::default() };
            crate::diarize::diarize(audio, &mut t, &p);
        }
        progress(1.0, "Done");
        Ok(t)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const T: Option<usize> = None;

    #[test]
    fn a_complete_pair_ends_the_window_at_its_start() {
        // <0> a b <500><520> c <900><950> d <1200>(single ending is not this case: pair is last)
        let toks = [Some(0), T, T, Some(500), Some(520), T, Some(900), Some(950)];
        let a = plan_advance(&toks, 3000, |_| 3000);
        assert_eq!(a, Advance { frames: 900, text_upto: 7, resumed: false });
    }

    #[test]
    fn a_single_timestamp_ending_with_speech_after_it_resumes_there() {
        // the p9 case: <0.00> sentence <13.40> end-of-text, speech continues to 30 s
        let toks = [Some(0), T, T, T, Some(1340)];
        let a = plan_advance(&toks, 3000, |from| if from == 1340 { 1200 } else { 0 });
        assert_eq!(a, Advance { frames: 1340, text_upto: 5, resumed: true });
        // with a pair before it the rule is the same
        let toks = [Some(0), T, Some(1000), Some(1700), T, Some(2000)];
        assert_eq!(plan_advance(&toks, 3000, |_| 150).frames, 2000);
    }

    #[test]
    fn a_single_timestamp_ending_followed_by_silence_jumps_the_window() {
        let toks = [Some(0), T, T, Some(1340)];
        assert_eq!(plan_advance(&toks, 3000, |_| 10), Advance { frames: 3000, text_upto: 4, resumed: false });
        // too little voiced audio after it
        let toks = [Some(0), T, T, Some(1340)];
        assert_eq!(plan_advance(&toks, 3000, |_| 99).frames, 3000);
        // an ending in the last 3 s: the tail of the last word, decoding it again repeats words
        let toks = [Some(0), T, Some(1000), Some(1700), T, Some(2900)];
        assert_eq!(plan_advance(&toks, 3000, |_| 100).frames, 3000);
        // an ending right at the start never stalls the loop
        let toks = [Some(0), T, Some(20)];
        assert_eq!(plan_advance(&toks, 3000, |_| 3000).frames, 3000);
        // a short last window
        let toks = [Some(0), T, Some(400)];
        assert_eq!(plan_advance(&toks, 400, |_| 400).frames, 400);
        // decoding cut off without a final timestamp
        let toks = [Some(0), T, T];
        assert_eq!(plan_advance(&toks, 3000, |_| 3000).frames, 3000);
        assert_eq!(plan_advance(&[], 3000, |_| 3000).frames, 3000);
    }

    /// Real model: a two-sentence clip where whisper-small used to stop after the first sentence
    /// (a single-timestamp ending at 13.4 s) and jump the whole window, dropping the second one.
    /// `FILMCRAFT_TEST_WHISPER=<model dir> FILMCRAFT_TEST_SPEECH=<16 kHz mono f32le> cargo test -p
    /// filmcraft-speech --features whisper --release -- --ignored early_ending`; the speech must
    /// run to the end of the clip (the last word must end in its last fifth).
    #[test]
    #[ignore = "needs a downloaded Whisper model and a speech file (env vars)"]
    fn early_ending_does_not_drop_the_rest_of_the_window() {
        let (Some(dir), Some(audio)) = (std::env::var_os("FILMCRAFT_TEST_WHISPER"), std::env::var_os("FILMCRAFT_TEST_SPEECH")) else {
            eprintln!("SKIPPED: set FILMCRAFT_TEST_WHISPER and FILMCRAFT_TEST_SPEECH");
            return;
        };
        let dir = std::path::PathBuf::from(dir);
        let id = dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let w = Whisper::load(&dir, &id).expect("model");
        let bytes = std::fs::read(audio).expect("speech file");
        let audio: Vec<f32> = bytes.as_chunks::<4>().0.iter().map(|b| f32::from_le_bytes(*b)).collect();
        let t = w.transcribe(&audio, &Options::default(), &mut |_, _| true).expect("transcribe");
        let end = t.words.last().map(|x| x.end).unwrap_or_default();
        let total = sample_tick(audio.len() as i64);
        assert!(end.0 * 5 >= total.0 * 4, "transcript stops at {end:?} of {total:?}: {}", t.text());
    }

    #[test]
    fn repetition_guard() {
        let tb = 1000;
        assert!(repeating(&[5; 12], tb));
        assert!(!repeating(&[5, 5, 5, 6, 7, 8], tb));
        let mut s = Vec::new();
        for _ in 0..5 {
            s.extend([1, 2, 3]);
        }
        assert!(repeating(&s, tb));
        assert!(!repeating(&[1, 2, 3, 4, 5, 6, 7], tb));
    }
}
