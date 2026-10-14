//! 자동 자막(M2-2, feature `stt`): 음성 모델 다운로드와 음성 인식을 libuv 스레드에서 돌려 엔진 세션을 막지 않는다.
//! 편집 로직은 없다. 가중치는 엔진의 카탈로그·검증 다운로더(`filmcraft_speech::models`)가 받고, 인식은 엔진의
//! `Transcriber`(Whisper, candle, CPU)를 그대로 부르며, 결과 transcript 는 화면이 엔진 커맨드 `transcript.set` 으로
//! 넣는다(그 뒤 `transcript.createCaptions` 가 자막 트랙을 만든다). 세션 안에서 동기로 도는 `transcript.generate` 도
//! 그대로 쓸 수 있지만 진행률·취소가 없어 화면은 이 경로를 쓴다.
//!
//! 진행률은 ThreadsafeFunction 으로 호스트에 보내고, 취소는 AbortSignal(`AbortController`)로 받는다.
//! 모델이 놓이는 디렉토리는 엔진과 같다(`filmcraft_engine::transcript::models_dir`, `FILMCRAFT_DATA_DIR/models`).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use filmcraft_engine::Session;
use filmcraft_project::ItemId;
use filmcraft_speech::{Options, SpeechError, Transcriber};
use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;

/// 진행 콜백 한 번의 값. 다운로드는 `done`·`total` 이 바이트, 인식은 `fraction`(0..1)만 뜻이 있다.
#[napi(object)]
pub struct SttProgress {
    pub fraction: f64,
    pub done: f64,
    pub total: f64,
    pub status: String,
}

/// 호스트가 넘기는 진행 콜백 `(p: SttProgress) => void`. 호출 스레드에서 큐에 넣고 바로 돌아온다.
pub type Progress = ThreadsafeFunction<SttProgress, (), SttProgress, Status, false>;

/// 인식할 수 있는 소리 길이 상한(초). 그보다 길면 메모리(16 kHz f32)와 시간을 지키려고 거부한다.
const MAX_SECONDS: i64 = 3 * 60 * 60;

fn err(e: impl std::fmt::Display) -> Error {
    Error::from_reason(e.to_string())
}

fn models_dir() -> Result<std::path::PathBuf> {
    filmcraft_engine::transcript::models_dir()
        .ok_or_else(|| Error::from_reason("no data directory for speech models"))
}

fn report(progress: &Option<Progress>, p: SttProgress) {
    if let Some(f) = progress {
        f.call(p, ThreadsafeFunctionCallMode::NonBlocking);
    }
}

/// AbortSignal 이 울리면 플래그를 세운다. 작업 스레드의 진행 콜백이 이 플래그를 보고 멈춘다.
fn cancel_flag(signal: &Option<AbortSignal>) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    if let Some(s) = signal {
        let f = flag.clone();
        s.on_abort(move || f.store(true, Ordering::Relaxed));
    }
    flag
}

// ------------------------------------------------------------------ 모델 다운로드

pub struct DownloadModel {
    model: String,
    progress: Option<Progress>,
    cancel: Arc<AtomicBool>,
}

impl Task for DownloadModel {
    type Output = String;
    type JsValue = String;

    fn compute(&mut self) -> Result<String> {
        let m = filmcraft_speech::models::find(&self.model)
            .ok_or_else(|| err(SpeechError::UnknownModel(self.model.clone())))?;
        let dir = models_dir()?;
        let total_all = m.size() as f64;
        let cancel = self.cancel.clone();
        let progress = self.progress.take();
        // 다운로더는 읽은 조각(수십 KB)마다 부르므로 256 KB 마다, 그리고 다 받았을 때만 호스트에 알린다
        let mut last = 0u64;
        let r = filmcraft_speech::models::download(&dir, m, &mut |done, total, file| {
            let total_b = if total == 0 { total_all } else { total as f64 };
            if done.saturating_sub(last) >= 1 << 18 || done >= total {
                last = done;
                report(
                    &progress,
                    SttProgress {
                        fraction: (done as f64 / total_b).clamp(0.0, 1.0),
                        done: done as f64,
                        total: total_b,
                        status: file.to_string(),
                    },
                );
            }
            !cancel.load(Ordering::Relaxed)
        });
        r.map_err(err)?;
        Ok(serde_json::json!({"model": m.id, "dir": filmcraft_speech::models::model_dir(&dir, m).to_string_lossy()}).to_string())
    }

    fn resolve(&mut self, _env: Env, out: String) -> Result<String> {
        Ok(out)
    }
}

/// 카탈로그 모델(`transcript.models` 의 id)을 엔진의 모델 디렉토리에 내려받는다(검증 포함, 이미 있는 파일은 건너뜀).
/// 끝나면 `{"model","dir"}` JSON 문자열. `signal` 로 취소하면 거부된다("stopped").
#[napi(ts_return_type = "Promise<string>")]
pub fn download_speech_model(
    model: String,
    progress: Option<Progress>,
    signal: Option<AbortSignal>,
) -> AsyncTask<DownloadModel> {
    let cancel = cancel_flag(&signal);
    AsyncTask::with_optional_signal(
        DownloadModel {
            model,
            progress,
            cancel,
        },
        signal,
    )
}

// ------------------------------------------------------------------ 음성 인식

/// 열어 둔 모델: (id, 인식기).
type Loaded = Option<(String, Arc<dyn Transcriber>)>;

/// 마지막으로 연 모델(가중치가 수백 MB 라 클립마다 다시 읽지 않는다). `release_speech_model` 이 비운다.
static LOADED: OnceLock<Mutex<Loaded>> = OnceLock::new();

fn loaded() -> &'static Mutex<Loaded> {
    LOADED.get_or_init(|| Mutex::new(None))
}

fn load_model(id: &str) -> Result<Arc<dyn Transcriber>> {
    let mut slot = loaded().lock().unwrap_or_else(|e| e.into_inner());
    if let Some((cur, t)) = slot.as_ref()
        && cur == id
    {
        return Ok(t.clone());
    }
    *slot = None; // 다른 모델을 열기 전에 이전 가중치를 먼저 놓는다
    let t = filmcraft_speech::load(&models_dir()?, id).map_err(err)?;
    *slot = Some((id.to_string(), t.clone()));
    Ok(t)
}

/// 열어 둔 음성 모델을 메모리에서 놓는다. 자막 생성 묶음이 끝나면 호스트가 부른다.
#[napi]
pub fn release_speech_model() {
    *loaded().lock().unwrap_or_else(|e| e.into_inner()) = None;
}

/// 미디어 항목의 소리를 모노 16 kHz 로 읽는다(엔진 `transcript.generate` 의 `item_audio` 와 같은 규칙:
/// 서브클립은 원본 미디어로, 소리가 없으면 오류).
pub fn item_audio(s: &Session, item: i64) -> Result<Vec<f32>> {
    let id = u64::try_from(item).map_err(|_| Error::from_reason("item id must be non-negative"))?;
    let (root, clip, _) = s
        .project
        .resolve_media(ItemId(id))
        .ok_or_else(|| Error::from_reason("no such media item"))?;
    let dur = clip.duration();
    let src = s
        .source(root)
        .ok_or_else(|| Error::from_reason("the media cannot be opened"))?;
    if !src.info().has_audio() {
        return Err(Error::from_reason("the clip has no audio to transcribe"));
    }
    let sr = filmcraft_speech::SAMPLE_RATE;
    let len = dur.to_units_floor(i64::from(sr)).max(0);
    if len > MAX_SECONDS * i64::from(sr) {
        return Err(Error::from_reason(format!(
            "the clip is longer than {} hours; cut it before transcribing",
            MAX_SECONDS / 3600
        )));
    }
    let buf = src.audio(0, len as usize, sr).map_err(err)?;
    Ok(filmcraft_speech::downmix(&buf.channels))
}

pub struct Transcribe {
    audio: Vec<f32>,
    model: String,
    language: Option<String>,
    progress: Option<Progress>,
    cancel: Arc<AtomicBool>,
}

impl Task for Transcribe {
    type Output = String;
    type JsValue = String;

    fn compute(&mut self) -> Result<String> {
        let progress = self.progress.take();
        report(
            &progress,
            SttProgress {
                fraction: 0.0,
                done: 0.0,
                total: 1.0,
                status: "Loading model".into(),
            },
        );
        let t = load_model(&self.model)?;
        if self.cancel.load(Ordering::Relaxed) {
            return Err(err(SpeechError::Cancelled));
        }
        let opts = Options {
            language: self.language.clone(),
            diarize: false,
            max_speakers: 1,
        };
        let audio = std::mem::take(&mut self.audio);
        let cancel = self.cancel.clone();
        let mut tr = t
            .transcribe(&audio, &opts, &mut |f, status| {
                report(
                    &progress,
                    SttProgress {
                        fraction: f64::from(f).clamp(0.0, 1.0),
                        done: f64::from(f),
                        total: 1.0,
                        status: status.to_string(),
                    },
                );
                !cancel.load(Ordering::Relaxed)
            })
            .map_err(err)?;
        tr.normalize();
        serde_json::to_string(&tr).map_err(err)
    }

    fn resolve(&mut self, _env: Env, out: String) -> Result<String> {
        Ok(out)
    }
}

/// `item` 의 소리를 세션에서 읽고(동기) Whisper 모델 `model` 로 인식하는 작업을 만든다(libuv 스레드).
/// `language` 는 ISO 639-1(`"ko"`), 없거나 `"auto"` 면 첫 30초에서 감지. 결과는 엔진 `Transcript` JSON 문자열
/// (`transcript.set` 의 `transcript` 에 그대로 넣는다).
pub fn transcribe_item(
    s: &Session,
    item: i64,
    model: String,
    language: Option<String>,
    progress: Option<Progress>,
    signal: Option<AbortSignal>,
) -> Result<AsyncTask<Transcribe>> {
    if filmcraft_speech::models::find(&model).is_none() {
        return Err(err(SpeechError::UnknownModel(model)));
    }
    let audio = item_audio(s, item)?;
    let language = language.filter(|l| !l.is_empty() && l != "auto");
    let cancel = cancel_flag(&signal);
    Ok(AsyncTask::with_optional_signal(
        Transcribe {
            audio,
            model,
            language,
            progress,
            cancel,
        },
        signal,
    ))
}
