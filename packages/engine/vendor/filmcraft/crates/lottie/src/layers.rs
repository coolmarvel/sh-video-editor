//! Layers: shape (`ty` 4), solid (1), null (3) and precomposition (0) layers with transform
//! parenting, in/out points, time stretch and remap, masks and track mattes, rendered bottom to
//! top into a canvas.

use std::collections::HashMap;

use serde_json::Value as Json;

use crate::anim::{self, Animated};
use crate::geom::{self, Mat, PathData};
use crate::render::{Blend, Canvas};
use crate::shapes::{self, Item, Transform};

#[derive(Clone, Debug)]
pub enum Content {
    Shapes(Vec<Item>),
    Solid { color: [f32; 4], width: f64, height: f64 },
    Precomp { asset: String, width: f64, height: f64, time_remap: Option<Animated<Vec<f64>>> },
    Null,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Matte {
    Alpha,
    AlphaInverted,
    Luma,
    LumaInverted,
}

#[derive(Clone, Debug)]
pub struct MaskDef {
    /// `a` add, `s` subtract, `i` intersect, `n` none, others as add.
    pub mode: char,
    pub path: Animated<PathData>,
    pub opacity: Animated<Vec<f64>>,
    pub inverted: bool,
}

#[derive(Clone, Debug)]
pub struct Layer {
    pub name: String,
    pub index: Option<i64>,
    pub parent: Option<i64>,
    pub transform: Transform,
    pub in_point: f64,
    pub out_point: f64,
    pub start: f64,
    pub stretch: f64,
    pub content: Content,
    pub masks: Vec<MaskDef>,
    pub matte: Option<Matte>,
    /// `tp`: the matte layer's index (otherwise the layer above).
    pub matte_source: Option<i64>,
    /// `td`: this layer only serves as a matte and is not drawn by itself.
    pub is_matte: bool,
    pub blend: Blend,
}

impl Layer {
    pub fn visible_at(&self, frame: f64) -> bool {
        self.in_point <= frame && frame < self.out_point
    }
    /// The layer's own frame at composition frame `frame` (start offset and stretch).
    pub fn local(&self, frame: f64) -> f64 {
        (frame - self.start) / if self.stretch.abs() > 1e-9 { self.stretch } else { 1.0 }
    }
}

/// Parse a `layers` list.
pub fn parse_layers(list: &[Json], warnings: &mut Vec<String>) -> Vec<Layer> {
    let mut out = Vec::with_capacity(list.len());
    for j in list {
        if j.get("hd").and_then(Json::as_bool) == Some(true) {
            continue;
        }
        let name = j.get("nm").and_then(Json::as_str).unwrap_or("").to_string();
        let ty = j.get("ty").and_then(Json::as_i64).unwrap_or(-1);
        let content = match ty {
            4 => Content::Shapes(shapes::parse_items(&j.get("shapes").and_then(Json::as_array).cloned().unwrap_or_default(), warnings)),
            1 => Content::Solid {
                color: j.get("sc").and_then(Json::as_str).map(hex_color).unwrap_or([0.0, 0.0, 0.0, 1.0]),
                width: j.get("sw").and_then(Json::as_f64).unwrap_or(100.0),
                height: j.get("sh").and_then(Json::as_f64).unwrap_or(100.0),
            },
            0 => Content::Precomp {
                asset: j.get("refId").and_then(Json::as_str).unwrap_or("").to_string(),
                width: j.get("w").and_then(Json::as_f64).unwrap_or(0.0),
                height: j.get("h").and_then(Json::as_f64).unwrap_or(0.0),
                time_remap: j.get("tm").map(|tm| anim::scalar(Some(tm), 0.0)),
            },
            3 => Content::Null,
            other => {
                let what = match other {
                    2 => "image layers",
                    5 => "text layers",
                    6 => "audio layers",
                    13 => "cameras",
                    _ => "this layer type",
                };
                let w = format!("{what} are not supported (layer `{name}` skipped)");
                if !warnings.contains(&w) {
                    warnings.push(w);
                }
                continue;
            }
        };
        let masks = j
            .get("masksProperties")
            .and_then(Json::as_array)
            .map(|ms| {
                ms.iter()
                    .map(|m| MaskDef {
                        mode: m.get("mode").and_then(Json::as_str).and_then(|s| s.chars().next()).unwrap_or('a'),
                        path: anim::read(m.get("pt"), PathData::default(), &shapes::to_path),
                        opacity: anim::scalar(m.get("o"), 100.0),
                        inverted: m.get("inv").and_then(Json::as_bool).unwrap_or(false),
                    })
                    .filter(|m| m.mode != 'n')
                    .collect()
            })
            .unwrap_or_default();
        let matte = match j.get("tt").and_then(Json::as_i64) {
            Some(1) => Some(Matte::Alpha),
            Some(2) => Some(Matte::AlphaInverted),
            Some(3) => Some(Matte::Luma),
            Some(4) => Some(Matte::LumaInverted),
            _ => None,
        };
        out.push(Layer {
            name,
            index: j.get("ind").and_then(Json::as_i64),
            parent: j.get("parent").and_then(Json::as_i64),
            transform: Transform::parse(j.get("ks")),
            in_point: j.get("ip").and_then(Json::as_f64).unwrap_or(f64::NEG_INFINITY),
            out_point: j.get("op").and_then(Json::as_f64).unwrap_or(f64::INFINITY),
            start: j.get("st").and_then(Json::as_f64).unwrap_or(0.0),
            stretch: j.get("sr").and_then(Json::as_f64).unwrap_or(1.0),
            content,
            masks,
            matte,
            matte_source: j.get("tp").and_then(Json::as_i64),
            is_matte: j.get("td").and_then(Json::as_i64) == Some(1),
            blend: Blend::from_lottie(j.get("bm").and_then(Json::as_i64).unwrap_or(0)),
        });
    }
    out
}

/// `#rrggbb` (solid colours).
fn hex_color(s: &str) -> [f32; 4] {
    let h = s.trim_start_matches('#');
    let c = |i: usize| u8::from_str_radix(h.get(i..i + 2).unwrap_or("00"), 16).unwrap_or(0) as f32 / 255.0;
    if h.len() >= 6 { [c(0), c(2), c(4), 1.0] } else { [0.0, 0.0, 0.0, 1.0] }
}

/// What the renderer needs besides the layers.
pub struct Ctx<'a> {
    pub assets: &'a HashMap<String, Vec<Layer>>,
    pub frame_rate: f64,
    pub depth: usize,
}

/// World matrix of `layer` at composition frame `frame`: its parents' transforms (at their own
/// local frames) then its own.
fn world_matrix(layers: &[Layer], layer: &Layer, frame: f64, base: &Mat) -> Mat {
    let mut chain = vec![layer];
    let mut parent = layer.parent;
    while let Some(pi) = parent
        && chain.len() < 64
        && let Some(p) = layers.iter().find(|l| l.index == Some(pi))
    {
        if chain.iter().any(|c| std::ptr::eq(*c, p)) {
            break;
        }
        chain.push(p);
        parent = p.parent;
    }
    let mut m = *base;
    for l in chain.iter().rev() {
        m = geom::mul(&m, &l.transform.matrix(l.local(frame)));
    }
    m
}

/// Render `layers` (a composition) at `frame` through `base` onto `canvas`; `clip` is the
/// composition size for precomps (content outside it is cut).
pub fn render_layers(layers: &[Layer], frame: f64, base: &Mat, clip: Option<(f64, f64)>, ctx: &Ctx, canvas: &mut Canvas) {
    if ctx.depth > 16 {
        return;
    }
    let mut clip_cov: Option<Vec<f32>> = None;
    if let Some((w, h)) = clip
        && w > 0.0
        && h > 0.0
    {
        clip_cov = Some(rect_coverage(base, w, h, canvas.w, canvas.h));
    }
    for (i, layer) in layers.iter().enumerate().rev() {
        if layer.is_matte || !layer.visible_at(frame) {
            continue;
        }
        let Some(mut lc) = render_layer(layers, i, frame, base, ctx, canvas.w, canvas.h) else { continue };
        if let Some(cov) = &clip_cov {
            lc.multiply_alpha(cov);
        }
        canvas.over(&lc, layer.transform.opacity(layer.local(frame)), None, layer.blend);
    }
}

/// One layer (content, masks, matte) at full opacity on its own canvas; `None` when it draws
/// nothing.
fn render_layer(layers: &[Layer], i: usize, frame: f64, base: &Mat, ctx: &Ctx, w: usize, h: usize) -> Option<Canvas> {
    let layer = &layers[i];
    let local = layer.local(frame);
    let m = world_matrix(layers, layer, frame, base);
    let mut c = Canvas::new(w, h);
    match &layer.content {
        Content::Shapes(items) => {
            let mut ops = Vec::new();
            shapes::build_ops(items, local, &mut ops);
            shapes::draw_ops(&ops, &m, 1.0, &mut c);
        }
        Content::Solid { color, width, height } => {
            let r = geom::rect([width / 2.0, height / 2.0], [*width, *height], 0.0);
            let ops = [shapes::Op::Fill { shapes: vec![r], color: *color, even_odd: false, blend: Blend::Normal }];
            shapes::draw_ops(&ops, &m, 1.0, &mut c);
        }
        Content::Precomp { asset, width, height, time_remap } => {
            let inner = match time_remap {
                Some(tm) => tm.f(local) * ctx.frame_rate,
                None => local,
            };
            if let Some(sub) = ctx.assets.get(asset) {
                let sub_ctx = Ctx { assets: ctx.assets, frame_rate: ctx.frame_rate, depth: ctx.depth + 1 };
                render_layers(sub, inner, &m, Some((*width, *height)), &sub_ctx, &mut c);
            }
        }
        Content::Null => return None,
    }
    if c.is_blank() {
        return None;
    }
    if !layer.masks.is_empty() {
        c.multiply_alpha(&mask_coverage(&layer.masks, local, &m, w, h));
    }
    if let Some(kind) = layer.matte {
        let src = match layer.matte_source {
            Some(idx) => layers.iter().position(|l| l.index == Some(idx)),
            None => i.checked_sub(1),
        };
        let matte = src.filter(|&k| k != i).and_then(|k| {
            let ml = &layers[k];
            if !ml.visible_at(frame) {
                return None;
            }
            let mut mc = render_layer(layers, k, frame, base, ctx, w, h)?;
            let o = ml.transform.opacity(ml.local(frame));
            if o < 1.0 {
                mc.multiply_alpha(&vec![o; w * h]);
            }
            Some(mc)
        });
        let mut cov = match (&matte, kind) {
            (Some(mc), Matte::Alpha | Matte::AlphaInverted) => mc.alpha(),
            (Some(mc), Matte::Luma | Matte::LumaInverted) => mc.luma(),
            (None, _) => vec![0.0; w * h],
        };
        if matches!(kind, Matte::AlphaInverted | Matte::LumaInverted) {
            for v in &mut cov {
                *v = 1.0 - *v;
            }
        }
        c.multiply_alpha(&cov);
    }
    Some(c)
}

/// Coverage (len w*h) of the rectangle (0, 0)-(rw, rh) under `m`.
fn rect_coverage(m: &Mat, rw: f64, rh: f64, w: usize, h: usize) -> Vec<f32> {
    let r = geom::rect([rw / 2.0, rh / 2.0], [rw, rh], 0.0);
    let ops = [shapes::Op::Fill { shapes: vec![r], color: [1.0, 1.0, 1.0, 1.0], even_odd: false, blend: Blend::Normal }];
    let mut c = Canvas::new(w, h);
    shapes::draw_ops(&ops, m, 1.0, &mut c);
    c.alpha()
}

/// Combined coverage of the layer's masks in pixel space.
fn mask_coverage(masks: &[MaskDef], local: f64, m: &Mat, w: usize, h: usize) -> Vec<f32> {
    let mut cov: Vec<f32> = vec![if masks.first().is_some_and(|f| f.mode == 'a') { 0.0 } else { 1.0 }; w * h];
    for mask in masks {
        let path = mask.path.at(local).0;
        let o = (mask.opacity.f(local) / 100.0).clamp(0.0, 1.0) as f32;
        let ops = [shapes::Op::Fill { shapes: vec![path], color: [1.0, 1.0, 1.0, 1.0], even_odd: false, blend: Blend::Normal }];
        let mut c = Canvas::new(w, h);
        shapes::draw_ops(&ops, m, 1.0, &mut c);
        let a = c.alpha();
        for (dst, src) in cov.iter_mut().zip(a) {
            let mut s = if mask.inverted { 1.0 - src } else { src } * o;
            if mask.inverted {
                s = s.max(0.0);
            }
            match mask.mode {
                's' => *dst *= 1.0 - s,
                'i' => *dst *= s,
                _ => *dst += s * (1.0 - *dst),
            }
        }
    }
    cov
}
