//! 브라우저의 WebCodecs `VideoDecoder` 를 엔진의 디코더 레지스트리(`filmcraft_codecs::register_video_decoder`)에
//! 등록한다. 네이티브의 `filmcraft_platform::register`(VideoToolbox·Media Foundation)와 같은 자리다.
//!
//! 엔진의 디코더 trait 은 동기이고 WebCodecs 는 비동기라서, 호스트(apps/web/src/webcodecs.ts)가 디코더 전용
//! Worker 를 하나 더 두고 SharedArrayBuffer + `Atomics.wait` 로 동기 호출처럼 감싼 훅 객체를 [`set_hooks`] 로
//! 넘긴다. 이 모듈은 그 훅을 `avcC`/`hvcC` 샘플 엔트리에 대해 [`VideoDecoder`] 로 포장하고, 중간에 실패하면
//! 소프트웨어 디코더로 이어 가는 [`HybridDecoder`] 안에 넣는다. 훅이 없거나(격리 안 됨, VideoDecoder 없음)
//! 브라우저가 그 스트림을 못 받으면 팩토리가 `None` 을 돌려주고 다음 팩토리(소프트웨어)가 맡는다.
//! 설계·제약은 docs/guides/wasm-performance.md.
//!
//! 훅이 돌려주는 프레임 묶음(LE): `u32 count`, 프레임마다 `f64 pts, u32 width, u32 height, u32 format(0 I420, 1 NV12),
//! u32 len` 뒤에 `len` 바이트의 평면(타이트 스트라이드: Y w*h, 그 뒤 I420 은 U·V 각 cw*ch, NV12 는 UV 교차 cw*ch*2).

use std::cell::RefCell;
use std::sync::Arc;

use filmcraft_codecs::hw::{self, NalCodec, NalStreamInfo};
use filmcraft_codecs::{CodecError, DecodedFrame, Result, VideoDecoder};
use filmcraft_isobmff::{CodecConfig, SampleEntry};
use filmcraft_platform::HybridDecoder;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    /// 호스트가 만든 훅 객체(apps/web/src/webcodecs.ts 의 `WebCodecsHooks`). 모든 메서드는 동기다.
    pub type WebCodecsHooks;
    /// `VideoDecoder` 를 설정한다. `config` 는 JSON `{codec, codedWidth, codedHeight}`, `description` 은 avcC/hvcC.
    /// 지원하지 않으면 0 을 돌려주거나 던진다.
    #[wasm_bindgen(method, catch)]
    fn open(
        this: &WebCodecsHooks,
        config: &str,
        description: &[u8],
    ) -> std::result::Result<u32, JsValue>;
    /// 샘플 하나를 넣고 지금까지 나온 프레임 묶음을 돌려준다(없으면 count 0).
    #[wasm_bindgen(method, catch)]
    fn decode(
        this: &WebCodecsHooks,
        handle: u32,
        sample: &[u8],
        pts: f64,
        key: bool,
    ) -> std::result::Result<js_sys::Uint8Array, JsValue>;
    /// 남은 프레임을 모두 뽑는다.
    #[wasm_bindgen(method, catch)]
    fn flush(
        this: &WebCodecsHooks,
        handle: u32,
    ) -> std::result::Result<js_sys::Uint8Array, JsValue>;
    /// 디코더 상태를 비운다(탐색). 다음 샘플은 키 프레임이어야 한다.
    #[wasm_bindgen(method, catch)]
    fn reset(this: &WebCodecsHooks, handle: u32) -> std::result::Result<(), JsValue>;
    #[wasm_bindgen(method)]
    fn close(this: &WebCodecsHooks, handle: u32);
}

thread_local! {
    static HOOKS: RefCell<Option<WebCodecsHooks>> = const { RefCell::new(None) };
}

/// 훅을 설치하고 팩토리를 등록한다(두 번 불러도 팩토리는 한 번만 등록된다). `None` 이면 훅을 떼고, 이미 만들어진
/// 디코더는 다음 호출에서 실패해 소프트웨어로 넘어간다.
pub fn set_hooks(hooks: Option<WebCodecsHooks>) {
    let on = hooks.is_some();
    HOOKS.with(|h| *h.borrow_mut() = hooks);
    if on {
        filmcraft_codecs::register_video_decoder(webcodecs_factory);
        hw::set_hw_backend("WebCodecs");
    }
}

/// 훅이 설치돼 있는지.
pub fn enabled() -> bool {
    HOOKS.with(|h| h.borrow().is_some())
}

fn with_hooks<R>(f: impl FnOnce(&WebCodecsHooks) -> std::result::Result<R, JsValue>) -> Result<R> {
    HOOKS.with(|h| {
        let h = h.borrow();
        let hooks = h
            .as_ref()
            .ok_or_else(|| CodecError::Decode("WebCodecs hooks not installed".into()))?;
        f(hooks).map_err(|e| CodecError::Decode(format!("WebCodecs: {}", js_message(&e))))
    })
}

fn js_message(e: &JsValue) -> String {
    e.as_string()
        .or_else(|| {
            js_sys::Reflect::get(e, &"message".into())
                .ok()
                .and_then(|m| m.as_string())
        })
        .unwrap_or_else(|| format!("{e:?}"))
}

/// WebCodecs 의 codec 문자열(RFC 6381). H.264 는 `avc1.PPCCLL`, HEVC 는 `hev1.P.C.LTT.CC`(샘플 엔트리의 fourcc 를 따른다).
pub fn codec_string(entry: &SampleEntry) -> Option<String> {
    match &entry.codec {
        CodecConfig::Avc(a) => Some(format!(
            "avc1.{:02X}{:02X}{:02X}",
            a.profile, a.compatibility, a.level
        )),
        CodecConfig::Hevc(h) => {
            let prefix = match &entry.format.0 {
                b"hvc1" => "hvc1",
                _ => "hev1",
            };
            let space = ["", "A", "B", "C"]
                .get(usize::from(h.general_profile_space))
                .copied()
                .unwrap_or("");
            let compat = h.general_profile_compatibility_flags.reverse_bits();
            let tier = if h.general_tier_flag { 'H' } else { 'L' };
            let mut constraint: Vec<u8> =
                h.general_constraint_indicator_flags.to_be_bytes()[2..].to_vec();
            while constraint.len() > 1 && constraint.last() == Some(&0) {
                constraint.pop();
            }
            let constraint: Vec<String> = constraint.iter().map(|b| format!("{b:X}")).collect();
            Some(format!(
                "{prefix}.{space}{}.{compat:X}.{tier}{}.{}",
                h.general_profile_idc,
                h.general_level_idc,
                constraint.join(".")
            ))
        }
        _ => None,
    }
}

/// WebCodecs 디코더 하나. 샘플은 avcC/hvcC 길이 접두 그대로 넘긴다(`description` 을 준 WebCodecs 는 그 형식을 받는다).
struct WebDecoder {
    handle: u32,
    info: NalStreamInfo,
    name: &'static str,
}

impl WebDecoder {
    fn new(entry: &SampleEntry, info: &NalStreamInfo) -> Result<Self> {
        let codec = codec_string(entry)
            .ok_or_else(|| CodecError::Unsupported("not an avcC/hvcC stream".into()))?;
        let description = match &entry.codec {
            CodecConfig::Avc(a) => a.to_bytes(),
            CodecConfig::Hevc(h) => h.to_bytes(),
            _ => return Err(CodecError::Unsupported("not an avcC/hvcC stream".into())),
        };
        if info.interlaced
            || info.chroma_format_idc != 1
            || info.bit_depth_luma != 8
            || info.bit_depth_chroma != 8
        {
            return Err(CodecError::Unsupported(
                "WebCodecs path takes 8-bit 4:2:0 progressive streams only".into(),
            ));
        }
        let config = serde_json::json!({ "codec": codec, "codedWidth": info.coded.0, "codedHeight": info.coded.1 }).to_string();
        let handle = with_hooks(|h| h.open(&config, &description))?;
        if handle == 0 {
            return Err(CodecError::Unsupported(format!(
                "browser has no decoder for {codec}"
            )));
        }
        let name = match info.codec {
            NalCodec::H264 => "WebCodecs H.264",
            NalCodec::Hevc => "WebCodecs HEVC",
        };
        Ok(Self {
            handle,
            info: info.clone(),
            name,
        })
    }

    /// 훅이 돌려준 프레임 묶음을 엔진 프레임으로. 색·화소비는 소프트웨어 디코더가 보고하는 값(`info`)을 쓴다.
    fn unpack(&self, packed: &[u8]) -> Result<Vec<DecodedFrame>> {
        let bad = || CodecError::Decode("WebCodecs: malformed frame packet".into());
        let u32_at = |p: usize| {
            packed
                .get(p..p + 4)
                .and_then(|b| b.try_into().ok())
                .map(u32::from_le_bytes)
                .ok_or_else(bad)
        };
        let count = u32_at(0)?;
        let mut pos = 4usize;
        let mut out = Vec::with_capacity(count as usize);
        for _ in 0..count {
            let pts = packed
                .get(pos..pos + 8)
                .and_then(|b| b.try_into().ok())
                .map(f64::from_le_bytes)
                .ok_or_else(bad)?;
            let (w, h, format, len) = (
                u32_at(pos + 8)?,
                u32_at(pos + 12)?,
                u32_at(pos + 16)?,
                u32_at(pos + 20)?,
            );
            pos += 24;
            let data = packed.get(pos..pos + len as usize).ok_or_else(bad)?;
            pos += len as usize;
            let (wu, hu) = (w as usize, h as usize);
            let (cw, ch) = (wu.div_ceil(2), hu.div_ceil(2));
            let y = data.get(..wu * hu).ok_or_else(bad)?.to_vec();
            let (u, v) = match format {
                0 => (
                    data.get(wu * hu..wu * hu + cw * ch)
                        .ok_or_else(bad)?
                        .to_vec(),
                    data.get(wu * hu + cw * ch..wu * hu + 2 * cw * ch)
                        .ok_or_else(bad)?
                        .to_vec(),
                ),
                1 => {
                    let uv = data.get(wu * hu..wu * hu + 2 * cw * ch).ok_or_else(bad)?;
                    let mut u = Vec::with_capacity(cw * ch);
                    let mut v = Vec::with_capacity(cw * ch);
                    for &[cb, cr] in uv.as_chunks::<2>().0 {
                        u.push(cb);
                        v.push(cr);
                    }
                    (u, v)
                }
                _ => {
                    return Err(CodecError::Decode(format!(
                        "WebCodecs: pixel format {format} not handled"
                    )));
                }
            };
            let frame = filmcraft_frame::VideoFrame {
                width: w,
                height: h,
                data: filmcraft_frame::PixelData::Yuv8 {
                    planes: [Arc::new(y), Arc::new(u), Arc::new(v)],
                    chroma: filmcraft_frame::Chroma::C420,
                    alpha: None,
                },
                color: self.info.color,
                par: self.info.par,
                pts: filmcraft_time::Tick::ZERO,
            };
            out.push(DecodedFrame {
                pts: pts as i64,
                frame,
                draft: false,
            });
        }
        Ok(out)
    }
}

impl VideoDecoder for WebDecoder {
    fn decode(&mut self, sample: &[u8], pts: i64) -> Result<Vec<DecodedFrame>> {
        let key = self.info.is_irap(sample);
        let packed = with_hooks(|h| h.decode(self.handle, sample, pts as f64, key))?;
        self.unpack(&packed.to_vec())
    }

    fn flush(&mut self) -> Vec<DecodedFrame> {
        with_hooks(|h| h.flush(self.handle))
            .ok()
            .and_then(|p| self.unpack(&p.to_vec()).ok())
            .unwrap_or_default()
    }

    fn reset(&mut self) {
        let _ = with_hooks(|h| h.reset(self.handle));
    }

    fn name(&self) -> &str {
        self.name
    }

    fn is_random_access(&self, sample: &[u8]) -> Option<bool> {
        self.info.is_random_access(sample)
    }

    fn is_disposable(&self, sample: &[u8]) -> bool {
        self.info.is_disposable(sample)
    }
}

impl Drop for WebDecoder {
    fn drop(&mut self) {
        HOOKS.with(|h| {
            if let Some(h) = h.borrow().as_ref() {
                h.close(self.handle);
            }
        });
    }
}

/// 레지스트리에 등록하는 팩토리: 훅이 있고 하드웨어 디코딩 설정이 켜져 있으며 브라우저가 받는 avcC/hvcC 스트림이면
/// [`HybridDecoder`](소프트웨어 폴백 포함)를, 아니면 `None`(다음 팩토리로).
pub fn webcodecs_factory(entry: &SampleEntry) -> Option<Result<Box<dyn VideoDecoder>>> {
    if !enabled() || !hw::hardware_decoding() {
        return None;
    }
    let info = NalStreamInfo::from_entry(entry)?.ok()?;
    match WebDecoder::new(entry, &info) {
        Ok(d) => Some(Ok(Box::new(HybridDecoder::new(
            Box::new(d),
            entry.clone(),
            info,
        )))),
        Err(_) => {
            hw::note_hw_declined();
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn avc_and_hevc_codec_strings() {
        let avc = SampleEntry::video(
            filmcraft_isobmff::FourCc(*b"avc1"),
            CodecConfig::Avc(filmcraft_isobmff::AvcConfig {
                profile: 0x64,
                compatibility: 0,
                level: 0x28,
                ..filmcraft_isobmff::AvcConfig::new(vec![], vec![], 4)
            }),
            1920,
            1080,
        );
        assert_eq!(codec_string(&avc).as_deref(), Some("avc1.640028"));
        let hevc = SampleEntry::video(
            filmcraft_isobmff::FourCc(*b"hvc1"),
            CodecConfig::Hevc(filmcraft_isobmff::HevcConfig {
                general_profile_idc: 1,
                general_profile_compatibility_flags: 0x6000_0000,
                general_level_idc: 93,
                general_constraint_indicator_flags: 0x9000_0000_0000,
                ..Default::default()
            }),
            1920,
            1080,
        );
        assert_eq!(codec_string(&hevc).as_deref(), Some("hvc1.1.6.L93.90"));
    }
}
