//! Shape layer contents: Lottie shape items (`gr`, `rc`, `el`, `sr`, `sh`, `fl`, `st`, `gf`,
//! `gs`, `tm`, `rp`, `tr`) parsed into [`Item`]s, evaluated at a frame into draw operations and
//! painted.
//!
//! After Effects rules (as in lottie-web): a fill or stroke paints every path above it in its
//! group, nested groups included; items lower in the list paint first; a group's transform and
//! opacity apply to everything in it; Trim Paths and Repeater modify the paths above them.
//! The item names, enum values and `d: 3` direction follow the effectcraft `lottie` crate's
//! `shapes.rs` import; the evaluation is new.

use filmcraft_text::raster::Path;
use serde_json::Value as Json;

use crate::anim::{self, Animated};
use crate::geom::{self, Cap, Contour, Join, Mat, PathData, StrokeStyle};
use crate::render::{Blend, Canvas, Gradient};

/// Layer / group transform (`ks` / `tr`).
#[derive(Clone, Debug)]
pub struct Transform {
    pub anchor: Animated<Vec<f64>>,
    pub position: Position,
    pub scale: Animated<Vec<f64>>,
    pub rotation: Animated<Vec<f64>>,
    pub opacity: Animated<Vec<f64>>,
    pub skew: Animated<Vec<f64>>,
    pub skew_axis: Animated<Vec<f64>>,
    pub start_opacity: Animated<Vec<f64>>,
    pub end_opacity: Animated<Vec<f64>>,
}

#[derive(Clone, Debug)]
pub enum Position {
    Joint(Animated<Vec<f64>>),
    /// Separated dimensions (`p.s = true`).
    Split {
        x: Animated<Vec<f64>>,
        y: Animated<Vec<f64>>,
    },
}

impl Position {
    pub fn at(&self, f: f64) -> [f64; 2] {
        match self {
            Position::Joint(p) => p.v2(f),
            Position::Split { x, y } => [x.f(f), y.f(f)],
        }
    }
}

impl Transform {
    pub fn parse(j: Option<&Json>) -> Transform {
        let g = |k: &str| j.and_then(|t| t.get(k));
        let position = match g("p") {
            Some(p) if p.get("s").and_then(Json::as_bool) == Some(true) => {
                Position::Split { x: anim::scalar(p.get("x"), 0.0), y: anim::scalar(p.get("y"), 0.0) }
            }
            p => Position::Joint(anim::prop(p, &[0.0, 0.0])),
        };
        // 3D layers animate `rz`; 2D layers `r`
        let rotation = match g("r") {
            Some(r) => anim::scalar(Some(r), 0.0),
            None => anim::scalar(g("rz"), 0.0),
        };
        Transform {
            anchor: anim::prop(g("a"), &[0.0, 0.0]),
            position,
            scale: anim::prop(g("s"), &[100.0, 100.0]),
            rotation,
            opacity: anim::scalar(g("o"), 100.0),
            skew: anim::scalar(g("sk"), 0.0),
            skew_axis: anim::scalar(g("sa"), 0.0),
            start_opacity: anim::scalar(g("so"), 100.0),
            end_opacity: anim::scalar(g("eo"), 100.0),
        }
    }

    pub fn identity() -> Transform {
        Transform::parse(None)
    }

    /// Matrix at frame `f`: translate(position) * rotate * skew * scale * translate(-anchor).
    pub fn matrix(&self, f: f64) -> Mat {
        let a = self.anchor.v2(f);
        let p = self.position.at(f);
        let s = self.scale.at(f);
        let (sx, sy) = (s.first().copied().unwrap_or(100.0) / 100.0, s.get(1).copied().unwrap_or(100.0) / 100.0);
        let r = self.rotation.f(f);
        let sk = self.skew.f(f);
        let mut m = geom::mul(&geom::translate(p[0], p[1]), &geom::rotate(r));
        if sk.abs() > 1e-9 {
            m = geom::mul(&m, &geom::skew(sk, self.skew_axis.f(f)));
        }
        m = geom::mul(&m, &geom::scale(sx, sy));
        geom::mul(&m, &geom::translate(-a[0], -a[1]))
    }

    pub fn opacity(&self, f: f64) -> f32 {
        (self.opacity.f(f) / 100.0).clamp(0.0, 1.0) as f32
    }
}

/// Stroke appearance in the owning group's units.
#[derive(Clone, Debug)]
pub struct StrokeDef {
    pub width: Animated<Vec<f64>>,
    pub cap: Cap,
    pub join: Join,
    pub miter: f64,
    pub dashes: Vec<Animated<Vec<f64>>>,
    pub dash_offset: Animated<Vec<f64>>,
}

impl StrokeDef {
    fn parse(j: &Json) -> StrokeDef {
        let cap = match anim::int(j, "lc") {
            Some(2) => Cap::Round,
            Some(3) => Cap::Square,
            _ => Cap::Butt,
        };
        let join = match anim::int(j, "lj") {
            Some(2) => Join::Round,
            Some(3) => Join::Bevel,
            _ => Join::Miter,
        };
        let mut dashes = Vec::new();
        let mut dash_offset = Animated::Const(vec![0.0]);
        if let Some(list) = j.get("d").and_then(Json::as_array) {
            for e in list {
                let v = anim::scalar(e.get("v"), 0.0);
                match e.get("n").and_then(Json::as_str) {
                    Some("o") => dash_offset = v,
                    _ => dashes.push(v),
                }
            }
        }
        StrokeDef { width: anim::scalar(j.get("w"), 1.0), cap, join, miter: j.get("ml").and_then(Json::as_f64).unwrap_or(4.0), dashes, dash_offset }
    }
}

/// Gradient (`g`) as Lottie stores it: `p` colour stops of `[pos, r, g, b]` then alpha stops
/// `[pos, a]`.
#[derive(Clone, Debug)]
pub struct GradientDef {
    pub radial: bool,
    pub start: Animated<Vec<f64>>,
    pub end: Animated<Vec<f64>>,
    pub stops: Animated<Vec<f64>>,
    pub colors: usize,
}

impl GradientDef {
    fn parse(j: &Json) -> GradientDef {
        let g = j.get("g");
        let colors = g.and_then(|g| g.get("p")).and_then(Json::as_u64).unwrap_or(2) as usize;
        GradientDef {
            radial: anim::int(j, "t") == Some(2),
            start: anim::prop(j.get("s"), &[0.0, 0.0]),
            end: anim::prop(j.get("e"), &[100.0, 0.0]),
            stops: anim::prop(g.and_then(|g| g.get("k")), &[0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0]),
            colors,
        }
    }

    /// The gradient at frame `f` in the group's units.
    pub fn at(&self, f: f64) -> Gradient {
        let flat = self.stops.at(f);
        let n = self.colors.min(flat.len() / 4);
        let colors: Vec<(f64, [f32; 3])> = (0..n).map(|i| (flat[i * 4], [flat[i * 4 + 1] as f32, flat[i * 4 + 2] as f32, flat[i * 4 + 3] as f32])).collect();
        let alphas: Vec<(f64, f32)> = flat[n * 4..].chunks(2).filter(|c| c.len() == 2).map(|c| (c[0], c[1] as f32)).collect();
        let mut positions: Vec<f64> = colors.iter().map(|c| c.0).chain(alphas.iter().map(|a| a.0)).collect();
        positions.sort_by(|a, b| a.total_cmp(b));
        positions.dedup_by(|a, b| (*a - *b).abs() < 1e-9);
        let lerp_at = |pos: f64, pts: &[(f64, Vec<f32>)], default: Vec<f32>| -> Vec<f32> {
            let Some(first) = pts.first() else { return default };
            if pos <= first.0 || pts.len() == 1 {
                return first.1.clone();
            }
            let Some(last) = pts.last() else { return default };
            if pos >= last.0 {
                return last.1.clone();
            }
            let k = pts.iter().rposition(|p| p.0 <= pos).unwrap_or(0);
            let (a, b) = (&pts[k], &pts[(k + 1).min(pts.len() - 1)]);
            let t = if b.0 > a.0 { ((pos - a.0) / (b.0 - a.0)) as f32 } else { 0.0 };
            a.1.iter().zip(&b.1).map(|(x, y)| x + (y - x) * t).collect()
        };
        let cpts: Vec<(f64, Vec<f32>)> = colors.iter().map(|c| (c.0, c.1.to_vec())).collect();
        let apts: Vec<(f64, Vec<f32>)> = alphas.iter().map(|a| (a.0, vec![a.1])).collect();
        let stops = positions
            .iter()
            .map(|&p| {
                let c = lerp_at(p, &cpts, vec![0.0, 0.0, 0.0]);
                let a = lerp_at(p, &apts, vec![1.0]);
                (p, [c.first().copied().unwrap_or(0.0), c.get(1).copied().unwrap_or(0.0), c.get(2).copied().unwrap_or(0.0), a.first().copied().unwrap_or(1.0)])
            })
            .collect();
        Gradient { radial: self.radial, start: self.start.v2(f), end: self.end.v2(f), stops }
    }
}

#[derive(Clone, Debug)]
pub enum Item {
    Group {
        items: Vec<Item>,
        transform: Transform,
    },
    Rect {
        pos: Animated<Vec<f64>>,
        size: Animated<Vec<f64>>,
        round: Animated<Vec<f64>>,
        reverse: bool,
    },
    Ellipse {
        pos: Animated<Vec<f64>>,
        size: Animated<Vec<f64>>,
        reverse: bool,
    },
    Star {
        pos: Animated<Vec<f64>>,
        points: Animated<Vec<f64>>,
        outer_radius: Animated<Vec<f64>>,
        outer_round: Animated<Vec<f64>>,
        inner: Option<(Animated<Vec<f64>>, Animated<Vec<f64>>)>,
        rotation: Animated<Vec<f64>>,
        reverse: bool,
    },
    Path {
        path: Animated<PathData>,
        reverse: bool,
    },
    Fill {
        color: Animated<Vec<f64>>,
        opacity: Animated<Vec<f64>>,
        even_odd: bool,
        blend: Blend,
    },
    Stroke {
        color: Animated<Vec<f64>>,
        opacity: Animated<Vec<f64>>,
        stroke: StrokeDef,
        blend: Blend,
    },
    GradFill {
        grad: GradientDef,
        opacity: Animated<Vec<f64>>,
        even_odd: bool,
        blend: Blend,
    },
    GradStroke {
        grad: GradientDef,
        opacity: Animated<Vec<f64>>,
        stroke: StrokeDef,
        blend: Blend,
    },
    Trim {
        start: Animated<Vec<f64>>,
        end: Animated<Vec<f64>>,
        offset: Animated<Vec<f64>>,
        individually: bool,
    },
    Repeater {
        copies: Animated<Vec<f64>>,
        offset: Animated<Vec<f64>>,
        transform: Transform,
    },
}

/// Parse a `shapes` / `it` list. Hidden items (`hd`) are dropped; unknown item types are named in
/// `warnings`.
pub fn parse_items(list: &[Json], warnings: &mut Vec<String>) -> Vec<Item> {
    let mut out = Vec::with_capacity(list.len());
    for j in list {
        if j.get("hd").and_then(Json::as_bool) == Some(true) {
            continue;
        }
        let ty = j.get("ty").and_then(Json::as_str).unwrap_or("");
        let reverse = anim::int(j, "d") == Some(3);
        let blend = Blend::from_lottie(anim::int(j, "bm").unwrap_or(0));
        let item = match ty {
            "gr" => {
                let it = j.get("it").and_then(Json::as_array).cloned().unwrap_or_default();
                let tr = it.iter().find(|i| i.get("ty").and_then(Json::as_str) == Some("tr")).cloned();
                let inner: Vec<Json> = it.into_iter().filter(|i| i.get("ty").and_then(Json::as_str) != Some("tr")).collect();
                Item::Group { items: parse_items(&inner, warnings), transform: Transform::parse(tr.as_ref()) }
            }
            "rc" => Item::Rect {
                pos: anim::prop(j.get("p"), &[0.0, 0.0]),
                size: anim::prop(j.get("s"), &[100.0, 100.0]),
                round: anim::scalar(j.get("r"), 0.0),
                reverse,
            },
            "el" => Item::Ellipse { pos: anim::prop(j.get("p"), &[0.0, 0.0]), size: anim::prop(j.get("s"), &[100.0, 100.0]), reverse },
            "sr" => Item::Star {
                pos: anim::prop(j.get("p"), &[0.0, 0.0]),
                points: anim::scalar(j.get("pt"), 5.0),
                outer_radius: anim::scalar(j.get("or"), 50.0),
                outer_round: anim::scalar(j.get("os"), 0.0),
                inner: (anim::int(j, "sy") != Some(2)).then(|| (anim::scalar(j.get("ir"), 25.0), anim::scalar(j.get("is"), 0.0))),
                rotation: anim::scalar(j.get("r"), 0.0),
                reverse,
            },
            "sh" => Item::Path { path: anim::read(j.get("ks"), PathData::default(), &to_path), reverse },
            "fl" => Item::Fill {
                color: anim::color(j.get("c"), [0.0, 0.0, 0.0, 1.0]),
                opacity: anim::scalar(j.get("o"), 100.0),
                even_odd: anim::int(j, "r") == Some(2),
                blend,
            },
            "st" => Item::Stroke {
                color: anim::color(j.get("c"), [0.0, 0.0, 0.0, 1.0]),
                opacity: anim::scalar(j.get("o"), 100.0),
                stroke: StrokeDef::parse(j),
                blend,
            },
            "gf" => Item::GradFill { grad: GradientDef::parse(j), opacity: anim::scalar(j.get("o"), 100.0), even_odd: anim::int(j, "r") == Some(2), blend },
            "gs" => Item::GradStroke { grad: GradientDef::parse(j), opacity: anim::scalar(j.get("o"), 100.0), stroke: StrokeDef::parse(j), blend },
            "tm" => Item::Trim {
                start: anim::scalar(j.get("s"), 0.0),
                end: anim::scalar(j.get("e"), 100.0),
                offset: anim::scalar(j.get("o"), 0.0),
                individually: anim::int(j, "m") == Some(2),
            },
            "rp" => Item::Repeater { copies: anim::scalar(j.get("c"), 3.0), offset: anim::scalar(j.get("o"), 0.0), transform: Transform::parse(j.get("tr")) },
            "tr" => continue,
            other => {
                let name = match other {
                    "rd" => "Round Corners",
                    "op" => "Offset Paths",
                    "pb" => "Pucker and Bloat",
                    "tw" => "Twist",
                    "zz" => "Zig Zag",
                    "mm" => "Merge Paths",
                    _ => other,
                };
                let w = format!("shape item `{name}` is not supported (skipped)");
                if !warnings.contains(&w) {
                    warnings.push(w);
                }
                continue;
            }
        };
        out.push(item);
    }
    out
}

/// A Lottie bezier `{c, v, i, o}` (tangents relative to the vertices) as a contour.
pub(crate) fn to_path(j: &Json) -> Option<PathData> {
    let o = match j {
        Json::Array(a) => a.first()?,
        o => o,
    };
    let pts = |k: &str| -> Vec<[f64; 2]> {
        o.get(k)
            .and_then(Json::as_array)
            .map(|a| {
                a.iter().map(|p| anim::nums(p).map(|v| [v.first().copied().unwrap_or(0.0), v.get(1).copied().unwrap_or(0.0)]).unwrap_or([0.0; 2])).collect()
            })
            .unwrap_or_default()
    };
    let v = pts("v");
    let n = v.len();
    let rel = |mut t: Vec<[f64; 2]>| -> Vec<[f64; 2]> {
        t.resize(n, [0.0; 2]);
        t.iter().zip(&v).map(|(d, p)| [p[0] + d[0], p[1] + d[1]]).collect()
    };
    let (i, o2) = (rel(pts("i")), rel(pts("o")));
    Some(PathData(Contour { v, i, o: o2, closed: o.get("c").and_then(Json::as_bool).unwrap_or(false) }))
}

// ---------------------------------------------------------------- evaluation

/// A paint operation in the coordinates of the group that produced it.
#[derive(Clone, Debug)]
pub enum Op {
    Fill { shapes: Vec<Contour>, color: [f32; 4], even_odd: bool, blend: Blend },
    Stroke { shapes: Vec<Contour>, color: [f32; 4], stroke: StrokeStyle, dashes: Vec<f64>, dash_offset: f64, blend: Blend },
    GradFill { shapes: Vec<Contour>, grad: Gradient, opacity: f32, even_odd: bool, blend: Blend },
    GradStroke { shapes: Vec<Contour>, grad: Gradient, opacity: f32, stroke: StrokeStyle, dashes: Vec<f64>, dash_offset: f64, blend: Blend },
    Group { matrix: Mat, opacity: f32, ops: Vec<Op> },
}

fn stroke_style(d: &StrokeDef, f: f64) -> (StrokeStyle, Vec<f64>, f64) {
    (
        StrokeStyle { width: d.width.f(f).max(0.0), cap: d.cap, join: d.join, miter_limit: d.miter },
        d.dashes.iter().map(|a| a.f(f)).collect(),
        d.dash_offset.f(f),
    )
}

fn with_alpha(c: [f32; 4], opacity: f64) -> [f32; 4] {
    [c[0], c[1], c[2], (c[3] as f64 * (opacity / 100.0).clamp(0.0, 1.0)) as f32]
}

/// Evaluate `items` at frame `f` into `ops` (in list order; paint them last first). Returns the
/// paths of this group in its own coordinates, for the enclosing group's styles.
pub fn build_ops(items: &[Item], f: f64, ops: &mut Vec<Op>) -> Vec<Contour> {
    let mut paths: Vec<Contour> = Vec::new();
    let start = ops.len();
    let dir = |c: Contour, reverse: bool| if reverse { c.reversed() } else { c };
    for item in items {
        match item {
            Item::Group { items, transform } => {
                let m = transform.matrix(f);
                let mut sub = Vec::new();
                let sub_paths = build_ops(items, f, &mut sub);
                ops.push(Op::Group { matrix: m, opacity: transform.opacity(f), ops: sub });
                paths.extend(sub_paths.iter().map(|c| c.transformed(&m)));
            }
            Item::Rect { pos, size, round, reverse } => paths.push(dir(geom::rect(pos.v2(f), size.v2(f), round.f(f)), *reverse)),
            Item::Ellipse { pos, size, reverse } => paths.push(dir(geom::ellipse(pos.v2(f), size.v2(f)), *reverse)),
            Item::Star { pos, points, outer_radius, outer_round, inner, rotation, reverse } => {
                let inner = inner.as_ref().map(|(r, s)| (r.f(f), s.f(f)));
                paths.push(dir(geom::star(pos.v2(f), points.f(f), outer_radius.f(f), outer_round.f(f), inner, rotation.f(f)), *reverse));
            }
            Item::Path { path, reverse } => {
                let c = path.at(f).0;
                if !c.is_empty() {
                    paths.push(dir(c, *reverse));
                }
            }
            Item::Fill { color, opacity, even_odd, blend } => {
                ops.push(Op::Fill { shapes: paths.clone(), color: with_alpha(color.color(f), opacity.f(f)), even_odd: *even_odd, blend: *blend });
            }
            Item::Stroke { color, opacity, stroke, blend } => {
                let (st, dashes, dash_offset) = stroke_style(stroke, f);
                ops.push(Op::Stroke { shapes: paths.clone(), color: with_alpha(color.color(f), opacity.f(f)), stroke: st, dashes, dash_offset, blend: *blend });
            }
            Item::GradFill { grad, opacity, even_odd, blend } => {
                ops.push(Op::GradFill {
                    shapes: paths.clone(),
                    grad: grad.at(f),
                    opacity: (opacity.f(f) / 100.0).clamp(0.0, 1.0) as f32,
                    even_odd: *even_odd,
                    blend: *blend,
                });
            }
            Item::GradStroke { grad, opacity, stroke, blend } => {
                let (st, dashes, dash_offset) = stroke_style(stroke, f);
                ops.push(Op::GradStroke {
                    shapes: paths.clone(),
                    grad: grad.at(f),
                    opacity: (opacity.f(f) / 100.0).clamp(0.0, 1.0) as f32,
                    stroke: st,
                    dashes,
                    dash_offset,
                    blend: *blend,
                });
            }
            Item::Trim { start: ts, end, offset, individually } => {
                let (s, e, o) = (ts.f(f) / 100.0, end.f(f) / 100.0, offset.f(f) / 360.0);
                let (a, b) = (s.min(e) + o, s.max(e) + o);
                paths = trim_contours(&paths, a, b, *individually);
                // After Effects: the modifier also trims what the styles above it in this group already took
                // (bodymovin writes Trim Paths after the fill and stroke)
                trim_ops(&mut ops[start..], a, b, *individually);
            }
            Item::Repeater { copies, offset, transform } => {
                let n = copies.f(f).round().max(0.0) as usize;
                let off = offset.f(f);
                let base_ops = std::mem::take(ops);
                let base_paths = std::mem::take(&mut paths);
                let so = transform.start_opacity.f(f) / 100.0;
                let eo = transform.end_opacity.f(f) / 100.0;
                for i in 0..n {
                    let k = i as f64 + off;
                    let m = repeater_matrix(transform, f, k);
                    let t = if n > 1 { i as f64 / (n - 1) as f64 } else { 0.0 };
                    let opacity = (so + (eo - so) * t).clamp(0.0, 1.0) as f32;
                    ops.push(Op::Group { matrix: m, opacity, ops: base_ops.clone() });
                    paths.extend(base_paths.iter().map(|c| c.transformed(&m)));
                }
            }
        }
    }
    paths
}

/// Trim the shapes every style in `ops` (groups included) paints.
fn trim_ops(ops: &mut [Op], a: f64, b: f64, individually: bool) {
    for op in ops {
        match op {
            Op::Fill { shapes, .. } | Op::Stroke { shapes, .. } | Op::GradFill { shapes, .. } | Op::GradStroke { shapes, .. } => {
                *shapes = trim_contours(shapes, a, b, individually);
            }
            Op::Group { ops, .. } => trim_ops(ops, a, b, individually),
        }
    }
}

/// Repeater copy `k`: translate(anchor) * translate(position * k) * rotate(rotation * k) *
/// scale(scale ^ k) * translate(-anchor).
fn repeater_matrix(t: &Transform, f: f64, k: f64) -> Mat {
    let a = t.anchor.v2(f);
    let p = t.position.at(f);
    let s = t.scale.at(f);
    let (sx, sy) = ((s.first().copied().unwrap_or(100.0) / 100.0).powf(k), (s.get(1).copied().unwrap_or(100.0) / 100.0).powf(k));
    let r = t.rotation.f(f) * k;
    let m = geom::mul(&geom::translate(a[0] + p[0] * k, a[1] + p[1] * k), &geom::rotate(r));
    geom::mul(&geom::mul(&m, &geom::scale(sx, sy)), &geom::translate(-a[0], -a[1]))
}

/// Trim Paths: keep the part of each contour (`individually = false`, "Simultaneously") or of the
/// contours chained into one (`individually = true`) between length fractions `start..end`,
/// which may wrap around 1.
pub fn trim_contours(paths: &[Contour], start: f64, end: f64, individually: bool) -> Vec<Contour> {
    if end - start >= 1.0 - 1e-9 {
        return paths.to_vec();
    }
    if end - start <= 1e-9 {
        return Vec::new();
    }
    let a = start.rem_euclid(1.0);
    let b = a + (end - start);
    let ranges: Vec<(f64, f64)> = if b <= 1.0 { vec![(a, b)] } else { vec![(a, 1.0), (0.0, b - 1.0)] };
    let mut out = Vec::new();
    if !individually {
        for c in paths {
            for (s, e) in &ranges {
                if let Some(part) = c.slice(*s, *e) {
                    out.push(part);
                }
            }
        }
        return out;
    }
    let lens: Vec<f64> = paths.iter().map(|c| c.lengths().1).collect();
    let total: f64 = lens.iter().sum();
    if total <= 1e-9 {
        return Vec::new();
    }
    for (s, e) in &ranges {
        let (ls, le) = (s * total, e * total);
        let mut acc = 0.0;
        for (c, l) in paths.iter().zip(&lens) {
            let (c0, c1) = (acc, acc + l);
            acc = c1;
            if *l <= 1e-12 || c1 <= ls || c0 >= le {
                continue;
            }
            let fs = ((ls - c0) / l).clamp(0.0, 1.0);
            let fe = ((le - c0) / l).clamp(0.0, 1.0);
            if let Some(part) = c.slice(fs, fe) {
                out.push(part);
            }
        }
    }
    out
}

// ---------------------------------------------------------------- painting

fn polylines(shapes: &[Contour], m: &Mat) -> Vec<(Vec<[f64; 2]>, bool)> {
    shapes.iter().filter(|c| !c.is_empty()).map(|c| (c.transformed(m).flatten(1.0), c.closed)).collect()
}

fn fill_path_of(shapes: &[Contour], m: &Mat) -> Path {
    let mut p = Path::new();
    for (pts, _) in polylines(shapes, m) {
        if pts.len() < 2 {
            continue;
        }
        p.move_to(pts[0][0] as f32, pts[0][1] as f32);
        for q in &pts[1..] {
            p.line_to(q[0] as f32, q[1] as f32);
        }
        p.close();
    }
    p
}

fn stroke_path_of(shapes: &[Contour], m: &Mat, st: &StrokeStyle, dashes: &[f64], dash_offset: f64) -> Path {
    let k = geom::mat_scale(m);
    let style = StrokeStyle { width: st.width * k, ..st.clone() };
    let pattern: Vec<f64> = dashes.iter().map(|d| d * k).collect();
    let mut p = Path::new();
    for (pts, closed) in polylines(shapes, m) {
        if pattern.iter().any(|d| *d > 0.0) {
            for piece in geom::dash_polyline(&pts, closed, &pattern, dash_offset * k) {
                geom::stroke_polyline(&mut p, &piece, false, &style);
            }
        } else {
            geom::stroke_polyline(&mut p, &pts, closed, &style);
        }
    }
    p
}

fn gradient_px(g: &Gradient, m: &Mat) -> Gradient {
    Gradient { radial: g.radial, start: geom::apply(m, g.start), end: geom::apply(m, g.end), stops: g.stops.clone() }
}

/// Paint `ops` (last first) through matrix `m` with `opacity` onto `canvas`.
pub fn draw_ops(ops: &[Op], m: &Mat, opacity: f32, canvas: &mut Canvas) {
    for op in ops.iter().rev() {
        match op {
            Op::Fill { shapes, color, even_odd, blend } => {
                let c = [color[0], color[1], color[2], color[3] * opacity];
                if c[3] > 0.0 {
                    canvas.fill_path(&fill_path_of(shapes, m), c, *even_odd, *blend);
                }
            }
            Op::Stroke { shapes, color, stroke, dashes, dash_offset, blend } => {
                let c = [color[0], color[1], color[2], color[3] * opacity];
                if c[3] > 0.0 && stroke.width > 0.0 {
                    canvas.fill_path(&stroke_path_of(shapes, m, stroke, dashes, *dash_offset), c, false, *blend);
                }
            }
            Op::GradFill { shapes, grad, opacity: o, even_odd, blend } => {
                canvas.fill_gradient(&fill_path_of(shapes, m), &gradient_px(grad, m), o * opacity, *even_odd, *blend);
            }
            Op::GradStroke { shapes, grad, opacity: o, stroke, dashes, dash_offset, blend } => {
                if stroke.width > 0.0 {
                    canvas.fill_gradient(&stroke_path_of(shapes, m, stroke, dashes, *dash_offset), &gradient_px(grad, m), o * opacity, false, *blend);
                }
            }
            Op::Group { matrix, opacity: o, ops } => draw_ops(ops, &geom::mul(m, matrix), opacity * o, canvas),
        }
    }
}
