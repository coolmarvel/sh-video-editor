//! WebAssembly 바인딩. 브라우저의 React 화면이 Worker 안에서 import 한다.
//! napi 바인딩과 같은 모양의 API 를 유지하고, 웹 전용 메서드(`registerBlob` 등)만 더한다.
//!
//! 파일 접근은 [`WebServices`] 가 맡는다. 엔진이 돌아가는 Worker 는 파일시스템이 없으므로
//! 가상 파일 표(경로 -> 항목)를 두고,
//! - 사용자가 고른 `File`/`Blob` 은 바이트를 복사하지 않고 핸들만 등록한다. 컨테이너(MP4/MOV, MKV)는
//!   `Services::reader` 로 얻는 [`BlobReader`] 를 통해 인덱스와 샘플만 범위 읽기 한다. 읽기는 Worker 의
//!   `FileReaderSync` 로 동기 처리하고, 1 MiB 청크 LRU 캐시([`CACHE_BUDGET`])가 잦은 작은 읽기를 흡수한다.
//!   수 GB 파일도 wasm 메모리에 통째로 올라오지 않는다.
//! - 엔진이 쓰는 파일(내보내기 결과, 저장한 프로젝트)은 메모리 항목으로 두고 쓰기 훅(`setWriteHook`)에
//!   알린다. 훅이 `true` 를 돌려주면(호스트가 바이트를 가져감) 항목을 남기지 않는다. 훅이 없으면
//!   `takeWrittenFile` 로 꺼내 갈 때까지 보관한다.
//! - `opfs:/` 로 시작하는 경로의 쓰기는 OPFS 훅(`setOpfsWriteHook`)으로 넘긴다(호스트가 비동기로 기록).
//!   같은 접두 경로의 읽기는 호스트가 `putFile` 로 미리 올려 둔 바이트를 돌려준다(OPFS 읽기는 비동기라
//!   동기 `read_file` 안에서 직접 할 수 없다. Worker 가 커맨드 실행 전에 미리 읽어 둔다).
//!
//! 표는 Worker 스레드의 thread_local 에 엔진 id 별로 있다(JS 핸들은 스레드를 넘지 못하므로 `Services`
//! 가 요구하는 `Send + Sync` 를 id 만 들고 만족시킨다).

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::io;
use std::sync::Arc;

use filmcraft_engine::{Event, Services, Session, command_specs};
use filmcraft_media::reader::{ByteReader, MemReader, SharedReader};
use filmcraft_project::ItemId;
use filmcraft_time::Tick;
use wasm_bindgen::prelude::*;

pub const BASE_ENGINE: &str = "filmcraft 0.2.1";

/// Blob 범위 읽기의 청크 크기.
pub const CHUNK: u64 = 1 << 20;
/// 청크 캐시 상한(바이트). 넘으면 오래 쓰지 않은 청크부터 버린다.
pub const CACHE_BUDGET: usize = 64 << 20;
/// `read_file` 이 Blob 을 통째로 읽어 주는 최대 크기(자막, 프로젝트 파일, 스틸·WAV 폴백).
pub const WHOLE_FILE_MAX: u64 = 256 << 20;
/// 이 크기 이상의 한 번 읽기는 캐시를 거치지 않고 바로 Blob 에서 읽는다(스틸·WAV 통째 읽기).
const DIRECT_READ_MIN: usize = 4 << 20;
/// OPFS 로 가는 경로의 접두.
pub const OPFS_PREFIX: &str = "opfs:/";

// Worker 안에서만 쓸 수 있는 동기 Blob 읽기. 바인딩 글루 옆의 snippets/ 로 함께 배포된다.
#[wasm_bindgen(inline_js = r#"
export function blobSize(blob) { return blob.size; }
export function readBlobRange(blob, offset, len) {
  const reader = new FileReaderSync();
  const buf = reader.readAsArrayBuffer(blob.slice(offset, offset + len));
  return new Uint8Array(buf);
}
"#)]
extern "C" {
    #[wasm_bindgen(js_name = blobSize, catch)]
    fn blob_size(blob: &JsValue) -> Result<f64, JsValue>;
    #[wasm_bindgen(js_name = readBlobRange, catch)]
    fn read_blob_range(blob: &JsValue, offset: f64, len: f64) -> Result<js_sys::Uint8Array, JsValue>;
}

enum Entry {
    /// 호스트의 `File`/`Blob` 핸들. 바이트는 요청한 범위만 읽는다.
    Blob { id: u32, handle: JsValue, size: u64 },
    /// 메모리 파일(엔진이 쓴 파일, `putFile`, OPFS 에서 미리 읽어 둔 파일).
    Mem(Arc<[u8]>),
}

/// 범위 읽기 통계. `ioStats()` 로 JSON 으로 꺼낸다(범위 읽기가 실제로 일어났다는 증거).
#[derive(Default, Clone, Copy)]
struct IoStats {
    /// Blob 에서 실제로 읽어 온 횟수(청크 단위 또는 직접 읽기).
    blob_reads: u64,
    /// Blob 에서 실제로 읽어 온 바이트 합.
    blob_bytes: u64,
    /// `read_at` 호출 횟수.
    range_reads: u64,
    /// 캐시에서 바로 채운 청크 수.
    chunk_hits: u64,
}

/// 캐시한 청크: (바이트, 마지막 사용 시각).
type CachedChunk = (Arc<[u8]>, u64);

#[derive(Default)]
struct Table {
    entries: HashMap<String, Entry>,
    next_blob: u32,
    /// (blob id, 청크 번호) -> 청크
    chunks: HashMap<(u32, u64), CachedChunk>,
    cache_bytes: usize,
    clock: u64,
    stats: IoStats,
    on_write: Option<js_sys::Function>,
    on_opfs_write: Option<js_sys::Function>,
}

impl Table {
    fn touch(&mut self) -> u64 {
        self.clock = self.clock.wrapping_add(1);
        self.clock
    }

    fn insert_chunk(&mut self, key: (u32, u64), data: Arc<[u8]>) {
        let t = self.touch();
        self.cache_bytes = self.cache_bytes.saturating_add(data.len());
        if let Some((old, _)) = self.chunks.insert(key, (data, t)) {
            self.cache_bytes = self.cache_bytes.saturating_sub(old.len());
        }
        self.evict();
    }

    fn evict(&mut self) {
        if self.cache_bytes <= CACHE_BUDGET {
            return;
        }
        let mut all: Vec<((u32, u64), u64, usize)> = self.chunks.iter().map(|(k, (d, t))| (*k, *t, d.len())).collect();
        all.sort_unstable_by_key(|x| x.1);
        for (k, _, n) in all {
            if self.cache_bytes <= CACHE_BUDGET / 10 * 9 {
                break;
            }
            self.chunks.remove(&k);
            self.cache_bytes = self.cache_bytes.saturating_sub(n);
        }
    }

    fn drop_blob(&mut self, id: u32) {
        self.chunks.retain(|k, _| k.0 != id);
        self.cache_bytes = self.chunks.values().map(|(d, _)| d.len()).sum();
    }
}

thread_local! {
    static TABLES: RefCell<HashMap<u32, Table>> = RefCell::new(HashMap::new());
    static NEXT_ENGINE: Cell<u32> = const { Cell::new(1) };
}

fn busy() -> io::Error {
    io::Error::other("file table is busy (re-entered from a host callback)")
}

fn with_table<R>(engine: u32, f: impl FnOnce(&mut Table) -> R) -> io::Result<R> {
    TABLES.with(|t| {
        let mut t = t.try_borrow_mut().map_err(|_| busy())?;
        Ok(f(t.entry(engine).or_default()))
    })
}

fn not_found(path: &str) -> io::Error {
    let hint = if path.starts_with(OPFS_PREFIX) { " (OPFS file not staged for this command)" } else { " (not registered in this browser session)" };
    io::Error::new(io::ErrorKind::NotFound, format!("{path}: not found{hint}"))
}

fn eof() -> io::Error {
    io::Error::new(io::ErrorKind::UnexpectedEof, "read past end of file")
}

fn js_err(what: &str, e: JsValue) -> io::Error {
    let msg = e.as_string().or_else(|| js_sys::Reflect::get(&e, &"message".into()).ok().and_then(|m| m.as_string())).unwrap_or_else(|| format!("{e:?}"));
    io::Error::other(format!("{what}: {msg}"))
}

/// Blob 에서 `[offset, offset + len)` 을 동기로 읽는다(호출자가 범위를 검사한다).
fn fetch_blob(handle: &JsValue, offset: u64, len: usize) -> io::Result<Vec<u8>> {
    let arr = read_blob_range(handle, offset as f64, len as f64).map_err(|e| js_err("blob read", e))?;
    let v = arr.to_vec();
    if v.len() != len {
        return Err(io::Error::other(format!("blob read returned {} bytes, expected {len}", v.len())));
    }
    Ok(v)
}

/// 등록된 Blob 의 랜덤 액세스 리더. 청크 캐시를 거쳐 요청한 범위만 읽는다.
struct BlobReader {
    engine: u32,
    id: u32,
    handle: JsValue,
    size: u64,
}

impl ByteReader for BlobReader {
    fn len(&self) -> u64 {
        self.size
    }

    fn read_at(&self, offset: u64, buf: &mut [u8]) -> io::Result<()> {
        if buf.is_empty() {
            return Ok(());
        }
        let end = offset.checked_add(buf.len() as u64).filter(|e| *e <= self.size).ok_or_else(eof)?;
        with_table(self.engine, |t| t.stats.range_reads = t.stats.range_reads.wrapping_add(1))?;
        if buf.len() >= DIRECT_READ_MIN {
            let v = fetch_blob(&self.handle, offset, buf.len())?;
            with_table(self.engine, |t| {
                t.stats.blob_reads = t.stats.blob_reads.wrapping_add(1);
                t.stats.blob_bytes = t.stats.blob_bytes.wrapping_add(v.len() as u64);
            })?;
            buf.copy_from_slice(&v);
            return Ok(());
        }
        let (c0, c1) = (offset / CHUNK, (end - 1) / CHUNK);
        let mut pos = 0usize;
        for c in c0..=c1 {
            let cached = with_table(self.engine, |t| {
                let now = t.touch();
                t.chunks.get_mut(&(self.id, c)).map(|(d, used)| {
                    *used = now;
                    d.clone()
                })
            })?;
            let data = match cached {
                Some(d) => {
                    with_table(self.engine, |t| t.stats.chunk_hits = t.stats.chunk_hits.wrapping_add(1))?;
                    d
                }
                None => {
                    let start = c.checked_mul(CHUNK).ok_or_else(eof)?;
                    let len = usize::try_from(CHUNK.min(self.size.saturating_sub(start))).map_err(|_| eof())?;
                    let v: Arc<[u8]> = fetch_blob(&self.handle, start, len)?.into();
                    with_table(self.engine, |t| {
                        t.stats.blob_reads = t.stats.blob_reads.wrapping_add(1);
                        t.stats.blob_bytes = t.stats.blob_bytes.wrapping_add(v.len() as u64);
                        t.insert_chunk((self.id, c), v.clone());
                    })?;
                    v
                }
            };
            let a = if c == c0 { usize::try_from(offset - c * CHUNK).map_err(|_| eof())? } else { 0 };
            let n = data.len().saturating_sub(a).min(buf.len().saturating_sub(pos));
            let (src, dst) = (data.get(a..a + n).ok_or_else(eof)?, buf.get_mut(pos..pos + n).ok_or_else(eof)?);
            dst.copy_from_slice(src);
            pos = pos.saturating_add(n);
        }
        if pos != buf.len() {
            return Err(eof());
        }
        Ok(())
    }
}

/// 브라우저 호스트의 파일 서비스. 실제 자료는 엔진 id 로 찾는 thread_local 표에 있다.
struct WebServices {
    engine: u32,
}

impl WebServices {
    fn entry_reader(&self, path: &str) -> io::Result<SharedReader> {
        with_table(self.engine, |t| match t.entries.get(path) {
            Some(Entry::Blob { id, handle, size }) => {
                Ok(Arc::new(BlobReader { engine: self.engine, id: *id, handle: handle.clone(), size: *size }) as SharedReader)
            }
            Some(Entry::Mem(b)) => Ok(Arc::new(MemReader(b.clone())) as SharedReader),
            None => Err(not_found(path)),
        })?
    }
}

impl Services for WebServices {
    fn read_file(&self, path: &str) -> io::Result<Vec<u8>> {
        let r = self.entry_reader(path)?;
        if r.len() > WHOLE_FILE_MAX {
            return Err(io::Error::other(format!("{path}: too large to read whole in the browser ({} bytes)", r.len())));
        }
        let len = usize::try_from(r.len()).map_err(|_| eof())?;
        filmcraft_media::reader::read_range(&*r, 0, len)
    }

    fn write_file(&self, path: &str, data: &[u8]) -> io::Result<()> {
        if let Some(rel) = path.strip_prefix(OPFS_PREFIX) {
            let hook = with_table(self.engine, |t| t.on_opfs_write.clone())?;
            let Some(hook) = hook else {
                return Err(io::Error::other(format!("{path}: no OPFS writer on this host")));
            };
            let bytes = js_sys::Uint8Array::from(data);
            hook.call2(&JsValue::NULL, &JsValue::from_str(rel), &bytes).map_err(|e| js_err("opfs write", e))?;
            return Ok(());
        }
        let hook = with_table(self.engine, |t| t.on_write.clone())?;
        let taken = match hook {
            Some(h) => {
                let bytes = js_sys::Uint8Array::from(data);
                h.call2(&JsValue::NULL, &JsValue::from_str(path), &bytes).map_err(|e| js_err("write hook", e))?.is_truthy()
            }
            None => false,
        };
        if !taken {
            with_table(self.engine, |t| t.entries.insert(path.to_string(), Entry::Mem(Arc::from(data))))?;
        }
        Ok(())
    }

    fn file_size(&self, path: &str) -> io::Result<u64> {
        self.entry_reader(path).map(|r| r.len())
    }

    fn read_range(&self, path: &str, offset: u64, len: usize) -> io::Result<Vec<u8>> {
        filmcraft_media::reader::read_range(&*self.entry_reader(path)?, offset, len)
    }

    fn reader(&self, path: &str) -> Option<io::Result<SharedReader>> {
        Some(self.entry_reader(path))
    }

    /// 가상 표의 같은 디렉토리 항목 이름. OPFS 디렉토리는 호스트(bridge 의 opfs.list)가 비동기로 나열한다.
    fn list_dir(&self, dir: &str) -> Option<io::Result<Vec<String>>> {
        if dir.starts_with(OPFS_PREFIX) {
            return None;
        }
        let prefix = if dir.ends_with('/') { dir.to_string() } else { format!("{dir}/") };
        Some(with_table(self.engine, |t| {
            let mut names: Vec<String> =
                t.entries.keys().filter_map(|p| p.strip_prefix(prefix.as_str())).filter(|r| !r.is_empty() && !r.contains('/')).map(str::to_string).collect();
            names.sort();
            names
        }))
    }

    fn export_in_memory(&self) -> bool {
        true
    }
}

/// 엔진 이벤트를 화면이 분류하기 쉬운 `{type, ...}` 객체로. napi 바인딩과 같은 모양이다.
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

/// `[w, h]` LE u32 머리 + RGBA8 바이트. Worker 가 풀어 `Frame` 으로 만든다.
fn pack_frame(img: &filmcraft_render::Image) -> Option<Vec<u8>> {
    let (w, h) = u32::try_from(img.w).ok().zip(u32::try_from(img.h).ok())?;
    let mut out = Vec::with_capacity(8 + img.w * img.h * 4);
    out.extend_from_slice(&w.to_le_bytes());
    out.extend_from_slice(&h.to_le_bytes());
    out.extend_from_slice(&img.over_black_rgba8());
    Some(out)
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
    id: u32,
}

#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Engine {
        let id = NEXT_ENGINE.with(|n| {
            let v = n.get();
            n.set(v.wrapping_add(1));
            v
        });
        let services = Arc::new(WebServices { engine: id });
        Engine { session: Session::new(services), id }
    }

    // ---------- 웹 전용: 파일 공간 ----------

    /// 호스트의 `File`/`Blob` 을 경로에 등록한다. 바이트는 복사하지 않고 핸들만 보관하며, 엔진이 요청하는
    /// 범위만 `FileReaderSync` 로 읽는다(Worker 전용). 같은 경로가 있으면 바꿔 끼운다. 크기(바이트)를 돌려준다.
    #[wasm_bindgen(js_name = registerBlob)]
    pub fn register_blob(&self, path: &str, blob: JsValue) -> Result<f64, JsError> {
        let size = blob_size(&blob).map_err(|e| JsError::new(&format!("registerBlob: {e:?}")))?;
        if !size.is_finite() || size < 0.0 {
            return Err(JsError::new("registerBlob: not a Blob"));
        }
        let size_u = size as u64;
        with_table(self.id, |t| {
            if let Some(Entry::Blob { id, .. }) = t.entries.get(path) {
                let old = *id;
                t.drop_blob(old);
            }
            let id = t.next_blob;
            t.next_blob = t.next_blob.wrapping_add(1);
            t.entries.insert(path.to_string(), Entry::Blob { id, handle: blob, size: size_u });
        })
        .map_err(|e| JsError::new(&e.to_string()))?;
        Ok(size)
    }

    /// 바이트를 메모리 파일로 등록한다(작은 파일, 테스트, OPFS 에서 미리 읽어 둔 프로젝트).
    #[wasm_bindgen(js_name = putFile)]
    pub fn put_file(&self, path: &str, data: &[u8]) -> Result<(), JsError> {
        with_table(self.id, |t| {
            if let Some(Entry::Blob { id, .. }) = t.entries.get(path) {
                let old = *id;
                t.drop_blob(old);
            }
            t.entries.insert(path.to_string(), Entry::Mem(Arc::from(data)));
        })
        .map_err(|e| JsError::new(&e.to_string()))
    }

    /// 경로를 표에서 지운다(청크 캐시 포함). 있었으면 `true`.
    #[wasm_bindgen(js_name = removeFile)]
    pub fn remove_file(&self, path: &str) -> Result<bool, JsError> {
        with_table(self.id, |t| match t.entries.remove(path) {
            Some(Entry::Blob { id, .. }) => {
                t.drop_blob(id);
                true
            }
            Some(Entry::Mem(_)) => true,
            None => false,
        })
        .map_err(|e| JsError::new(&e.to_string()))
    }

    /// 엔진이 쓴 파일(내보내기 결과 등)을 꺼내 간다. 표에서 지워지므로 한 번만 꺼낼 수 있다.
    /// 쓰기 훅이 바이트를 이미 가져갔거나(훅이 `true` 반환) 그런 경로가 없으면 `undefined`.
    #[wasm_bindgen(js_name = takeWrittenFile)]
    pub fn take_written_file(&self, path: &str) -> Result<Option<Vec<u8>>, JsError> {
        with_table(self.id, |t| match t.entries.get(path) {
            Some(Entry::Mem(b)) => {
                let v = b.to_vec();
                t.entries.remove(path);
                Some(v)
            }
            _ => None,
        })
        .map_err(|e| JsError::new(&e.to_string()))
    }

    /// 등록된 파일 목록을 JSON `[{path, size, kind: "blob"|"memory"}]` 로.
    #[wasm_bindgen(js_name = listFiles)]
    pub fn list_files(&self) -> Result<String, JsError> {
        let mut v = with_table(self.id, |t| {
            t.entries
                .iter()
                .map(|(p, e)| match e {
                    Entry::Blob { size, .. } => serde_json::json!({"path": p, "size": size, "kind": "blob"}),
                    Entry::Mem(b) => serde_json::json!({"path": p, "size": b.len(), "kind": "memory"}),
                })
                .collect::<Vec<_>>()
        })
        .map_err(|e| JsError::new(&e.to_string()))?;
        v.sort_by(|a, b| a["path"].as_str().cmp(&b["path"].as_str()));
        Ok(serde_json::Value::Array(v).to_string())
    }

    /// 엔진이 `write_file` 로 파일을 쓸 때 부를 훅 `(path: string, bytes: Uint8Array) => boolean`.
    /// `true` 를 돌려주면 바이트를 호스트가 가져간 것으로 보고 표에 남기지 않는다. 훅 안에서 엔진 메서드를
    /// 다시 부르면 안 된다(실행 중 재진입). `opfs:/` 경로는 이 훅이 아니라 OPFS 훅으로 간다.
    #[wasm_bindgen(js_name = setWriteHook)]
    pub fn set_write_hook(&self, hook: Option<js_sys::Function>) -> Result<(), JsError> {
        with_table(self.id, |t| t.on_write = hook).map_err(|e| JsError::new(&e.to_string()))
    }

    /// `opfs:/<rel>` 쓰기를 받을 훅 `(rel: string, bytes: Uint8Array) => void`. 호스트가 OPFS 에 비동기로 기록한다.
    #[wasm_bindgen(js_name = setOpfsWriteHook)]
    pub fn set_opfs_write_hook(&self, hook: Option<js_sys::Function>) -> Result<(), JsError> {
        with_table(self.id, |t| t.on_opfs_write = hook).map_err(|e| JsError::new(&e.to_string()))
    }

    /// 범위 읽기 통계 JSON `{rangeReads, blobReads, blobBytes, chunkHits, cacheBytes}`.
    #[wasm_bindgen(js_name = ioStats)]
    pub fn io_stats(&self) -> Result<String, JsError> {
        with_table(self.id, |t| {
            serde_json::json!({
                "rangeReads": t.stats.range_reads,
                "blobReads": t.stats.blob_reads,
                "blobBytes": t.stats.blob_bytes,
                "chunkHits": t.stats.chunk_hits,
                "cacheBytes": t.cache_bytes,
            })
            .to_string()
        })
        .map_err(|e| JsError::new(&e.to_string()))
    }

    // ---------- napi 와 같은 모양 ----------

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
        self.session.render_program_at(scale, Tick(tick)).and_then(|img| pack_frame(&img)).unwrap_or_default()
    }

    /// 쌓인 엔진 이벤트(프로젝트 변경·토스트·시퀀스 열기)를 비워 JSON 배열 문자열 `[{type, ...}]` 로. 모양은 `event_json`.
    #[wasm_bindgen(js_name = drainEvents)]
    pub fn drain_events(&mut self) -> String {
        serde_json::Value::Array(self.session.drain_events().into_iter().map(event_json).collect()).to_string()
    }

    /// 미디어 항목(영상·사진·시퀀스)의 썸네일을 `renderFrame` 과 같은 포장으로. `tick` 은 미디어 시간이고 음수면
    /// 포스터 프레임(없으면 0). `width` 픽셀 폭으로 축소한다(확대는 하지 않음, 상한 1024). 소리만 있는 항목·없는 항목은 오류.
    #[wasm_bindgen(js_name = renderItemThumbnail)]
    pub fn render_item_thumbnail(&self, item: u64, tick: i64, width: u32) -> Result<Vec<u8>, JsError> {
        let t = (tick >= 0).then_some(Tick(tick));
        let img = self.session.render_item_thumbnail(ItemId(item), t, width).map_err(|e| JsError::new(&e.to_string()))?;
        pack_frame(&img).ok_or_else(|| JsError::new("thumbnail too large"))
    }
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        TABLES.with(|t| {
            if let Ok(mut t) = t.try_borrow_mut() {
                t.remove(&self.id);
            }
        });
    }
}
