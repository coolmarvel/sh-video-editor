//! Pitch-preserving time stretch by WSOLA (waveform-similarity overlap-add).
//!
//! Ported from soundcraft `dsp::offline::time_stretch` (storytold/soundcraft 0.1.0, MIT OR
//! Apache-2.0; see `packages/engine/VENDOR.md`). soundcraft works on whole buffers indexed by
//! sample; FilmCraft renders a timeline in arbitrary blocks addressed by ticks. This module keeps
//! the upstream whole-buffer function ([`time_stretch`]) and adds [`Stretcher`], the same algorithm
//! on a fixed segment grid anchored at a clip's start, so a renderer can ask for any window of the
//! stretched output and get the same samples whatever the request boundaries. Positions are sample
//! indices at the sequence rate; the caller converts ticks with `Tick::to_units_floor(rate)`.
//!
//! How it works: the output is built from 40 ms Hann-windowed segments of the input, overlapped by
//! half. Segment `k` goes to output position `k * hop` and is taken from input position
//! `k * hop * speed`, give or take up to 10 ms: the start is chosen where the input best continues
//! the previous segment (normalised cross-correlation against the natural continuation
//! `prev + hop`), so the waveform stays coherent and the pitch stays where it was. All channels share
//! one choice (made on their average), so a stereo image stays intact.
//!
//! The chain of choices normally runs from the clip start. To keep block rendering affordable the
//! [`Stretcher`] restarts the chain every [`SYNC_SEGMENTS`] segments (about 0.6 s): the first
//! segment of a group is taken at its nominal input position without a search. A request then
//! recomputes at most one group ahead of its window. Never panics: lengths, rates and speeds are
//! sanitised and output is capped at [`MAX_STRETCH_SAMPLES`] per channel.

use std::f64::consts::PI;

/// Largest number of samples per channel [`time_stretch`] will produce.
pub const MAX_STRETCH_SAMPLES: usize = 1 << 28;

/// Segments per chain in [`Stretcher::render`] (the chain restarts at every multiple).
pub const SYNC_SEGMENTS: usize = 32;

/// Speed (input samples per output sample) outside this range is clamped.
pub const SPEED_RANGE: (f64, f64) = (0.1, 10.0);

fn sane_rate(sample_rate: u32) -> f64 {
    if sample_rate >= 1000 { f64::from(sample_rate.min(1_536_000)) } else { 48_000.0 }
}

fn sane_speed(speed: f64) -> f64 {
    if speed.is_finite() { speed.clamp(SPEED_RANGE.0, SPEED_RANGE.1) } else { 1.0 }
}

/// WSOLA on a segment grid anchored at sample 0 of a clip.
#[derive(Clone, Debug)]
pub struct Stretcher {
    frame: usize,
    hop: usize,
    tol: i64,
    /// Segments per chain; `None` runs one chain from segment 0 (the whole-buffer behaviour).
    sync: Option<usize>,
    window: Vec<f32>,
}

impl Stretcher {
    /// Segment sizes for `sample_rate` (40 ms frames, 20 ms hop, 10 ms search), chains of
    /// [`SYNC_SEGMENTS`].
    pub fn new(sample_rate: u32) -> Self {
        Self::with_sync(sample_rate, Some(SYNC_SEGMENTS))
    }

    fn with_sync(sample_rate: u32, sync: Option<usize>) -> Self {
        let sr = sane_rate(sample_rate);
        let frame = (((sr * 0.04) as usize) & !1).clamp(64, 8192);
        let hop = frame / 2;
        let tol = ((sr * 0.010) as usize).clamp(8, 2048) as i64;
        let window = (0..frame).map(|i| (0.5 - 0.5 * (2.0 * PI * i as f64 / frame as f64).cos()) as f32).collect();
        Self { frame, hop, tol, sync: sync.filter(|s| *s > 0), window }
    }

    /// Segment length in samples.
    pub fn frame(&self) -> usize {
        self.frame
    }

    /// Output distance between segments in samples.
    pub fn hop(&self) -> usize {
        self.hop
    }

    /// Nominal input position of segment `k`.
    fn nominal(&self, k: i64, speed: f64) -> i64 {
        ((k * self.hop as i64) as f64 * speed).round() as i64
    }

    /// Output samples `[out0, out0 + n)` of the clip's stretched sound. `speed` is input samples
    /// per output sample (2.0 plays twice as fast and lasts half as long). `pull(src0, len)` gives
    /// `len` input samples from clip-relative input position `src0` (planar, zeros where there is
    /// no sound), or `None` when the source cannot be read. Positions before 0 are silent.
    pub fn render(&self, speed: f64, out0: i64, n: usize, pull: &dyn Fn(i64, usize) -> Option<Vec<Vec<f32>>>) -> Option<Vec<Vec<f32>>> {
        self.render_keyed(None, speed, out0, n, pull)
    }

    /// [`Stretcher::render`] that remembers the chosen segment positions of each chain under `key`
    /// (sh-video-editor). `key` must identify the input sound: the same key always means the same
    /// samples from `pull`. A small block then reads and searches only its own segments instead of
    /// redoing its chain from the start (preview asks for 4096 frames at a time, which cost 3.6
    /// times as much per second as one-second blocks). The output is the same as without a key.
    pub fn render_keyed(&self, key: Option<u64>, speed: f64, out0: i64, n: usize, pull: &dyn Fn(i64, usize) -> Option<Vec<Vec<f32>>>) -> Option<Vec<Vec<f32>>> {
        let speed = sane_speed(speed);
        if n == 0 {
            return pull(0, 0);
        }
        if (speed - 1.0).abs() < 1e-9 {
            return pull(out0, n).map(|mut ch| {
                for c in &mut ch {
                    c.resize(n, 0.0);
                }
                ch
            });
        }
        let (frame, hop) = (self.frame as i64, self.hop as i64);
        let out_end = out0.saturating_add(n as i64);
        if out_end <= 0 {
            return pull(0, 1).map(|ch| ch.iter().map(|_| vec![0.0; n]).collect());
        }
        // segments overlapping the window: k * hop + frame > out0 and k * hop < out_end
        let k_first = ((out0 - frame).div_euclid(hop) + 1).max(0);
        let k_last = ((out_end - 1).div_euclid(hop)).max(0);
        let (positions, read) = self.positions(key, speed, k_first, k_last, pull)?;
        // input the window's segments read: reuse the search read when it covers them (a decoded
        // source may differ in the last bits with where a read starts, about 1e-4 for AAC; so does
        // any read order, it is not a change of the stretch)
        let lo = positions.iter().copied().min().unwrap_or(0);
        let hi = positions.iter().copied().max().unwrap_or(0) + frame;
        let (lo, src) = match read {
            Some((rlo, src)) if rlo <= lo && src.first().is_some_and(|c| rlo + c.len() as i64 >= hi) => (rlo, src),
            _ => {
                let len = usize::try_from(hi - lo).ok()?.min(MAX_STRETCH_SAMPLES);
                let mut src = pull(lo, len)?;
                for c in &mut src {
                    c.resize(len, 0.0);
                }
                (lo, src)
            }
        };
        let nch = src.len();
        if nch == 0 {
            return Some(Vec::new());
        }
        let mut out: Vec<Vec<f32>> = (0..nch).map(|_| vec![0.0f32; n]).collect();
        let mut wsum = vec![0.0f32; n];
        for (k, &in_pos) in (k_first..=k_last).zip(&positions) {
            let out_pos = k * hop;
            for (i, w) in self.window.iter().enumerate() {
                let o = out_pos + i as i64 - out0;
                if o < 0 || o >= n as i64 {
                    continue;
                }
                let o = o as usize;
                let s = in_pos + i as i64 - lo;
                if s < 0 {
                    continue;
                }
                let s = s as usize;
                for (c, dst) in src.iter().zip(out.iter_mut()) {
                    if let (Some(v), Some(d)) = (c.get(s), dst.get_mut(o)) {
                        *d += v * w;
                    }
                }
                if let Some(d) = wsum.get_mut(o) {
                    *d += w;
                }
            }
        }
        for o in out.iter_mut() {
            for (s, w) in o.iter_mut().zip(&wsum) {
                if *w > 1e-3 {
                    *s /= w;
                }
            }
        }
        Some(out)
    }

    /// Input positions of segments `k_first..=k_last`, from the chain cache under `key` or by
    /// searching each chain from its start. Also returns the last search read (start, planar
    /// samples) so the caller can reuse it.
    #[allow(clippy::type_complexity)]
    fn positions(
        &self,
        key: Option<u64>,
        speed: f64,
        k_first: i64,
        k_last: i64,
        pull: &dyn Fn(i64, usize) -> Option<Vec<Vec<f32>>>,
    ) -> Option<(Vec<i64>, Option<(i64, Vec<Vec<f32>>)>)> {
        let Some(sync) = self.sync.map(|s| s as i64) else {
            let (pos, lo, src) = self.search(speed, 0, k_last, None, pull)?;
            return Some((pos[k_first as usize..].to_vec(), Some((lo, src))));
        };
        let mut out = Vec::with_capacity((k_last - k_first + 1) as usize);
        let mut read = None;
        let mut k = k_first;
        while k <= k_last {
            let chain = k / sync;
            let c0 = chain * sync;
            let upto = k_last.min(c0 + sync - 1);
            let ck = match key {
                Some(key) => Some((self.fingerprint(key, speed, c0, sync, pull)?, speed.to_bits(), self.frame as u64, chain)),
                None => None,
            };
            let cached = ck.and_then(|ck| chains().lock().unwrap_or_else(|e| e.into_inner()).get(&ck)).filter(|p| p.len() as i64 > upto - c0);
            let chain_pos = match cached {
                Some(p) => p,
                None => {
                    // with a key, search the whole chain once so later blocks find it
                    let last = if ck.is_some() { c0 + sync - 1 } else { upto };
                    let (pos, lo, src) = self.search(speed, c0, last, Some(sync), pull)?;
                    let pos = std::sync::Arc::new(pos);
                    if let Some(ck) = ck
                        && !src.is_empty()
                    {
                        chains().lock().unwrap_or_else(|e| e.into_inner()).put(ck, pos.clone());
                    }
                    read = Some((lo, src));
                    pos
                }
            };
            out.extend_from_slice(&chain_pos[(k - c0) as usize..=(upto - c0) as usize]);
            k = upto + 1;
        }
        Some((out, read))
    }

    /// `key` mixed with three short probes of the chain's input, so a cached chain is only reused
    /// for the same sound even when the caller's ids are reused (a new project numbers its items
    /// from 1 again).
    fn fingerprint(&self, key: u64, speed: f64, c0: i64, sync: i64, pull: &dyn Fn(i64, usize) -> Option<Vec<Vec<f32>>>) -> Option<u64> {
        let mut h = key ^ 0xcbf2_9ce4_8422_2325;
        for k in [c0, c0 + sync / 2, c0 + sync - 1] {
            for c in pull(self.nominal(k, speed).max(0), 32)? {
                for v in c {
                    h = (h ^ u64::from(v.to_bits())).wrapping_mul(0x0100_0000_01b3);
                }
            }
        }
        Some(h)
    }

    /// Search segments `c0..=last` (one chain: `c0` is a chain start or 0) and return their input
    /// positions with the input read for the search.
    fn search(
        &self,
        speed: f64,
        c0: i64,
        last: i64,
        sync: Option<i64>,
        pull: &dyn Fn(i64, usize) -> Option<Vec<Vec<f32>>>,
    ) -> Option<(Vec<i64>, i64, Vec<Vec<f32>>)> {
        let (frame, hop) = (self.frame as i64, self.hop as i64);
        // one read covers every candidate of every segment from the chain start
        let lo = (self.nominal(c0, speed) - self.tol - 1).max(0);
        let hi = self.nominal(last, speed) + self.tol + frame + hop + 2;
        let len = usize::try_from(hi - lo).ok()?.min(MAX_STRETCH_SAMPLES);
        let mut src = pull(lo, len)?;
        for c in &mut src {
            c.resize(len, 0.0);
        }
        let nch = src.len();
        if nch == 0 {
            return Some(((c0..=last).map(|k| self.nominal(k, speed).max(0)).collect(), lo, src));
        }
        let guide: Vec<f32> = (0..len).map(|i| src.iter().map(|c| c.get(i).copied().unwrap_or(0.0)).sum::<f32>() / nch as f32).collect();
        // input sample at absolute clip position `p`
        let g = |p: i64| -> f32 {
            let i = p - lo;
            if i < 0 { 0.0 } else { guide.get(i as usize).copied().unwrap_or(0.0) }
        };
        let mut positions = Vec::with_capacity((last - c0 + 1).max(0) as usize);
        let mut prev_in: i64 = 0;
        for k in c0..=last {
            let nominal = self.nominal(k, speed);
            let fresh = k == 0 || sync.is_some_and(|s| k % s == 0);
            let in_pos = if fresh {
                nominal.max(0)
            } else {
                let natural = prev_in + hop;
                // similarity of candidate start `p` with the natural continuation (stride 2)
                let score = |p: i64| -> f32 {
                    let (mut xy, mut yy) = (0.0f32, 1e-9f32);
                    let (a0, b0) = (natural - lo, p - lo);
                    if a0 >= 0 && b0 >= 0 && ((a0.max(b0) + hop) as usize) <= guide.len() {
                        // fast path: both spans inside the read (same sums as below)
                        let (a, b) = (&guide[a0 as usize..(a0 + hop) as usize], &guide[b0 as usize..(b0 + hop) as usize]);
                        for (x, y) in a.iter().step_by(2).zip(b.iter().step_by(2)) {
                            xy += x * y;
                            yy += y * y;
                        }
                    } else {
                        let mut i = 0i64;
                        while i < hop {
                            let a = g(natural + i);
                            let b = g(p + i);
                            xy += a * b;
                            yy += b * b;
                            i += 2;
                        }
                    }
                    xy / yy.sqrt()
                };
                let clo = (nominal - self.tol).max(0);
                let chi = nominal + self.tol;
                let mut best = nominal.max(0);
                let mut best_s = f32::NEG_INFINITY;
                let mut p = clo;
                while p <= chi {
                    let s = score(p);
                    if s > best_s {
                        best_s = s;
                        best = p;
                    }
                    p += 4;
                }
                let (rlo, rhi) = ((best - 3).max(clo), (best + 3).min(chi));
                for p in rlo..=rhi {
                    let s = score(p);
                    if s > best_s {
                        best_s = s;
                        best = p;
                    }
                }
                best
            };
            prev_in = in_pos;
            positions.push(in_pos);
        }
        Some((positions, lo, src))
    }
}

/// Chosen segment positions per (key, speed bits, frame, chain), oldest dropped first.
struct Chains {
    map: std::collections::HashMap<(u64, u64, u64, i64), std::sync::Arc<Vec<i64>>>,
    order: std::collections::VecDeque<(u64, u64, u64, i64)>,
}

/// Chains kept (32 segments each, about 256 bytes): a few minutes of stretched clips.
const CHAIN_CACHE: usize = 4096;

impl Chains {
    fn get(&self, k: &(u64, u64, u64, i64)) -> Option<std::sync::Arc<Vec<i64>>> {
        self.map.get(k).cloned()
    }

    fn put(&mut self, k: (u64, u64, u64, i64), v: std::sync::Arc<Vec<i64>>) {
        if self.map.insert(k, v).is_none() {
            self.order.push_back(k);
            while self.order.len() > CHAIN_CACHE {
                if let Some(old) = self.order.pop_front() {
                    self.map.remove(&old);
                }
            }
        }
    }
}

fn chains() -> &'static std::sync::Mutex<Chains> {
    static CHAINS: std::sync::OnceLock<std::sync::Mutex<Chains>> = std::sync::OnceLock::new();
    CHAINS.get_or_init(|| std::sync::Mutex::new(Chains { map: Default::default(), order: Default::default() }))
}

/// Pitch-preserving time stretch of whole buffers (the upstream function). `ratio` = output
/// length / input length, clamped to 0.1 ..= 10. All channels share the same segment choices.
pub fn time_stretch(ch: &[Vec<f32>], ratio: f64, sample_rate: u32) -> Vec<Vec<f32>> {
    let len = ch.iter().map(Vec::len).max().unwrap_or(0);
    let ratio = if ratio.is_finite() { ratio.clamp(0.1, 10.0) } else { 1.0 };
    let out_len = ((len as f64 * ratio).round() as usize).min(MAX_STRETCH_SAMPLES);
    if len == 0 || ch.is_empty() {
        return ch.iter().map(|_| vec![0.0; out_len]).collect();
    }
    let pull = |p: i64, n: usize| -> Option<Vec<Vec<f32>>> {
        Some(
            ch.iter()
                .map(|c| (0..n).map(|i| if p + (i as i64) < 0 { 0.0 } else { c.get((p + i as i64) as usize).copied().unwrap_or(0.0) }).collect())
                .collect(),
        )
    };
    let st = Stretcher::with_sync(sample_rate, None);
    st.render(1.0 / ratio, 0, out_len, &pull).unwrap_or_else(|| ch.iter().map(|_| vec![0.0; out_len]).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fft::Fft;
    use std::f32::consts::TAU;

    fn sine(freq: f32, amp: f32, sr: f32, len: usize) -> Vec<f32> {
        (0..len).map(|i| amp * (TAU * freq * i as f32 / sr).sin()).collect()
    }

    /// Dominant frequency of the middle of `x` by FFT with parabolic interpolation.
    fn dominant_hz(x: &[f32], sr: f32) -> f32 {
        let n = 16_384usize.min(x.len().next_power_of_two());
        let start = x.len().saturating_sub(n) / 2;
        let mut re: Vec<f32> = (0..n)
            .map(|i| {
                let w = 0.5 - 0.5 * (TAU * i as f32 / n as f32).cos();
                x.get(start + i).copied().unwrap_or(0.0) * w
            })
            .collect();
        let mut im = vec![0.0f32; n];
        Fft::new(n).forward(&mut re, &mut im);
        let mag: Vec<f32> = (0..n / 2).map(|i| (re[i] * re[i] + im[i] * im[i]).sqrt().max(1e-12).ln()).collect();
        let k = (1..n / 2 - 1).max_by(|a, b| mag[*a].total_cmp(&mag[*b])).unwrap();
        let (a, b, c) = (mag[k - 1], mag[k], mag[k + 1]);
        let d = 0.5 * (a - c) / (a - 2.0 * b + c);
        (k as f32 + d) * sr / n as f32
    }

    // soundcraft crates/dsp/tests/offline_meters.rs `time_stretch_length_and_pitch`
    #[test]
    fn time_stretch_length_and_pitch() {
        let sr = 48_000.0;
        let x = sine(440.0, 0.5, sr, 48_000);
        for ratio in [0.5, 0.8, 1.25, 2.0] {
            let out = time_stretch(&[x.clone(), x.clone()], ratio, 48_000);
            assert_eq!(out.len(), 2);
            assert_eq!(out[0].len(), (48_000.0 * ratio).round() as usize);
            let f = dominant_hz(&out[0], sr);
            assert!((f - 440.0).abs() < 3.0, "ratio {ratio}: {f}");
        }
        assert!(time_stretch(&[vec![]], 2.0, 48_000)[0].is_empty());
        let _ = time_stretch(std::slice::from_ref(&x), f64::NAN, 0);
    }

    #[test]
    fn unity_ratio_copies_and_pads() {
        let x = sine(100.0, 0.5, 48_000.0, 1000);
        let out = time_stretch(std::slice::from_ref(&x), 1.0, 48_000);
        assert_eq!(out[0], x);
        assert!(time_stretch(&[], 2.0, 48_000).is_empty());
    }

    // soundcraft crates/dsp/tests/fuzz.rs `offline_functions_survive` (the time_stretch part),
    // without proptest: a fixed LCG over lengths, ratios and rates
    #[test]
    fn survives_odd_lengths_ratios_and_rates() {
        let mut seed = 0x1234_5678u32;
        let mut next = || {
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            seed
        };
        for _ in 0..40 {
            let len = (next() % 3000) as usize;
            let ratio = f64::from(next() % 2000) / 100.0 - 5.0;
            let sr = next() % 200_000;
            let data: Vec<f32> = (0..len).map(|_| (next() as f32 / u32::MAX as f32) * 8.0 - 4.0).collect();
            let out = time_stretch(&[data.clone(), data], ratio, sr);
            let want = ((len as f64) * if ratio.is_finite() { ratio.clamp(0.1, 10.0) } else { 1.0 }).round() as usize;
            assert_eq!(out[0].len(), want);
            assert!(out.iter().flatten().all(|v| v.is_finite()));
        }
    }

    fn tone_source(x: Vec<f32>) -> impl Fn(i64, usize) -> Option<Vec<Vec<f32>>> {
        move |p, n| Some(vec![(0..n).map(|i| if p + (i as i64) < 0 { 0.0 } else { x.get((p + i as i64) as usize).copied().unwrap_or(0.0) }).collect()])
    }

    #[test]
    fn render_is_block_invariant() {
        let sr = 48_000u32;
        let mut x = sine(440.0, 0.5, sr as f32, 4 * 48_000);
        // some structure beyond a pure tone so the search has something to choose
        for (i, v) in x.iter_mut().enumerate() {
            *v += 0.2 * (TAU * 3.3 * i as f32 / sr as f32).sin() * (TAU * 1234.0 * i as f32 / sr as f32).sin();
        }
        let pull = tone_source(x);
        let st = Stretcher::new(sr);
        for speed in [2.0, 0.5, 1.37] {
            let whole = st.render(speed, 0, 2 * 48_000, &pull).unwrap();
            let mut cut: Vec<f32> = Vec::new();
            let sizes = [4096usize, 1000, 64, 7777, 1];
            let (mut pos, mut k) = (0usize, 0usize);
            while pos < 2 * 48_000 {
                let m = sizes[k % sizes.len()].min(2 * 48_000 - pos);
                let b = st.render(speed, pos as i64, m, &pull).unwrap();
                cut.extend_from_slice(&b[0]);
                pos += m;
                k += 1;
            }
            assert_eq!(cut.len(), whole[0].len());
            let worst = cut.iter().zip(&whole[0]).map(|(a, b)| (a - b).abs()).fold(0.0f32, f32::max);
            assert!(worst == 0.0, "speed {speed}: blocks differ by {worst}");
            // remembered chains give the same samples, in any order of requests
            let mut keyed: Vec<f32> = Vec::new();
            let (mut pos, mut k) = (0usize, 0usize);
            while pos < 2 * 48_000 {
                let m = sizes[(k + 2) % sizes.len()].min(2 * 48_000 - pos);
                keyed.extend_from_slice(&st.render_keyed(Some(7), speed, pos as i64, m, &pull).unwrap()[0]);
                pos += m;
                k += 1;
            }
            assert!(keyed == whole[0], "speed {speed}: keyed blocks differ");
            assert!(st.render_keyed(Some(7), speed, 0, 2 * 48_000, &pull).unwrap()[0] == whole[0]);
        }
        // the same key over a different sound does not reuse the first sound's chains
        let other = tone_source(sine(300.0, 0.3, sr as f32, 4 * 48_000));
        let fresh = st.render(1.37, 1000, 9000, &other).unwrap();
        assert!(st.render_keyed(Some(7), 1.37, 1000, 9000, &other).unwrap() == fresh);
    }

    #[test]
    fn render_keeps_pitch_and_follows_the_timeline() {
        let sr = 48_000u32;
        let x = sine(440.0, 0.5, sr as f32, 6 * 48_000);
        let pull = tone_source(x);
        let st = Stretcher::new(sr);
        for speed in [2.0, 0.5, 1.5] {
            let out = st.render(speed, 48_000, 48_000, &pull).unwrap();
            assert_eq!(out.len(), 1);
            assert_eq!(out[0].len(), 48_000);
            let f = dominant_hz(&out[0], sr as f32);
            assert!((f - 440.0).abs() < 3.0, "speed {speed}: {f}");
            let peak = out[0].iter().fold(0.0f32, |m, v| m.max(v.abs()));
            assert!((0.4..=0.6).contains(&peak), "speed {speed}: peak {peak}");
        }
        // past the sound: silence; unity speed: the source itself
        let tail = st.render(2.0, 4 * 48_000, 4800, &pull).unwrap();
        assert!(tail[0].iter().all(|v| v.abs() < 1e-6));
        let same = st.render(1.0, 100, 50, &pull).unwrap();
        assert_eq!(same[0], pull(100, 50).unwrap()[0]);
        // before the clip: silence, no panic
        let before = st.render(2.0, -10_000, 100, &pull).unwrap();
        assert_eq!(before[0].len(), 100);
        assert!(st.render(2.0, 0, 0, &pull).unwrap()[0].is_empty());
        assert!(st.render(f64::NAN, 0, 10, &pull).is_some());
        // a source that cannot be read
        assert!(st.render(2.0, 0, 10, &|_, _| None).is_none());
    }

    /// `cargo test -p filmcraft-audio-dsp --release stretch_block_timing -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn stretch_block_timing() {
        let sr = 48_000u32;
        let mut x = sine(220.0, 0.4, sr as f32, 30 * 48_000);
        for (i, v) in x.iter_mut().enumerate() {
            *v += 0.2 * (TAU * 3.3 * i as f32 / sr as f32).sin() * (TAU * 1234.0 * i as f32 / sr as f32).sin();
        }
        let src = [x.clone(), x];
        let pull = move |p: i64, n: usize| {
            Some(
                src.iter()
                    .map(|c| (0..n).map(|i| if p + (i as i64) < 0 { 0.0 } else { c.get((p + i as i64) as usize).copied().unwrap_or(0.0) }).collect())
                    .collect(),
            )
        };
        let st = Stretcher::new(sr);
        for speed in [1.5, 0.75] {
            for block in [4096usize, 48_000] {
                let total = 10 * 48_000;
                let t0 = std::time::Instant::now();
                let mut pos = 0;
                while pos < total {
                    std::hint::black_box(st.render(speed, pos as i64, block.min(total - pos), &pull));
                    pos += block;
                }
                let ms = t0.elapsed().as_secs_f64() * 1000.0;
                let t0 = std::time::Instant::now();
                let mut pos = 0;
                while pos < total {
                    std::hint::black_box(st.render_keyed(Some(block as u64 ^ speed.to_bits()), speed, pos as i64, block.min(total - pos), &pull));
                    pos += block;
                }
                let keyed = t0.elapsed().as_secs_f64() * 1000.0;
                println!("speed {speed} block {block}: {:.2} ms per second of output, keyed {:.2}", ms / 10.0, keyed / 10.0);
            }
        }
    }
}
