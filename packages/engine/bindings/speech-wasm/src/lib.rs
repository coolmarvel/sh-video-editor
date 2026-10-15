//! 웹 자동 자막(브라우저): 엔진의 Whisper(`filmcraft_speech`, candle, CPU)만 담은 작은 wasm 모듈. 편집 로직은 없다.
//!
//! 엔진 wasm(`sh-video-engine-wasm`)과 따로 음성 전용 Worker(`apps/web/src/stt.worker.ts`)에서 돈다. 인식은 수십 초 걸리는
//! 동기 계산이라 엔진 Worker 에서 돌리면 그동안 미리보기·편집이 멈추기 때문이다. 흐름: 엔진 Worker 가 `itemAudio16k` 로 항목의
//! 소리(모노 16 kHz)를 꺼내고, 이 모듈이 인식해 `Transcript` JSON 을 돌려주면 화면이 엔진 `transcript.set` 으로 넣는다
//! (데스크톱의 napi `transcribeItem` 과 같은 결과 모양).
//!
//! 모델 가중치는 내려받기 전 사용자 동의를 받고(화면의 동의 대화상자) OPFS 에 둔다. 파일마다 SHA-256 을 [`Sha256Stream`] 으로
//! 조각 단위 검증한다(수백 MB 를 한 번에 메모리에 올리지 않는다). 웹에서 쓸 수 있는 모델은 [`WEB_MODELS`](tiny·base)뿐이다.

use filmcraft_speech::whisper::Whisper;
use filmcraft_speech::{Options, SpeechError, Transcriber, models};
use serde_json::json;
use sha2::{Digest, Sha256};
use wasm_bindgen::prelude::*;

/// 브라우저에서 쓸 수 있는 모델. small(가중치 967MB)은 wasm32 메모리(4GB)에서 가중치 사본과 추론 버퍼까지 2GB 를 넘고
/// 단일 스레드로 재생 시간보다 느려 빼 둔다(측정은 docs/guides/packaging.md "웹" 절).
pub const WEB_MODELS: [&str; 2] = ["whisper-tiny", "whisper-base"];

#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}

/// 웹에서 쓸 수 있는 모델 카탈로그(JSON 배열): id, 이름, 다국어 여부, 설명, 라이선스, 출처, 크기와 파일마다 이름·URL·SHA-256·크기.
/// URL 은 Hugging Face 의 고정 리비전이다(엔진 카탈로그 `filmcraft_speech::models` 그대로).
#[wasm_bindgen(js_name = webModels)]
pub fn web_models() -> String {
    web_models_json().to_string()
}

fn web_models_json() -> serde_json::Value {
    let list: Vec<_> = WEB_MODELS
        .iter()
        .filter_map(|id| models::find(id))
        .map(|m| {
            json!({
                "id": m.id, "name": m.name, "multilingual": m.multilingual, "description": m.description,
                "license": m.license, "source": m.source, "size": m.size(),
                "files": m.files.iter().map(|f| json!({"name": f.name, "url": f.url, "sha256": f.sha256, "size": f.size})).collect::<Vec<_>>(),
            })
        })
        .collect();
    json!(list)
}

/// 조각 단위 SHA-256(내려받은 파일 검증). `update` 를 여러 번 부르고 `finish` 로 16진 문자열을 받는다.
#[wasm_bindgen]
pub struct Sha256Stream(Option<Sha256>);

#[wasm_bindgen]
impl Sha256Stream {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Sha256Stream {
        Sha256Stream(Some(Sha256::new()))
    }

    pub fn update(&mut self, data: &[u8]) {
        if let Some(h) = self.0.as_mut() {
            h.update(data);
        }
    }

    /// 16진 소문자. 두 번 부르면 빈 문자열.
    pub fn finish(&mut self) -> String {
        self.0.take().map(|h| hex(&h.finalize())).unwrap_or_default()
    }
}

impl Default for Sha256Stream {
    fn default() -> Self {
        Self::new()
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// 가중치 파일(`model.safetensors`, base 290MB)을 조각으로 받아 두는 wasm 쪽 버퍼. JS 가 파일 전체를 한 ArrayBuffer 로 읽고 다시
/// wasm 으로 복사하면 같은 바이트가 JS 힙에도 한 벌 더 생기므로(base 에서 약 290MB), Worker 는 8MB 조각씩 여기에 붓는다.
#[wasm_bindgen]
pub struct WeightsBuffer(Vec<u8>);

#[wasm_bindgen]
impl WeightsBuffer {
    /// `size` 바이트를 미리 잡는다(재할당 없이 채우게)
    #[wasm_bindgen(constructor)]
    pub fn new(size: usize) -> WeightsBuffer {
        WeightsBuffer(Vec::with_capacity(size))
    }

    pub fn push(&mut self, chunk: &[u8]) {
        self.0.extend_from_slice(chunk);
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    #[wasm_bindgen(js_name = isEmpty)]
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

/// 연 Whisper 모델 하나. 가중치는 생성자에 넘긴 바이트에서 텐서로 옮긴 뒤 바이트는 놓는다.
#[wasm_bindgen]
pub struct SpeechModel {
    whisper: Whisper,
}

#[wasm_bindgen]
impl SpeechModel {
    /// 모델 파일 네 개(`config.json`, `generation_config.json`, `tokenizer.json`, `model.safetensors`)의 바이트로 연다.
    #[wasm_bindgen(constructor)]
    pub fn new(id: &str, config: &[u8], generation_config: &[u8], tokenizer: &[u8], weights: Vec<u8>) -> Result<SpeechModel, JsError> {
        Self::open(id, config, generation_config, tokenizer, weights)
    }

    /// [`SpeechModel::new`] 과 같지만 가중치를 [`WeightsBuffer`] 에서 가져온다(버퍼는 비워진다). Worker 가 쓰는 경로.
    #[wasm_bindgen(js_name = fromBuffer)]
    pub fn from_buffer(id: &str, config: &[u8], generation_config: &[u8], tokenizer: &[u8], weights: &mut WeightsBuffer) -> Result<SpeechModel, JsError> {
        Self::open(id, config, generation_config, tokenizer, std::mem::take(&mut weights.0))
    }

    fn open(id: &str, config: &[u8], generation_config: &[u8], tokenizer: &[u8], weights: Vec<u8>) -> Result<SpeechModel, JsError> {
        if !WEB_MODELS.contains(&id) {
            return Err(JsError::new(&format!("the model `{id}` is not available in the browser")));
        }
        let whisper = Whisper::from_bytes(config, generation_config, tokenizer, weights, id).map_err(|e| JsError::new(&e.to_string()))?;
        Ok(SpeechModel { whisper })
    }

    /// 모노 16 kHz 소리를 인식해 엔진 `Transcript` JSON 문자열을 돌려준다. `language` 는 `"ko"` 같은 코드, 없거나 `"auto"` 면
    /// 첫 30초에서 감지. `progress(fraction, status)` 가 거짓을 돌려주면 멈추고 "stopped" 오류로 끝난다(취소).
    pub fn transcribe(&self, audio: &[f32], language: Option<String>, progress: &js_sys::Function) -> Result<String, JsError> {
        let opts = Options { language: language.filter(|l| !l.is_empty() && l != "auto"), diarize: false, max_speakers: 1 };
        let mut report = |f: f32, status: &str| -> bool {
            match progress.call2(&JsValue::NULL, &JsValue::from_f64(f64::from(f)), &JsValue::from_str(status)) {
                Ok(v) => v.is_truthy(),
                Err(_) => true,
            }
        };
        let mut t = self.whisper.transcribe(audio, &opts, &mut report).map_err(|e| match e {
            SpeechError::Cancelled => JsError::new("stopped"),
            e => JsError::new(&e.to_string()),
        })?;
        t.normalize();
        serde_json::to_string(&t).map_err(|e| JsError::new(&e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn web_catalogue_has_tiny_and_base_with_pinned_files() {
        let v = web_models_json();
        let ids: Vec<&str> = v.as_array().map(|a| a.iter().filter_map(|m| m["id"].as_str()).collect()).unwrap_or_default();
        assert_eq!(ids, WEB_MODELS);
        for m in v.as_array().into_iter().flatten() {
            let files = m["files"].as_array().map(|f| f.len()).unwrap_or(0);
            assert_eq!(files, 4, "{m}");
            assert!(m["files"][0]["url"].as_str().is_some_and(|u| u.starts_with("https://huggingface.co/openai/")));
        }
    }

    #[test]
    fn sha256_stream_matches_one_shot() {
        let mut s = Sha256Stream::new();
        s.update(b"hello ");
        s.update(b"world");
        assert_eq!(s.finish(), "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
        assert_eq!(s.finish(), "");
    }
}
