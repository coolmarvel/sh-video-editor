//! WebAssembly 바인딩. 브라우저의 React 화면이 Worker 안에서 import 한다.
//! napi 바인딩과 같은 모양의 API 를 유지한다(한 화면 코드가 두 호스트에서 돈다).
//! 파일 접근은 호스트(JS)가 Blob 을 등록하는 메모리 서비스로 한다(1차: 파일 없음).

use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};

use filmcraft_engine::{Services, Session, command_specs};
use filmcraft_time::Tick;
use wasm_bindgen::prelude::*;

pub const BASE_ENGINE: &str = "filmcraft 0.2.1";

/// 호스트가 `put_file(path, bytes)` 로 넣어 준 파일만 읽는 메모리 파일 서비스.
#[derive(Default)]
struct MemServices {
    files: Mutex<HashMap<String, Arc<Vec<u8>>>>,
}

impl MemServices {
    fn put(&self, path: &str, data: Vec<u8>) {
        self.files.lock().unwrap_or_else(PoisonError::into_inner).insert(path.to_string(), Arc::new(data));
    }
}

impl Services for MemServices {
    fn read_file(&self, path: &str) -> std::io::Result<Vec<u8>> {
        self.files
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(path)
            .map(|d| d.as_ref().clone())
            .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, format!("{path}: not registered")))
    }
    fn write_file(&self, path: &str, data: &[u8]) -> std::io::Result<()> {
        self.put(path, data.to_vec());
        Ok(())
    }
    fn export_in_memory(&self) -> bool {
        true
    }
}

#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub fn engine_version() -> String {
    format!("sh-video-engine {} (base {BASE_ENGINE}, wasm)", env!("CARGO_PKG_VERSION"))
}

#[wasm_bindgen]
pub fn command_catalog() -> String {
    let specs: Vec<serde_json::Value> = command_specs()
        .iter()
        .map(|c| serde_json::json!({ "id": c.id, "label": c.label, "menu": c.menu, "shortcut": c.shortcut, "params": c.params }))
        .collect();
    serde_json::Value::Array(specs).to_string()
}

#[wasm_bindgen]
pub struct Engine {
    session: Session,
    services: Arc<MemServices>,
}

#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Engine {
        let services = Arc::new(MemServices::default());
        Engine { session: Session::new(services.clone()), services }
    }

    /// 호스트의 파일(Blob 을 읽은 바이트)을 엔진 파일 공간에 등록한다.
    #[wasm_bindgen(js_name = putFile)]
    pub fn put_file(&self, path: &str, data: &[u8]) {
        self.services.put(path, data.to_vec());
    }

    pub fn execute(&mut self, id: &str, params_json: Option<String>) -> Result<String, JsError> {
        let params = match params_json {
            Some(s) if !s.trim().is_empty() => serde_json::from_str(&s).map_err(|e| JsError::new(&format!("params: {e}")))?,
            _ => serde_json::Value::Object(Default::default()),
        };
        let out = self.session.execute(id, params).map_err(|e| JsError::new(&e.to_string()))?;
        Ok(out.to_string())
    }

    #[wasm_bindgen(js_name = isEnabled)]
    pub fn is_enabled(&self, id: &str) -> bool {
        self.session.is_enabled(id)
    }

    pub fn undo(&mut self) -> Option<String> {
        self.session.undo()
    }

    #[wasm_bindgen(js_name = isDirty)]
    pub fn is_dirty(&self) -> bool {
        self.session.is_dirty()
    }

    /// napi 와 같은 모양. 브라우저에는 스레드·파일 잠금이 없어 자동 저장 저널을 시작할 수 없다(OPFS 저장은 호스트 몫).
    #[wasm_bindgen(js_name = startAutosave)]
    pub fn start_autosave(&mut self, _data_dir: &str, _local_offset_seconds: i32) -> Result<(), JsError> {
        Err(JsError::new("auto save is not available in the browser build"))
    }

    /// 백그라운드 작업(프록시·내보내기 큐)의 알림을 반영한다. 호스트가 주기적으로 부른다.
    #[wasm_bindgen(js_name = pollPersistence)]
    pub fn poll_persistence(&mut self) {
        self.session.poll_persistence();
    }

    pub fn shutdown(&mut self) {
        self.session.shutdown();
    }

    pub fn redo(&mut self) -> Option<String> {
        self.session.redo()
    }

    pub fn playhead(&self) -> i64 {
        self.session.playhead().0
    }

    #[wasm_bindgen(js_name = setPlayhead)]
    pub fn set_playhead(&mut self, tick: i64) {
        self.session.set_playhead(Tick(tick));
    }

    #[wasm_bindgen(js_name = pumpJobs)]
    pub fn pump_jobs(&mut self, budget_ms: u32) -> bool {
        self.session.pump_jobs(std::time::Duration::from_millis(u64::from(budget_ms)))
    }

    /// 프레임을 `[w, h]` 와 RGBA8 바이트로. 시퀀스가 없으면 빈 배열.
    #[wasm_bindgen(js_name = renderFrame)]
    pub fn render_frame(&self, tick: i64, scale: f32) -> Vec<u8> {
        let Some(img) = self.session.render_program_at(scale, Tick(tick)) else { return Vec::new() };
        let (Ok(w), Ok(h)) = (u32::try_from(img.w), u32::try_from(img.h)) else { return Vec::new() };
        let mut out = Vec::with_capacity(8 + img.w * img.h * 4);
        out.extend_from_slice(&w.to_le_bytes());
        out.extend_from_slice(&h.to_le_bytes());
        out.extend_from_slice(&img.over_black_rgba8());
        out
    }
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}
