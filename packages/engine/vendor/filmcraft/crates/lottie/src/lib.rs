//! Lottie animations (bodymovin JSON, stored-entry dotLottie archives) as a resolution-independent
//! media source.
//!
//! Implemented from the public Lottie format description (the lottie-spec 1.0 schema and the
//! LottieFiles format documentation); no player source was used. Ported into sh-video-editor
//! from the effectcraft `lottie` crate's import side (value readers, keyframe eases, shape item
//! and layer field mapping, base64 and ZIP helpers); effectcraft turns Lottie into its project
//! model, this crate samples it directly and rasterises with the `filmcraft-text` path filler.
//!
//! Supported: shape layers (groups, rectangles, ellipses, stars and polygons, Bezier paths, fills
//! and strokes with dashes, linear and radial gradients, trim paths, repeaters, group and layer
//! transforms with skew), solid, null and precomposition layers (parenting, in/out points,
//! stretch, time remap), keyframes with Bezier temporal easing, hold keys and spatial tangents,
//! masks (add, subtract, intersect, inverted) and track mattes (alpha, luma, inverted), the
//! blend modes Normal, Multiply, Screen and Add. Not supported (listed in
//! [`Animation::warnings`]): image, text, audio and camera layers, expressions, path modifiers
//! (round corners, offset, pucker, twist, zig zag, merge), layer effects and styles, compressed
//! dotLottie entries.
//!
//! Frames are the Lottie document's frames (`fr` per second); [`Animation::render`] samples any
//! fractional frame at any pixel size, so the source scales to the project item's size instead
//! of a stored raster. [`LottieSource`] wraps it as a looping `filmcraft_media::MediaSource`
//! ([`LOOP_SECONDS`] of media, frames repeating the document) and [`opener`] plugs it into the
//! media pool for `.json` / `.lottie` files.

#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::unimplemented, clippy::todo, clippy::unreachable)]

pub mod anim;
pub mod base64;
pub mod geom;
pub mod layers;
pub mod render;
pub mod shapes;
mod source;
pub mod zip;

use std::collections::HashMap;

use serde_json::Value as Json;

use layers::{Ctx, Layer};
use render::Canvas;

pub use source::{LOOP_SECONDS, LottieSource, opener};

#[derive(Debug, thiserror::Error)]
pub enum LottieError {
    #[error("not a Lottie document: {0}")]
    Parse(String),
    #[error("{0}")]
    Invalid(String),
}

/// A parsed, renderable Lottie document.
#[derive(Clone, Debug)]
pub struct Animation {
    pub name: String,
    pub width: u32,
    pub height: u32,
    /// Frames per second (`fr`).
    pub frame_rate: f64,
    /// First frame (`ip`).
    pub in_point: f64,
    /// Frame after the last (`op`).
    pub out_point: f64,
    /// Lottie version string (`v`), when present.
    pub version: String,
    layers: Vec<Layer>,
    assets: HashMap<String, Vec<Layer>>,
    /// Features in the file this renderer skips.
    pub warnings: Vec<String>,
}

impl Animation {
    /// Whether `bytes` look like a Lottie document (JSON with `layers` and a frame rate) or a
    /// dotLottie archive.
    pub fn sniff(bytes: &[u8]) -> bool {
        if bytes.starts_with(b"PK\x03\x04") {
            return zip::read_stored(bytes).iter().any(|(n, _)| n.starts_with("animations/") && n.ends_with(".json"));
        }
        let head: String = String::from_utf8_lossy(&bytes[..bytes.len().min(4096)]).into_owned();
        let t = head.trim_start();
        t.starts_with('{') && (head.contains("\"layers\"") || head.contains("\"fr\""))
    }

    /// Parse a JSON document or a stored-entry dotLottie archive.
    pub fn parse(bytes: &[u8]) -> Result<Animation, LottieError> {
        if bytes.starts_with(b"PK\x03\x04") {
            let entries = zip::read_stored(bytes);
            let Some((_, json)) = entries.iter().find(|(n, _)| n.starts_with("animations/") && n.ends_with(".json")) else {
                return Err(LottieError::Parse("dotLottie archive without a stored animations/*.json entry (compressed entries are not supported)".into()));
            };
            return Self::parse_json(json);
        }
        Self::parse_json(bytes)
    }

    fn parse_json(bytes: &[u8]) -> Result<Animation, LottieError> {
        let j: Json = serde_json::from_slice(bytes).map_err(|e| LottieError::Parse(e.to_string()))?;
        Self::from_json(&j)
    }

    pub fn from_json(j: &Json) -> Result<Animation, LottieError> {
        let Some(layers_j) = j.get("layers").and_then(Json::as_array) else {
            return Err(LottieError::Parse("no `layers`".into()));
        };
        let frame_rate = j.get("fr").and_then(Json::as_f64).unwrap_or(30.0);
        if !(frame_rate > 0.0 && frame_rate.is_finite()) {
            return Err(LottieError::Invalid(format!("frame rate {frame_rate}")));
        }
        let width = j.get("w").and_then(Json::as_f64).unwrap_or(0.0).round() as u32;
        let height = j.get("h").and_then(Json::as_f64).unwrap_or(0.0).round() as u32;
        if width == 0 || height == 0 || width > 16384 || height > 16384 {
            return Err(LottieError::Invalid(format!("size {width}x{height}")));
        }
        let in_point = j.get("ip").and_then(Json::as_f64).unwrap_or(0.0);
        let out_point = j.get("op").and_then(Json::as_f64).unwrap_or(in_point + 1.0);
        if out_point <= in_point || !out_point.is_finite() {
            return Err(LottieError::Invalid(format!("frame range {in_point}..{out_point}")));
        }
        let mut warnings = Vec::new();
        let layers = layers::parse_layers(layers_j, &mut warnings);
        let mut assets = HashMap::new();
        for a in j.get("assets").and_then(Json::as_array).into_iter().flatten() {
            let id = a.get("id").and_then(Json::as_str).unwrap_or("").to_string();
            if let Some(l) = a.get("layers").and_then(Json::as_array) {
                assets.insert(id, layers::parse_layers(l, &mut warnings));
            } else if a.get("p").is_some() || a.get("u").is_some() {
                let w = "image assets are not supported (layers using them are skipped)".to_string();
                if !warnings.contains(&w) {
                    warnings.push(w);
                }
            }
        }
        Ok(Animation {
            name: j.get("nm").and_then(Json::as_str).unwrap_or("").to_string(),
            width,
            height,
            frame_rate,
            in_point,
            out_point,
            version: j.get("v").and_then(Json::as_str).unwrap_or("").to_string(),
            layers,
            assets,
            warnings,
        })
    }

    pub fn duration_frames(&self) -> f64 {
        self.out_point - self.in_point
    }

    pub fn duration_seconds(&self) -> f64 {
        self.duration_frames() / self.frame_rate
    }

    /// The document frame for media time `seconds`, looping over the animation.
    pub fn frame_at(&self, seconds: f64) -> f64 {
        let n = self.duration_frames();
        if n <= 0.0 {
            return self.in_point;
        }
        self.in_point + (seconds * self.frame_rate).rem_euclid(n)
    }

    /// Render document `frame` at `width` x `height` pixels (the document scaled to fit exactly,
    /// non-uniformly when the aspect differs): straight-alpha sRGB RGBA8, transparent background.
    pub fn render(&self, frame: f64, width: u32, height: u32) -> Vec<u8> {
        self.render_canvas(frame, width, height).to_rgba8()
    }

    pub fn render_canvas(&self, frame: f64, width: u32, height: u32) -> Canvas {
        let (w, h) = (width.max(1) as usize, height.max(1) as usize);
        let mut canvas = Canvas::new(w, h);
        let base = geom::scale(w as f64 / self.width as f64, h as f64 / self.height as f64);
        let ctx = Ctx { assets: &self.assets, frame_rate: self.frame_rate, depth: 0 };
        layers::render_layers(&self.layers, frame, &base, None, &ctx, &mut canvas);
        canvas
    }

    pub fn layer_count(&self) -> usize {
        self.layers.len()
    }
}

#[cfg(test)]
mod tests;
