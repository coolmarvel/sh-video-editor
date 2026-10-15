//! Animated properties: Lottie keyframes evaluated at a (fractional) frame.
//!
//! A Lottie keyframe holds the start value `s` of a segment (legacy files also carry the end value
//! `e`) and the segment's normalised cubic Bezier ease: `o` (out tangent of this key) and `i` (in
//! tangent of the next key), each with `x` (time fraction) and `y` (value progress fraction),
//! scalar or per dimension. Hold keys set `h: 1`. Spatial (position) keys carry `to`/`ti`
//! tangents and move along the cubic between the two values.
//!
//! The value converters (`nums`, `to_color`, `is_animated`) and the ease reading follow the
//! effectcraft `lottie` crate's `anim.rs` (import side); the evaluation is this crate's own since
//! the values are sampled directly instead of becoming project keyframes.

use serde_json::Value as Json;

/// Something keyframes can interpolate: a list of components, mixed per dimension.
pub trait Interp: Clone {
    /// Mix `a` and `b` with progress `p[d]` per dimension (`p` has at least one entry; a value
    /// with more dimensions than eases uses the last one).
    fn mix(a: &Self, b: &Self, p: &[f64]) -> Self;
    /// Number of eased dimensions (1 for paths: the whole shape eases together).
    fn dims(&self) -> usize;
}

impl Interp for Vec<f64> {
    fn mix(a: &Self, b: &Self, p: &[f64]) -> Self {
        a.iter().enumerate().map(|(d, x)| x + (b.get(d).copied().unwrap_or(*x) - x) * p.get(d).or(p.last()).copied().unwrap_or(0.0)).collect()
    }
    fn dims(&self) -> usize {
        self.len().max(1)
    }
}

/// One keyframe (start value of the segment it opens).
#[derive(Clone, Debug)]
pub struct Key<T> {
    pub t: f64,
    pub s: T,
    pub hold: bool,
    /// Normalised ease per dimension: (o.x, o.y, i.x, i.y).
    pub ease: Vec<[f64; 4]>,
    /// Spatial tangents (relative to the segment ends), when the segment is a motion path.
    pub to: Option<[f64; 2]>,
    pub ti: Option<[f64; 2]>,
}

#[derive(Clone, Debug)]
pub enum Animated<T> {
    Const(T),
    Keys(Vec<Key<T>>),
}

impl<T: Interp> Animated<T> {
    pub fn is_animated(&self) -> bool {
        matches!(self, Animated::Keys(k) if k.len() > 1)
    }

    /// The value at `frame` (keys are in the owner's local frames).
    pub fn at(&self, frame: f64) -> T {
        match self {
            Animated::Const(v) => v.clone(),
            Animated::Keys(keys) => {
                let Some(first) = keys.first() else { return T::mix(&keys[0].s, &keys[0].s, &[0.0]) };
                if frame <= first.t || keys.len() == 1 {
                    return first.s.clone();
                }
                let Some(last) = keys.last() else { return first.s.clone() };
                if frame >= last.t {
                    return last.s.clone();
                }
                let i = keys.iter().rposition(|k| k.t <= frame).unwrap_or(0);
                let (a, b) = (&keys[i], &keys[(i + 1).min(keys.len() - 1)]);
                if a.hold || b.t <= a.t {
                    return a.s.clone();
                }
                let u = ((frame - a.t) / (b.t - a.t)).clamp(0.0, 1.0);
                let dims = a.s.dims();
                let p: Vec<f64> = (0..dims).map(|d| eased(a.ease.get(d).or(a.ease.last()), u)).collect();
                T::mix(&a.s, &b.s, &p)
            }
        }
    }
}

impl Animated<Vec<f64>> {
    /// Scalar value at `frame` (first component).
    pub fn f(&self, frame: f64) -> f64 {
        self.at(frame).first().copied().unwrap_or(0.0)
    }
    /// 2D value at `frame`, following a spatial Bezier when the segment has tangents.
    pub fn v2(&self, frame: f64) -> [f64; 2] {
        let v = |x: &[f64]| [x.first().copied().unwrap_or(0.0), x.get(1).copied().unwrap_or(0.0)];
        match self {
            Animated::Const(c) => v(c),
            Animated::Keys(keys) => {
                let i = keys.iter().rposition(|k| k.t <= frame).unwrap_or(0);
                let Some(a) = keys.get(i) else { return [0.0; 2] };
                let Some(b) = keys.get(i + 1) else { return v(&a.s) };
                if frame <= a.t || a.hold || b.t <= a.t {
                    return v(&a.s);
                }
                let (Some(to), Some(ti)) = (a.to, a.ti) else { return v(&self.at(frame)) };
                if to == [0.0; 2] && ti == [0.0; 2] {
                    return v(&self.at(frame));
                }
                let u = ((frame - a.t) / (b.t - a.t)).clamp(0.0, 1.0);
                let q = eased(a.ease.first(), u);
                let (p0, p3) = (v(&a.s), v(&b.s));
                let p1 = [p0[0] + to[0], p0[1] + to[1]];
                let p2 = [p3[0] + ti[0], p3[1] + ti[1]];
                let t = arc_param(p0, p1, p2, p3, q);
                cubic_point(p0, p1, p2, p3, t)
            }
        }
    }
    /// Colour `[r, g, b, a]` at `frame` (alpha defaults to 1).
    pub fn color(&self, frame: f64) -> [f32; 4] {
        let c = self.at(frame);
        let g = |i: usize, d: f64| c.get(i).copied().unwrap_or(d).clamp(0.0, 1.0) as f32;
        [g(0, 0.0), g(1, 0.0), g(2, 0.0), g(3, 1.0)]
    }
}

/// Progress through a normalised ease `(ox, oy, ix, iy)` at time fraction `u`.
pub fn eased(e: Option<&[f64; 4]>, u: f64) -> f64 {
    let Some(&[ox, oy, ix, iy]) = e else { return u };
    if (ox - oy).abs() < 1e-9 && (ix - iy).abs() < 1e-9 {
        return u;
    }
    let t = solve_bezier_x(ox, ix, u);
    bez1(oy, iy, t)
}

/// One-dimensional cubic Bezier through (0, 0), (0, c1), (0, c2), (1, 1) at `t`.
fn bez1(c1: f64, c2: f64, t: f64) -> f64 {
    let mt = 1.0 - t;
    3.0 * mt * mt * t * c1 + 3.0 * mt * t * t * c2 + t * t * t
}

/// Parameter `t` with `bez1(x1, x2, t) == x` (Newton steps, bisection fallback).
fn solve_bezier_x(x1: f64, x2: f64, x: f64) -> f64 {
    if x <= 0.0 {
        return 0.0;
    }
    if x >= 1.0 {
        return 1.0;
    }
    let mut t = x;
    for _ in 0..8 {
        let mt = 1.0 - t;
        let d = 3.0 * mt * mt * x1 + 6.0 * mt * t * (x2 - x1) + 3.0 * t * t * (1.0 - x2);
        if d.abs() < 1e-9 {
            break;
        }
        let nt = t - (bez1(x1, x2, t) - x) / d;
        if !(0.0..=1.0).contains(&nt) {
            break;
        }
        if (nt - t).abs() < 1e-7 {
            return nt;
        }
        t = nt;
    }
    if (bez1(x1, x2, t) - x).abs() < 1e-5 {
        return t;
    }
    let (mut lo, mut hi) = (0.0, 1.0);
    for _ in 0..40 {
        t = (lo + hi) / 2.0;
        if bez1(x1, x2, t) < x {
            lo = t;
        } else {
            hi = t;
        }
    }
    t
}

pub fn cubic_point(p0: [f64; 2], p1: [f64; 2], p2: [f64; 2], p3: [f64; 2], t: f64) -> [f64; 2] {
    let mt = 1.0 - t;
    let (a, b, c, d) = (mt * mt * mt, 3.0 * mt * mt * t, 3.0 * mt * t * t, t * t * t);
    [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]
}

/// The curve parameter at fraction `q` of the arc length (sampled: motion paths move at a
/// speed set by the temporal ease, not by the curve's parameter).
fn arc_param(p0: [f64; 2], p1: [f64; 2], p2: [f64; 2], p3: [f64; 2], q: f64) -> f64 {
    const N: usize = 32;
    let mut len = [0.0f64; N + 1];
    let mut prev = p0;
    let mut acc = 0.0;
    for (i, l) in len.iter_mut().enumerate().skip(1) {
        let p = cubic_point(p0, p1, p2, p3, i as f64 / N as f64);
        acc += ((p[0] - prev[0]).powi(2) + (p[1] - prev[1]).powi(2)).sqrt();
        *l = acc;
        prev = p;
    }
    let total = len[N];
    if total < 1e-9 {
        return q;
    }
    let want = q.clamp(0.0, 1.0) * total;
    let i = len.iter().rposition(|l| *l <= want).unwrap_or(0).min(N - 1);
    let seg = len[i + 1] - len[i];
    let f = if seg > 1e-12 { (want - len[i]) / seg } else { 0.0 };
    (i as f64 + f) / N as f64
}

// ---------------------------------------------------------------- JSON readers

/// Whether a Lottie property value is keyframed.
pub(crate) fn is_animated(j: &Json) -> bool {
    if j.get("a").and_then(Json::as_i64) == Some(1) {
        return true;
    }
    j.get("k").and_then(Json::as_array).and_then(|a| a.first()).is_some_and(|f| f.is_object() && f.get("t").is_some())
}

/// Numbers of a Lottie value (`5`, `[5]`, `[1, 2, 3]`, `[[1, 2]]`).
pub(crate) fn nums(j: &Json) -> Option<Vec<f64>> {
    match j {
        Json::Number(n) => Some(vec![n.as_f64()?]),
        Json::Array(a) => {
            if a.len() == 1
                && let Some(inner @ Json::Array(_)) = a.first()
            {
                return nums(inner);
            }
            a.iter().map(Json::as_f64).collect()
        }
        Json::Bool(b) => Some(vec![if *b { 1.0 } else { 0.0 }]),
        _ => None,
    }
}

/// Colour components, 0..1 (files using 0..255 are scaled down).
pub(crate) fn to_color(j: &Json) -> Option<Vec<f64>> {
    let v = nums(j)?;
    let mut c = vec![*v.first()?, *v.get(1).unwrap_or(&0.0), *v.get(2).unwrap_or(&0.0), *v.get(3).unwrap_or(&1.0)];
    if c[..3].iter().any(|x| *x > 1.0) {
        for x in &mut c[..3] {
            *x /= 255.0;
        }
    }
    Some(c)
}

/// Component `d` of an ease tangent field (`x` / `y` may be a number or an array).
fn comp(j: &Json, field: &str, d: usize) -> Option<f64> {
    match j.get(field)? {
        Json::Number(n) => n.as_f64(),
        Json::Array(a) => a.get(d).or(a.first()).and_then(Json::as_f64),
        _ => None,
    }
}

fn vec2_of(j: Option<&Json>) -> Option<[f64; 2]> {
    let v = nums(j?)?;
    Some([v.first().copied().unwrap_or(0.0), v.get(1).copied().unwrap_or(0.0)])
}

/// Read an animatable property with `conv` for the values; `default` when it is missing.
pub(crate) fn read<T: Interp>(j: Option<&Json>, default: T, conv: &dyn Fn(&Json) -> Option<T>) -> Animated<T> {
    let Some(j) = j else { return Animated::Const(default) };
    if !j.is_object() {
        return Animated::Const(conv(j).unwrap_or(default));
    }
    let Some(k) = j.get("k") else { return Animated::Const(default) };
    if !is_animated(j) {
        return Animated::Const(conv(k).unwrap_or(default));
    }
    let Some(list) = k.as_array() else { return Animated::Const(default) };
    let mut keys: Vec<Key<T>> = Vec::with_capacity(list.len());
    let mut prev_end: Option<&Json> = None;
    let mut ends: Vec<Option<T>> = Vec::with_capacity(list.len());
    for kj in list {
        let t = kj.get("t").and_then(Json::as_f64).unwrap_or(0.0);
        let sv = kj.get("s").or(prev_end);
        prev_end = kj.get("e");
        let Some(s) = sv.and_then(conv) else { continue };
        let hold = kj.get("h").and_then(Json::as_i64) == Some(1);
        let dims = s.dims();
        let ease = match (kj.get("o"), kj.get("i")) {
            (Some(o), Some(i)) if !hold => (0..dims)
                .map(|d| {
                    let ox = comp(o, "x", d).unwrap_or(1.0 / 3.0).clamp(0.0, 1.0);
                    let oy = comp(o, "y", d).unwrap_or(ox);
                    let ix = comp(i, "x", d).unwrap_or(2.0 / 3.0).clamp(0.0, 1.0);
                    let iy = comp(i, "y", d).unwrap_or(ix);
                    [ox, oy, ix, iy]
                })
                .collect(),
            _ => Vec::new(),
        };
        keys.push(Key { t, s, hold, ease, to: vec2_of(kj.get("to")), ti: vec2_of(kj.get("ti")) });
        ends.push(kj.get("e").and_then(conv));
    }
    // A last key with only a legacy `e` and no following key still ends the segment.
    if let (Some(last), Some(Some(e))) = (keys.last().cloned(), ends.last())
        && keys.len() == 1
    {
        let t = list.last().and_then(|k| k.get("t")).and_then(Json::as_f64).unwrap_or(last.t);
        if t > last.t {
            keys.push(Key { t, s: e.clone(), hold: true, ease: Vec::new(), to: None, ti: None });
        }
    }
    match keys.len() {
        0 => Animated::Const(default),
        1 => Animated::Const(keys.swap_remove(0).s),
        _ => Animated::Keys(keys),
    }
}

/// Numeric property (`k` number or array).
pub(crate) fn prop(j: Option<&Json>, default: &[f64]) -> Animated<Vec<f64>> {
    read(j, default.to_vec(), &nums)
}

/// Scalar property.
pub(crate) fn scalar(j: Option<&Json>, default: f64) -> Animated<Vec<f64>> {
    prop(j, &[default])
}

/// Colour property.
pub(crate) fn color(j: Option<&Json>, default: [f64; 4]) -> Animated<Vec<f64>> {
    read(j, default.to_vec(), &to_color)
}

/// An integer field (`"d": 3`, `"lc": 2`), also when wrapped as `{"k": n}`.
pub(crate) fn int(j: &Json, k: &str) -> Option<i64> {
    let v = j.get(k)?;
    v.as_i64().or_else(|| v.as_f64().map(|f| f.round() as i64)).or_else(|| v.get("k").and_then(nums).and_then(|n| n.first().map(|f| f.round() as i64)))
}
