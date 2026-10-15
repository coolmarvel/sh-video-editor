//! sh-video-editor: interchange documents in a build without the `interchange` feature (the web).
//! The commands stay in the catalog (desktop and web list the same commands) and answer that the
//! format is not in this build; `file.import` never takes a media file for a document.

use serde_json::Value;

use crate::{EngineError, Result, Session};

/// No interchange format exists in this build.
#[derive(Clone, Copy, Debug)]
pub enum Format {}

fn unavailable() -> EngineError {
    EngineError::Other("interchange documents (EDL, XML, FCPXML, OTIO, AAF, OMF, ALE) are not available in this build: use the desktop app".into())
}

pub fn detect(_path: &str, _bytes: &[u8]) -> Option<Format> {
    None
}

pub fn import(_s: &mut Session, _path: &str, _bytes: &[u8], format: Format) -> Result<Value> {
    match format {}
}

pub fn export(_s: &mut Session, _p: &Value) -> Result<Value> {
    Err(unavailable())
}

pub fn export_aaf(_s: &mut Session, _p: &Value) -> Result<Value> {
    Err(unavailable())
}

pub fn export_omf(_s: &mut Session, _p: &Value) -> Result<Value> {
    Err(unavailable())
}

pub fn import_document(_s: &mut Session, _p: &Value, _cmd: &str) -> Result<Value> {
    Err(unavailable())
}

/// `file.exportAle` (project_tools).
pub fn export_ale(_s: &mut Session, _p: &Value) -> Result<Value> {
    Err(unavailable())
}
