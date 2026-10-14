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

/// 이식한 기반 엔진의 출처·버전. 바인딩 버전은 `CARGO_PKG_VERSION`.
pub const BASE_ENGINE: &str = "filmcraft 0.2.1";

/// 호스트가 알려 준 로컬 UTC 오프셋(초). 자동 저장 파일 이름의 시각에 쓴다.
static LOCAL_OFFSET_SECONDS: AtomicI32 = AtomicI32::new(0);

fn local_offset(_unix: i64) -> i32 {
    LOCAL_OFFSET_SECONDS.load(Ordering::Relaxed)
}

#[napi]
pub fn engine_version() -> String {
    format!("sh-video-engine {} (base {BASE_ENGINE})", env!("CARGO_PKG_VERSION"))
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
pub fn event_json(e: Event) -> serde_json::Value {
    match e {
        Event::ProjectChanged { revision } => serde_json::json!({"type": "projectChanged", "revision": revision}),
        Event::Toast { message, error } => serde_json::json!({"type": "toast", "message": message, "error": error}),
        Event::OpenSequence(item) => serde_json::json!({"type": "openSequence", "item": item.0}),
        Event::OpenSource(item) => serde_json::json!({"type": "openSource", "item": item.0}),
        Event::RevealInProject(item) => serde_json::json!({"type": "revealInProject", "item": item.0}),
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
        Self { session: Session::new(Arc::new(FsServices)) }
    }

    /// 커맨드 실행. `params_json` 은 JSON 객체 문자열(없으면 `{}`). 결과도 JSON 문자열.
    #[napi]
    pub fn execute(&mut self, id: String, params_json: Option<String>) -> Result<String> {
        let params = match params_json {
            Some(s) if !s.trim().is_empty() => serde_json::from_str(&s).map_err(|e| Error::from_reason(format!("params: {e}")))?,
            _ => serde_json::Value::Object(Default::default()),
        };
        let out = self.session.execute(&id, params).map_err(|e| Error::from_reason(e.to_string()))?;
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
        let cfg = AutosaveConfig { local_offset, ..AutosaveConfig::new(data_dir) };
        self.session.start_autosave(cfg).map_err(|e| Error::from_reason(e.to_string()))
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
        self.session.pump_jobs(std::time::Duration::from_millis(u64::from(budget_ms)))
    }

    /// 프로그램 모니터 프레임. `scale` 은 시퀀스 해상도 대비 비율(1.0 = 원본, 0.5 = 절반).
    /// 시퀀스가 없으면 None.
    #[napi]
    pub fn render_frame(&self, tick: i64, scale: f64) -> Option<Frame> {
        let img = self.session.render_program_at(scale as f32, Tick(tick))?;
        let (w, h) = (u32::try_from(img.w).ok()?, u32::try_from(img.h).ok()?);
        Some(Frame { width: w, height: h, rgba: Buffer::from(img.over_black_rgba8()) })
    }

    /// 쌓인 엔진 이벤트(프로젝트 변경·토스트·시퀀스 열기)를 비워 JSON 배열 문자열 `[{type, ...}]` 로. 모양은 `event_json`.
    #[napi]
    pub fn drain_events(&mut self) -> String {
        serde_json::Value::Array(self.session.drain_events().into_iter().map(event_json).collect()).to_string()
    }

    /// 미디어 항목(영상·사진·시퀀스)의 썸네일. `tick` 은 미디어 시간이고 음수면 포스터 프레임(없으면 0).
    /// `width` 픽셀 폭으로 축소한다(확대는 하지 않음, 상한 1024). 소리만 있는 항목·없는 항목은 오류.
    #[napi]
    pub fn render_item_thumbnail(&self, item: i64, tick: i64, width: u32) -> Result<Frame> {
        let id = u64::try_from(item).map_err(|_| Error::from_reason("item id must be non-negative"))?;
        let t = (tick >= 0).then_some(Tick(tick));
        let img = self.session.render_item_thumbnail(ItemId(id), t, width).map_err(|e| Error::from_reason(e.to_string()))?;
        let (w, h) = u32::try_from(img.w).ok().zip(u32::try_from(img.h).ok()).ok_or_else(|| Error::from_reason("thumbnail too large"))?;
        Ok(Frame { width: w, height: h, rgba: Buffer::from(img.over_black_rgba8()) })
    }
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}
