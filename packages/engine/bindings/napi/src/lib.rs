//! Node-API 바인딩. Electron 의 메인(나중에는 utility) 프로세스가 `require` 해서 쓴다.
//! 모든 편집 동작은 filmcraft 엔진의 커맨드(`Session::execute(id, params)`)로 들어간다.
//! 프레임은 sRGB RGBA8 `Buffer` 로 돌려주어 렌더러가 canvas 에 바로 그린다.

use std::sync::Arc;

use filmcraft_engine::{FsServices, Session, command_specs};
use filmcraft_time::Tick;
use napi::bindgen_prelude::*;
use napi_derive::napi;

/// 이식한 기반 엔진의 출처·버전. 바인딩 버전은 `CARGO_PKG_VERSION`.
pub const BASE_ENGINE: &str = "filmcraft 0.2.1";

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

    /// 엔진 이벤트(토스트·오류·진행률)를 비워 JSON 배열로.
    #[napi]
    pub fn drain_events(&mut self) -> String {
        let events: Vec<String> = self.session.drain_events().into_iter().map(|e| format!("{e:?}")).collect();
        serde_json::Value::Array(events.into_iter().map(serde_json::Value::String).collect()).to_string()
    }
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}
