//! Node-API 바인딩. Electron 의 메인(나중에는 utility) 프로세스가 `require` 해서 쓴다.
//! 모든 편집 동작은 filmcraft 엔진의 커맨드(`Session::execute(id, params)`)로 들어간다.
//! 프레임은 sRGB RGBA8 `Buffer` 로 돌려주어 렌더러가 canvas 에 바로 그린다.

use std::sync::Arc;
use std::sync::atomic::{AtomicI32, Ordering};

use filmcraft_engine::autosave::AutosaveConfig;
use filmcraft_engine::{Event, FsServices, Session, command_specs};
use filmcraft_project::ItemId;
use filmcraft_time::Tick;
use napi::bindgen_prelude::*;
use napi_derive::napi;

/// 오디오 미리듣기·파형. wasm 바인딩과 같은 파일(bindings/shared/audio.rs).
#[path = "../../shared/audio.rs"]
mod audio;

/// 자동 자막(feature `stt`): 모델 다운로드·음성 인식을 libuv 스레드에서. 데스크톱 전용.
#[cfg(feature = "stt")]
pub mod stt;

/// 이식한 기반 엔진의 출처·버전. 바인딩 버전은 `CARGO_PKG_VERSION`.
pub const BASE_ENGINE: &str = "filmcraft 0.2.1";

/// 호스트가 알려 준 로컬 UTC 오프셋(초). 자동 저장 파일 이름의 시각에 쓴다.
static LOCAL_OFFSET_SECONDS: AtomicI32 = AtomicI32::new(0);

fn local_offset(_unix: i64) -> i32 {
    LOCAL_OFFSET_SECONDS.load(Ordering::Relaxed)
}

/// 하드웨어 디코더 등록 결과(백엔드 이름). 프로세스에서 한 번만 등록한다.
static HW_BACKEND: std::sync::OnceLock<Option<&'static str>> = std::sync::OnceLock::new();

/// OS 의 하드웨어 비디오 디코더(Windows: Media Foundation, macOS: VideoToolbox)를 엔진 코덱 앞에 등록한다.
/// 등록은 팩토리 포인터를 두는 것뿐이라 장치를 만들지 않고, 하드웨어가 못 받는 스트림은 자체 디코더로 간다
/// (`filmcraft_platform::HybridDecoder`). Linux 에는 경로가 없어 아무것도 하지 않는다.
fn register_hardware_decoders() -> Option<&'static str> {
    *HW_BACKEND.get_or_init(|| {
        #[cfg(any(target_os = "windows", target_os = "macos"))]
        {
            match filmcraft_platform::register() {
                filmcraft_platform::Availability::Available(name) => Some(name),
                filmcraft_platform::Availability::Unavailable(_) => None,
            }
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        {
            None
        }
    })
}

/// 버전 문자열. 끝의 `hw:` 는 이 프로세스에 등록된 하드웨어 디코더 백엔드(없으면 `none`).
#[napi]
pub fn engine_version() -> String {
    let hw = register_hardware_decoders().unwrap_or("none");
    format!(
        "sh-video-engine {} (base {BASE_ENGINE}; hw: {hw})",
        env!("CARGO_PKG_VERSION")
    )
}

/// 등록된 하드웨어 디코더 백엔드 이름("Media Foundation", "VideoToolbox"), 없으면 null.
#[napi]
pub fn hardware_decoder() -> Option<String> {
    register_hardware_decoders().map(str::to_string)
}

/// 커맨드 카탈로그를 JSON 문자열로 (id, label, menu, shortcut, params).
#[napi]
pub fn command_catalog() -> String {
    let specs: Vec<serde_json::Value> = command_specs()
        .iter()
        .map(|c| {
            serde_json::json!({
                "id": c.id,
                "label": c.label,
                "menu": c.menu,
                "shortcut": c.shortcut,
                "params": c.params,
            })
        })
        .collect();
    serde_json::Value::Array(specs).to_string()
}

/// 엔진 이벤트를 화면이 분류하기 쉬운 `{type, ...}` 객체로. wasm 바인딩과 같은 모양이다.
/// - projectChanged {revision} · toast {message, error} · openSequence|openSource|revealInProject {item}
/// - jobProgress {id, kind, label, progress 0..1, done, cancelled, error|null} (잡 진행률이 바뀔 때마다 하나)
pub fn event_json(e: Event) -> serde_json::Value {
    match e {
        Event::ProjectChanged { revision } => {
            serde_json::json!({"type": "projectChanged", "revision": revision})
        }
        Event::Toast { message, error } => {
            serde_json::json!({"type": "toast", "message": message, "error": error})
        }
        Event::OpenSequence(item) => serde_json::json!({"type": "openSequence", "item": item.0}),
        Event::OpenSource(item) => serde_json::json!({"type": "openSource", "item": item.0}),
        Event::RevealInProject(item) => {
            serde_json::json!({"type": "revealInProject", "item": item.0})
        }
        Event::JobProgress {
            id,
            kind,
            label,
            progress,
            done,
            cancelled,
            error,
        } => serde_json::json!({
            "type": "jobProgress",
            "id": id,
            "kind": kind,
            "label": label,
            "progress": progress,
            "done": done,
            "cancelled": cancelled,
            "error": error,
        }),
    }
}

#[napi(object)]
pub struct Frame {
    pub width: u32,
    pub height: u32,
    /// sRGB RGBA8, 불투명(검정 위에 합성).
    pub rgba: Buffer,
}

#[napi]
pub struct Engine {
    session: Session,
}

#[napi]
impl Engine {
    #[napi(constructor)]
    pub fn new() -> Self {
        register_hardware_decoders();
        Self {
            session: Session::new(Arc::new(FsServices)),
        }
    }

    /// 커맨드 실행. `params_json` 은 JSON 객체 문자열(없으면 `{}`). 결과도 JSON 문자열.
    #[napi]
    pub fn execute(&mut self, id: String, params_json: Option<String>) -> Result<String> {
        let params = match params_json {
            Some(s) if !s.trim().is_empty() => {
                serde_json::from_str(&s).map_err(|e| Error::from_reason(format!("params: {e}")))?
            }
            _ => serde_json::Value::Object(Default::default()),
        };
        let out = self
            .session
            .execute(&id, params)
            .map_err(|e| Error::from_reason(e.to_string()))?;
        Ok(out.to_string())
    }

    #[napi]
    pub fn is_enabled(&self, id: String) -> bool {
        self.session.is_enabled(&id)
    }

    #[napi]
    pub fn undo(&mut self) -> Option<String> {
        self.session.undo()
    }

    #[napi]
    pub fn redo(&mut self) -> Option<String> {
        self.session.redo()
    }

    #[napi]
    pub fn is_dirty(&self) -> bool {
        self.session.is_dirty()
    }

    /// 자동 저장과 크래시 복구 저널을 시작한다. `data_dir` 아래에 preferences.json, Auto-Save/, Recovery/ 가 생긴다.
    /// 이전 세션이 남긴 복구 후보는 이후 `file.recoveryList` 커맨드로 읽는다. `local_offset_seconds` 는 로컬 UTC 오프셋.
    #[napi]
    pub fn start_autosave(&mut self, data_dir: String, local_offset_seconds: i32) -> Result<()> {
        LOCAL_OFFSET_SECONDS.store(local_offset_seconds, Ordering::Relaxed);
        let cfg = AutosaveConfig {
            local_offset,
            ..AutosaveConfig::new(data_dir)
        };
        self.session
            .start_autosave(cfg)
            .map_err(|e| Error::from_reason(e.to_string()))
    }

    /// 자동 저장 워커와 백그라운드 작업(프록시·내보내기 큐)의 알림을 반영한다. 호스트가 주기적으로 부른다.
    #[napi]
    pub fn poll_persistence(&mut self) {
        self.session.poll_persistence();
    }

    /// 정상 종료. 저장하지 않은 변경이 있으면 저널을 남기고(다음 시작 때 복구 후보), 없으면 세션 디렉토리를 지운다.
    #[napi]
    pub fn shutdown(&mut self) {
        self.session.shutdown();
    }

    /// 플레이헤드 위치(tick). 1초 = 254,016,000,000 tick.
    #[napi]
    pub fn playhead(&self) -> i64 {
        self.session.playhead().0
    }

    #[napi]
    pub fn set_playhead(&mut self, tick: i64) {
        self.session.set_playhead(Tick(tick));
    }

    /// 백그라운드 작업(미리보기·프록시·자동 저장)을 `budget_ms` 안에서 진행. 더 할 일이 있으면 true.
    #[napi]
    pub fn pump_jobs(&mut self, budget_ms: u32) -> bool {
        self.session
            .pump_jobs(std::time::Duration::from_millis(u64::from(budget_ms)))
    }

    /// 프로그램 모니터 프레임. `scale` 은 시퀀스 해상도 대비 비율(1.0 = 원본, 0.5 = 절반).
    /// 시퀀스가 없으면 None.
    #[napi]
    pub fn render_frame(&self, tick: i64, scale: f64) -> Option<Frame> {
        // 재생 중이면 읽어 두기(playbackStart)가 준비한 프레임을 그대로 쓴다
        let (w, h, rgba) = self
            .session
            .render_program_rgba8(scale as f32, Tick(tick))?;
        Some(Frame {
            width: u32::try_from(w).ok()?,
            height: u32::try_from(h).ok()?,
            rgba: Buffer::from(rgba),
        })
    }

    /// 재생 읽어 두기 시작: `tick` 부터 `rate` 방향·보폭(2 = 한 프레임 건너, 음수 = 뒤로)으로 `scale` 프레임을
    /// 백그라운드 스레드가 미리 그린다(docs/guides/playback.md). 시퀀스가 없으면 오류.
    #[napi]
    pub fn playback_start(&self, tick: i64, rate: f64, scale: f64) -> Result<()> {
        self.session
            .playback_start(Tick(tick), rate, scale as f32)
            .map_err(|e| Error::from_reason(e.to_string()))
    }

    /// 정지 중 미리 준비: `tick` 부터 몇 프레임을 그려 두어 다음 재생이 바로 시작한다(디코더 열기 포함).
    #[napi]
    pub fn playback_prepare(&self, tick: i64, scale: f64) -> Result<()> {
        self.session
            .playback_prepare(Tick(tick), scale as f32)
            .map_err(|e| Error::from_reason(e.to_string()))
    }

    /// 읽어 두기 멈춤(준비한 프레임은 버린다).
    #[napi]
    pub fn playback_stop(&self) {
        self.session.playback_stop();
    }

    /// 읽어 두기 상태 JSON `{active, playing, ready, target, bytes, hits, misses, rendered, warmed}`.
    /// 재생 시작 전 `ready >= target` 까지 기다리면 프리롤이다.
    #[napi]
    pub fn playback_status(&self) -> String {
        self.session.playback_status().to_string()
    }

    /// wasm 과 같은 모양. 네이티브는 스레드가 일하므로 항상 false.
    #[napi]
    pub fn playback_pump(&self, budget_ms: u32) -> bool {
        self.session
            .playback_pump(std::time::Duration::from_millis(u64::from(budget_ms)))
    }

    /// 활성 시퀀스의 믹스를 `tick` 부터 `frames` 프레임, interleaved 스테레오 f32 PCM 으로(길이 `frames * 2`).
    /// `sample_rate` 기본 48000(시퀀스 레이트와 다르면 리샘플). 시퀀스가 없으면 무음. 한 번에 최대 10초.
    #[napi]
    pub fn render_audio(&self, tick: i64, frames: u32, sample_rate: Option<u32>) -> Float32Array {
        Float32Array::new(audio::render_audio(
            &self.session,
            tick,
            frames as usize,
            sample_rate.unwrap_or(audio::DEFAULT_SAMPLE_RATE),
        ))
    }

    /// 미디어 항목 `item` 의 파형: 초당 `per_second` 칸의 min/max 피크(interleaved `[min, max]`). 소리가 없으면 빈 배열.
    #[napi]
    pub fn audio_peaks(&self, item: i64, per_second: u32) -> Float32Array {
        let Ok(item) = u64::try_from(item) else {
            return Float32Array::new(Vec::new());
        };
        Float32Array::new(audio::audio_peaks(&self.session, item, per_second))
    }

    /// 쌓인 엔진 이벤트(프로젝트 변경·토스트·시퀀스 열기)를 비워 JSON 배열 문자열 `[{type, ...}]` 로. 모양은 `event_json`.
    #[napi]
    pub fn drain_events(&mut self) -> String {
        serde_json::Value::Array(
            self.session
                .drain_events()
                .into_iter()
                .map(event_json)
                .collect(),
        )
        .to_string()
    }

    /// 미디어 항목(영상·사진·시퀀스)의 썸네일. `tick` 은 미디어 시간이고 음수면 포스터 프레임(없으면 0).
    /// `width` 픽셀 폭으로 축소한다(확대는 하지 않음, 상한 1024). 소리만 있는 항목·없는 항목은 오류.
    #[napi]
    pub fn render_item_thumbnail(&self, item: i64, tick: i64, width: u32) -> Result<Frame> {
        let id =
            u64::try_from(item).map_err(|_| Error::from_reason("item id must be non-negative"))?;
        let t = (tick >= 0).then_some(Tick(tick));
        let img = self
            .session
            .render_item_thumbnail(ItemId(id), t, width)
            .map_err(|e| Error::from_reason(e.to_string()))?;
        let (w, h) = u32::try_from(img.w)
            .ok()
            .zip(u32::try_from(img.h).ok())
            .ok_or_else(|| Error::from_reason("thumbnail too large"))?;
        Ok(Frame {
            width: w,
            height: h,
            rgba: Buffer::from(img.over_black_rgba8()),
        })
    }

    /// [feature `stt`] 미디어 항목 `item` 의 소리를 Whisper 모델 `model` 로 인식한다. 소리는 여기서 동기로 읽고 인식은
    /// libuv 스레드에서 돌아 세션은 막히지 않는다. `language` 는 `"ko"` 같은 ISO 639-1, 없거나 `"auto"` 면 감지.
    /// `progress` 는 `(p: SttProgress) => void`, `signal` 로 취소. 결과는 엔진 `Transcript` JSON 문자열
    /// (`transcript.set` 의 `transcript`). 상세는 `stt.rs`.
    #[cfg(feature = "stt")]
    #[napi(ts_return_type = "Promise<string>")]
    pub fn transcribe_item(
        &self,
        item: i64,
        model: String,
        language: Option<String>,
        progress: Option<stt::Progress>,
        signal: Option<AbortSignal>,
    ) -> Result<AsyncTask<stt::Transcribe>> {
        stt::transcribe_item(&self.session, item, model, language, progress, signal)
    }
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}
