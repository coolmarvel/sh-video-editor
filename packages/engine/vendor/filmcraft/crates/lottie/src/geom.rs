//! Geometry: 2D affine matrices, cubic Bezier contours (Lottie `sh` paths and the parametric
//! shapes), trimming, flattening to polylines and stroking polylines into fillable outlines.

use crate::anim::{Interp, cubic_point};

/// A 2x3 affine matrix `[a, b, c, d, e, f]`: (x, y) -> (a x + c y + e, b x + d y + f).
pub type Mat = [f64; 6];

pub const IDENTITY: Mat = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];

#[inline]
pub fn apply(m: &Mat, p: [f64; 2]) -> [f64; 2] {
    [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]]
}

/// `a` after `b` (apply `b` first).
pub fn mul(a: &Mat, b: &Mat) -> Mat {
    [
        a[0] * b[0] + a[2] * b[1],
        a[1] * b[0] + a[3] * b[1],
        a[0] * b[2] + a[2] * b[3],
        a[1] * b[2] + a[3] * b[3],
        a[0] * b[4] + a[2] * b[5] + a[4],
        a[1] * b[4] + a[3] * b[5] + a[5],
    ]
}

pub fn translate(x: f64, y: f64) -> Mat {
    [1.0, 0.0, 0.0, 1.0, x, y]
}

pub fn scale(sx: f64, sy: f64) -> Mat {
    [sx, 0.0, 0.0, sy, 0.0, 0.0]
}

pub fn rotate(deg: f64) -> Mat {
    let (s, c) = deg.to_radians().sin_cos();
    [c, s, -s, c, 0.0, 0.0]
}

/// Skew by `deg` along the axis rotated by `axis_deg` (After Effects' Skew / Skew Axis).
pub fn skew(deg: f64, axis_deg: f64) -> Mat {
    let t = -deg.to_radians().tan();
    mul(&rotate(axis_deg), &mul(&[1.0, 0.0, t, 1.0, 0.0, 0.0], &rotate(-axis_deg)))
}

/// Average linear scale (stroke widths, flattening tolerance).
pub fn mat_scale(m: &Mat) -> f64 {
    (m[0] * m[3] - m[1] * m[2]).abs().sqrt()
}

pub fn to_xform(m: &Mat) -> filmcraft_text::raster::Xform {
    [m[0] as f32, m[1] as f32, m[2] as f32, m[3] as f32, m[4] as f32, m[5] as f32]
}

/// A cubic Bezier contour: vertices with absolute in/out control points.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Contour {
    pub v: Vec<[f64; 2]>,
    /// Absolute incoming control point of each vertex.
    pub i: Vec<[f64; 2]>,
    /// Absolute outgoing control point of each vertex.
    pub o: Vec<[f64; 2]>,
    pub closed: bool,
}

impl Contour {
    pub fn polygon(pts: &[[f64; 2]], closed: bool) -> Self {
        Self { v: pts.to_vec(), i: pts.to_vec(), o: pts.to_vec(), closed }
    }

    pub fn is_empty(&self) -> bool {
        self.v.len() < 2
    }

    /// Number of Bezier segments.
    pub fn segments(&self) -> usize {
        if self.closed { self.v.len() } else { self.v.len().saturating_sub(1) }
    }

    /// Control points of segment `k`.
    pub fn segment(&self, k: usize) -> Option<[[f64; 2]; 4]> {
        let n = self.v.len();
        if n == 0 {
            return None;
        }
        let j = (k + 1) % n;
        Some([*self.v.get(k)?, *self.o.get(k)?, *self.i.get(j)?, *self.v.get(j)?])
    }

    pub fn transformed(&self, m: &Mat) -> Self {
        let t = |pts: &[[f64; 2]]| pts.iter().map(|p| apply(m, *p)).collect();
        Self { v: t(&self.v), i: t(&self.i), o: t(&self.o), closed: self.closed }
    }

    /// Same shape, opposite winding.
    pub fn reversed(&self) -> Self {
        let mut v = self.v.clone();
        let mut i = self.o.clone();
        let mut o = self.i.clone();
        v.reverse();
        i.reverse();
        o.reverse();
        Self { v, i, o, closed: self.closed }
    }

    /// Length of each segment (16 samples) and the total.
    pub fn lengths(&self) -> (Vec<f64>, f64) {
        let mut out = Vec::with_capacity(self.segments());
        let mut total = 0.0;
        for k in 0..self.segments() {
            let Some([p0, p1, p2, p3]) = self.segment(k) else { continue };
            let mut l = 0.0;
            let mut prev = p0;
            for s in 1..=16 {
                let p = cubic_point(p0, p1, p2, p3, s as f64 / 16.0);
                l += ((p[0] - prev[0]).powi(2) + (p[1] - prev[1]).powi(2)).sqrt();
                prev = p;
            }
            out.push(l);
            total += l;
        }
        (out, total)
    }

    /// The part of the contour between length fractions `a..b` (0..1 of its own length), as an
    /// open contour; `None` when nothing remains.
    pub fn slice(&self, a: f64, b: f64) -> Option<Contour> {
        let (lens, total) = self.lengths();
        if total <= 1e-9 || b <= a {
            return None;
        }
        let (la, lb) = (a.clamp(0.0, 1.0) * total, b.clamp(0.0, 1.0) * total);
        let mut out = Contour { closed: false, ..Default::default() };
        let mut acc = 0.0;
        for (k, l) in lens.iter().enumerate() {
            let (s0, s1) = (acc, acc + l);
            acc = s1;
            if s1 <= la || s0 >= lb || *l <= 1e-12 {
                continue;
            }
            let Some([p0, p1, p2, p3]) = self.segment(k) else { continue };
            let t0 = ((la - s0) / l).clamp(0.0, 1.0);
            let t1 = ((lb - s0) / l).clamp(0.0, 1.0);
            let [q0, q1, q2, q3] = sub_cubic(p0, p1, p2, p3, t0, t1);
            if out.v.is_empty() {
                out.v.push(q0);
                out.i.push(q0);
                out.o.push(q1);
            } else if let Some(last) = out.o.last_mut() {
                *last = q1;
            }
            out.v.push(q3);
            out.i.push(q2);
            out.o.push(q3);
        }
        (out.v.len() >= 2).then_some(out)
    }

    /// Flatten to a polyline in the same space (`tol` is the scale of this space to pixels; the
    /// chord error stays under [`FLATTEN_PX`] pixels).
    pub fn flatten(&self, tol: f64) -> Vec<[f64; 2]> {
        let mut pts = Vec::with_capacity(self.v.len() * 4);
        if let Some(first) = self.v.first() {
            pts.push(*first);
        }
        for k in 0..self.segments() {
            let Some([p0, p1, p2, p3]) = self.segment(k) else { continue };
            let n = flatten_steps(p0, p1, p2, p3, tol);
            for s in 1..=n {
                let p = cubic_point(p0, p1, p2, p3, s as f64 / n as f64);
                if pts.last() != Some(&p) {
                    pts.push(p);
                }
            }
        }
        if self.closed && pts.len() > 2 && pts.first() == pts.last() {
            pts.pop();
        }
        pts
    }
}

/// Largest chord error of a flattened curve, in pixels.
pub const FLATTEN_PX: f64 = 0.05;

/// Line segments for a cubic so the chord error stays under [`FLATTEN_PX`] (a cubic's distance
/// from its chords is at most 3/4 of its largest second difference divided by n squared); a
/// straight segment (control points on the chord) is one line.
fn flatten_steps(p0: [f64; 2], p1: [f64; 2], p2: [f64; 2], p3: [f64; 2], tol: f64) -> usize {
    let (cx, cy) = (p3[0] - p0[0], p3[1] - p0[1]);
    let cross = |q: [f64; 2]| ((q[0] - p0[0]) * cy - (q[1] - p0[1]) * cx).abs();
    let chord2 = cx * cx + cy * cy;
    if cross(p1) <= 1e-9 * chord2.max(1e-12) && cross(p2) <= 1e-9 * chord2.max(1e-12) {
        // on the chord: straight, unless the controls overshoot the ends
        let along = |q: [f64; 2]| (q[0] - p0[0]) * cx + (q[1] - p0[1]) * cy;
        if (0.0..=chord2).contains(&along(p1)) && (0.0..=chord2).contains(&along(p2)) {
            return 1;
        }
    }
    let d1 = ((p0[0] - 2.0 * p1[0] + p2[0]).powi(2) + (p0[1] - 2.0 * p1[1] + p2[1]).powi(2)).sqrt();
    let d2 = ((p1[0] - 2.0 * p2[0] + p3[0]).powi(2) + (p1[1] - 2.0 * p2[1] + p3[1]).powi(2)).sqrt();
    let dd = d1.max(d2) * tol.abs();
    let n = (0.75 * dd / FLATTEN_PX).sqrt().ceil();
    if n.is_finite() { (n as usize).clamp(1, 128) } else { 1 }
}

/// The cubic between parameters `t0..t1` (de Casteljau twice).
fn sub_cubic(p0: [f64; 2], p1: [f64; 2], p2: [f64; 2], p3: [f64; 2], t0: f64, t1: f64) -> [[f64; 2]; 4] {
    let (_, right) = split(p0, p1, p2, p3, t0);
    let u = if (1.0 - t0).abs() < 1e-12 { 0.0 } else { ((t1 - t0) / (1.0 - t0)).clamp(0.0, 1.0) };
    let (left, _) = split(right[0], right[1], right[2], right[3], u);
    left
}

fn lerp(a: [f64; 2], b: [f64; 2], t: f64) -> [f64; 2] {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

fn split(p0: [f64; 2], p1: [f64; 2], p2: [f64; 2], p3: [f64; 2], t: f64) -> ([[f64; 2]; 4], [[f64; 2]; 4]) {
    let p01 = lerp(p0, p1, t);
    let p12 = lerp(p1, p2, t);
    let p23 = lerp(p2, p3, t);
    let p012 = lerp(p01, p12, t);
    let p123 = lerp(p12, p23, t);
    let m = lerp(p012, p123, t);
    ([p0, p01, p012, m], [m, p123, p23, p3])
}

/// A shape (`sh`) value: one contour; animated per vertex.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PathData(pub Contour);

impl Interp for PathData {
    fn mix(a: &Self, b: &Self, p: &[f64]) -> Self {
        let t = p.first().copied().unwrap_or(0.0);
        if a.0.v.len() != b.0.v.len() {
            return if t < 0.5 { a.clone() } else { b.clone() };
        }
        let mix = |x: &[[f64; 2]], y: &[[f64; 2]]| x.iter().zip(y).map(|(u, v)| lerp(*u, *v, t)).collect();
        PathData(Contour { v: mix(&a.0.v, &b.0.v), i: mix(&a.0.i, &b.0.i), o: mix(&a.0.o, &b.0.o), closed: a.0.closed })
    }
    fn dims(&self) -> usize {
        1
    }
}

// ---------------------------------------------------------------- parametric shapes

const KAPPA: f64 = 0.552_284_75;

/// Ellipse centred at `c` with size `s` (After Effects winds clockwise on screen from the top).
pub fn ellipse(c: [f64; 2], s: [f64; 2]) -> Contour {
    let (rx, ry) = (s[0] / 2.0, s[1] / 2.0);
    let (kx, ky) = (KAPPA * rx, KAPPA * ry);
    let v = [[c[0], c[1] - ry], [c[0] + rx, c[1]], [c[0], c[1] + ry], [c[0] - rx, c[1]]];
    let o = [[c[0] + kx, c[1] - ry], [c[0] + rx, c[1] + ky], [c[0] - kx, c[1] + ry], [c[0] - rx, c[1] - ky]];
    let i = [[c[0] - kx, c[1] - ry], [c[0] + rx, c[1] - ky], [c[0] + kx, c[1] + ry], [c[0] - rx, c[1] + ky]];
    Contour { v: v.to_vec(), i: i.to_vec(), o: o.to_vec(), closed: true }
}

/// Rectangle centred at `c` with size `s` and corner radius `r` (clockwise from the top right).
pub fn rect(c: [f64; 2], s: [f64; 2], r: f64) -> Contour {
    let (hw, hh) = (s[0].abs() / 2.0, s[1].abs() / 2.0);
    let r = r.max(0.0).min(hw).min(hh);
    let (x0, y0, x1, y1) = (c[0] - hw, c[1] - hh, c[0] + hw, c[1] + hh);
    if r < 1e-9 {
        return Contour::polygon(&[[x1, y0], [x1, y1], [x0, y1], [x0, y0]], true);
    }
    let k = KAPPA * r;
    let v = [[x1 - r, y0], [x1, y0 + r], [x1, y1 - r], [x1 - r, y1], [x0 + r, y1], [x0, y1 - r], [x0, y0 + r], [x0 + r, y0]];
    let o = [[x1 - r + k, y0], [x1, y0 + r], [x1, y1 - r + k], [x1 - r, y1], [x0 + r - k, y1], [x0, y1 - r], [x0, y0 + r - k], [x0 + r, y0]];
    let i = [[x1 - r, y0], [x1, y0 + r - k], [x1, y1 - r], [x1 - r + k, y1], [x0 + r, y1], [x0, y1 - r + k], [x0, y0 + r], [x0 + r - k, y0]];
    Contour { v: v.to_vec(), i: i.to_vec(), o: o.to_vec(), closed: true }
}

/// Star (`inner` = Some(inner radius, inner roundness)) or polygon with `points` points of outer
/// radius `or`, rotated `rot` degrees, roundness in percent.
pub fn star(c: [f64; 2], points: f64, or: f64, os: f64, inner: Option<(f64, f64)>, rot: f64) -> Contour {
    // at most 1000 points: odd files ask for billions
    let n = if points.is_finite() { points.round().clamp(3.0, 1000.0) as usize } else { 3 };
    let count = if inner.is_some() { n * 2 } else { n };
    let mut v = Vec::with_capacity(count);
    let mut i = Vec::with_capacity(count);
    let mut o = Vec::with_capacity(count);
    let step = std::f64::consts::TAU / count as f64;
    let mut ang = -std::f64::consts::FRAC_PI_2 + rot.to_radians();
    // tangent length per vertex, as lottie-web: roundness * radius * perimeter factor
    let k = 0.25 * std::f64::consts::TAU / count as f64 * 2.0 / std::f64::consts::PI;
    for idx in 0..count {
        let (r, round) = match inner {
            Some((ir, is)) if idx % 2 == 1 => (ir, is),
            _ => (or, os),
        };
        let p = [c[0] + r * ang.cos(), c[1] + r * ang.sin()];
        let (tx, ty) = (-ang.sin(), ang.cos());
        let d = r * round / 100.0 * k;
        v.push(p);
        o.push([p[0] + tx * d, p[1] + ty * d]);
        i.push([p[0] - tx * d, p[1] - ty * d]);
        ang += step;
    }
    Contour { v, i, o, closed: true }
}

// ---------------------------------------------------------------- strokes

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Cap {
    Butt,
    Round,
    Square,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Join {
    Miter,
    Round,
    Bevel,
}

/// Parameters of a stroke in pixel space.
#[derive(Clone, Debug)]
pub struct StrokeStyle {
    pub width: f64,
    pub cap: Cap,
    pub join: Join,
    pub miter_limit: f64,
}

fn push_poly(path: &mut filmcraft_text::raster::Path, pts: &[[f64; 2]]) {
    if pts.len() < 3 {
        return;
    }
    // consistent orientation so overlapping pieces add up under non-zero winding
    let mut area = 0.0;
    for k in 0..pts.len() {
        let (a, b) = (pts[k], pts[(k + 1) % pts.len()]);
        area += a[0] * b[1] - b[0] * a[1];
    }
    let it: Box<dyn Iterator<Item = &[f64; 2]>> = if area < 0.0 { Box::new(pts.iter().rev()) } else { Box::new(pts.iter()) };
    let mut first = true;
    for p in it {
        if first {
            path.move_to(p[0] as f32, p[1] as f32);
            first = false;
        } else {
            path.line_to(p[0] as f32, p[1] as f32);
        }
    }
    path.close();
}

fn circle(path: &mut filmcraft_text::raster::Path, c: [f64; 2], r: f64) {
    let n = ((r * 2.0).ceil() as usize).clamp(8, 48);
    let pts: Vec<[f64; 2]> = (0..n)
        .map(|k| {
            let a = k as f64 / n as f64 * std::f64::consts::TAU;
            [c[0] + r * a.cos(), c[1] + r * a.sin()]
        })
        .collect();
    push_poly(path, &pts);
}

/// Outline of `pts` stroked with `st`, added to `path` as consistently wound polygons (fill
/// non-zero to get the stroke).
pub fn stroke_polyline(path: &mut filmcraft_text::raster::Path, pts: &[[f64; 2]], closed: bool, st: &StrokeStyle) {
    let hw = st.width / 2.0;
    if hw <= 0.0 || pts.is_empty() {
        return;
    }
    let mut p: Vec<[f64; 2]> = Vec::with_capacity(pts.len());
    for q in pts {
        if p.last().is_none_or(|l| (l[0] - q[0]).abs() > 1e-9 || (l[1] - q[1]).abs() > 1e-9) {
            p.push(*q);
        }
    }
    if closed && p.len() > 2 && p.first() == p.last() {
        p.pop();
    }
    if p.len() == 1 {
        // a dot: round caps draw a disc, square caps a square, butt nothing
        match st.cap {
            Cap::Round => circle(path, p[0], hw),
            Cap::Square => {
                push_poly(path, &[[p[0][0] - hw, p[0][1] - hw], [p[0][0] + hw, p[0][1] - hw], [p[0][0] + hw, p[0][1] + hw], [p[0][0] - hw, p[0][1] + hw]])
            }
            Cap::Butt => {}
        }
        return;
    }
    let n = p.len();
    let segs = if closed { n } else { n - 1 };
    let normal = |a: [f64; 2], b: [f64; 2]| {
        let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
        let l = (dx * dx + dy * dy).sqrt().max(1e-12);
        ([dx / l, dy / l], [-dy / l * hw, dx / l * hw])
    };
    for k in 0..segs {
        let (mut a, mut b) = (p[k], p[(k + 1) % n]);
        let (d, nrm) = normal(a, b);
        if !closed && st.cap == Cap::Square {
            if k == 0 {
                a = [a[0] - d[0] * hw, a[1] - d[1] * hw];
            }
            if k == segs - 1 {
                b = [b[0] + d[0] * hw, b[1] + d[1] * hw];
            }
        }
        push_poly(path, &[[a[0] + nrm[0], a[1] + nrm[1]], [b[0] + nrm[0], b[1] + nrm[1]], [b[0] - nrm[0], b[1] - nrm[1]], [a[0] - nrm[0], a[1] - nrm[1]]]);
    }
    // joins
    let joins: Vec<usize> = if closed { (0..n).collect() } else { (1..n - 1).collect() };
    for k in joins {
        let (prev, cur, next) = (p[(k + n - 1) % n], p[k], p[(k + 1) % n]);
        match st.join {
            Join::Round => circle(path, cur, hw),
            Join::Miter | Join::Bevel => {
                let (d1, n1) = normal(prev, cur);
                let (d2, n2) = normal(cur, next);
                let cross = d1[0] * d2[1] - d1[1] * d2[0];
                if cross.abs() < 1e-9 {
                    continue;
                }
                // outer side of the turn
                let s = if cross > 0.0 { -1.0 } else { 1.0 };
                let (a, b) = ([cur[0] + n1[0] * s, cur[1] + n1[1] * s], [cur[0] + n2[0] * s, cur[1] + n2[1] * s]);
                let mut poly = vec![cur, a];
                if st.join == Join::Miter {
                    let cos_theta = -(d1[0] * d2[0] + d1[1] * d2[1]);
                    let half = ((1.0 - cos_theta) / 2.0).max(1e-9).sqrt();
                    let miter_len = 1.0 / half;
                    if miter_len <= st.miter_limit.max(1.0) {
                        let mx = (a[0] + b[0]) / 2.0 - cur[0];
                        let my = (a[1] + b[1]) / 2.0 - cur[1];
                        let ml = (mx * mx + my * my).sqrt().max(1e-12);
                        let len = hw * miter_len;
                        poly.push([cur[0] + mx / ml * len, cur[1] + my / ml * len]);
                    }
                }
                poly.push(b);
                push_poly(path, &poly);
            }
        }
    }
    if !closed && st.cap == Cap::Round {
        circle(path, p[0], hw);
        circle(path, p[n - 1], hw);
    }
}

/// Split a polyline into dashes (`pattern` = alternating dash/gap lengths, `offset` shifts the
/// start). An empty or all-zero pattern returns the polyline whole.
pub fn dash_polyline(pts: &[[f64; 2]], closed: bool, pattern: &[f64], offset: f64) -> Vec<Vec<[f64; 2]>> {
    let pattern: Vec<f64> = pattern.iter().map(|d| d.max(0.0)).collect();
    let period: f64 = pattern.iter().sum();
    if pattern.is_empty() || period <= 1e-9 || pts.len() < 2 {
        return vec![pts.to_vec()];
    }
    let mut pts = pts.to_vec();
    if closed && pts.first() != pts.last() {
        pts.push(pts[0]);
    }
    let mut out = Vec::new();
    let mut idx = 0usize;
    let mut remain = pattern[0];
    let mut on = true;
    // apply the offset by walking the pattern
    let mut off = offset.rem_euclid(period);
    while off > 0.0 {
        if off >= remain {
            off -= remain;
            idx = (idx + 1) % pattern.len();
            remain = pattern[idx];
            on = !on;
        } else {
            remain -= off;
            off = 0.0;
        }
    }
    let mut cur: Vec<[f64; 2]> = if on { vec![pts[0]] } else { Vec::new() };
    for w in pts.windows(2) {
        let (a, b) = (w[0], w[1]);
        let seg = ((b[0] - a[0]).powi(2) + (b[1] - a[1]).powi(2)).sqrt();
        let mut pos = 0.0;
        while seg - pos > remain {
            pos += remain;
            let t = pos / seg;
            let p = lerp(a, b, t);
            if on {
                cur.push(p);
                if cur.len() >= 2 {
                    out.push(std::mem::take(&mut cur));
                } else {
                    cur.clear();
                }
            } else {
                cur = vec![p];
            }
            on = !on;
            idx = (idx + 1) % pattern.len();
            remain = pattern[idx].max(1e-6);
        }
        remain -= seg - pos;
        if on {
            cur.push(b);
        }
    }
    if on && cur.len() >= 2 {
        out.push(cur);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matrices_compose_and_apply() {
        let m = mul(&translate(10.0, 0.0), &scale(2.0, 2.0));
        assert_eq!(apply(&m, [1.0, 1.0]), [12.0, 2.0]);
        assert!((mat_scale(&m) - 2.0).abs() < 1e-9);
        let r = rotate(90.0);
        let p = apply(&r, [1.0, 0.0]);
        assert!((p[0]).abs() < 1e-9 && (p[1] - 1.0).abs() < 1e-9, "{p:?}");
    }

    #[test]
    fn ellipse_and_rect_flatten_to_expected_area() {
        let area = |pts: &[[f64; 2]]| {
            let mut a = 0.0;
            for k in 0..pts.len() {
                let (p, q) = (pts[k], pts[(k + 1) % pts.len()]);
                a += p[0] * q[1] - q[0] * p[1];
            }
            a / 2.0
        };
        let e = ellipse([0.0, 0.0], [20.0, 10.0]).flatten(1.0);
        assert!((area(&e) - std::f64::consts::PI * 10.0 * 5.0).abs() < 2.0, "{}", area(&e));
        let r = rect([0.0, 0.0], [20.0, 10.0], 0.0).flatten(1.0);
        assert!((area(&r) - 200.0).abs() < 1e-9);
        assert!(area(&rect([0.0, 0.0], [20.0, 10.0], 0.0).reversed().flatten(1.0)) < 0.0);
        let rr = rect([0.0, 0.0], [20.0, 10.0], 3.0).flatten(1.0);
        assert!(area(&rr) < 200.0 && area(&rr) > 190.0, "{}", area(&rr));
    }

    #[test]
    fn star_has_two_points_per_corner() {
        let s = star([0.0, 0.0], 5.0, 10.0, 0.0, Some((5.0, 0.0)), 0.0);
        assert_eq!(s.v.len(), 10);
        assert!((s.v[0][1] + 10.0).abs() < 1e-9, "first point is at the top: {:?}", s.v[0]);
        let p = star([0.0, 0.0], 6.0, 10.0, 0.0, None, 0.0);
        assert_eq!(p.v.len(), 6);
    }

    #[test]
    fn slice_keeps_the_middle_of_a_line() {
        let c = Contour::polygon(&[[0.0, 0.0], [10.0, 0.0], [10.0, 10.0]], false);
        let s = c.slice(0.25, 0.75).unwrap();
        assert!((s.v[0][0] - 5.0).abs() < 1e-6 && (s.v.last().unwrap()[1] - 5.0).abs() < 1e-6, "{s:?}");
        assert!(c.slice(0.5, 0.5).is_none());
        let (lens, total) = c.lengths();
        assert_eq!(lens.len(), 2);
        assert!((total - 20.0).abs() < 1e-6);
    }

    #[test]
    fn stroke_outline_area_matches_width_times_length() {
        let mut path = filmcraft_text::raster::Path::new();
        stroke_polyline(&mut path, &[[2.0, 5.0], [18.0, 5.0]], false, &StrokeStyle { width: 2.0, cap: Cap::Butt, join: Join::Miter, miter_limit: 4.0 });
        let m = filmcraft_text::raster::fill(&path, 20, 10, 0.0, 0.0);
        let total: f32 = m.a.iter().sum();
        assert!((total - 32.0).abs() < 0.5, "{total}");
        let mut sq = filmcraft_text::raster::Path::new();
        stroke_polyline(&mut sq, &[[2.0, 5.0], [18.0, 5.0]], false, &StrokeStyle { width: 2.0, cap: Cap::Square, join: Join::Miter, miter_limit: 4.0 });
        let total_sq: f32 = filmcraft_text::raster::fill(&sq, 20, 10, 0.0, 0.0).a.iter().sum();
        assert!((total_sq - 36.0).abs() < 0.5, "{total_sq}");
    }

    #[test]
    fn dashes_split_by_pattern() {
        let d = dash_polyline(&[[0.0, 0.0], [10.0, 0.0]], false, &[2.0, 3.0], 0.0);
        assert_eq!(d.len(), 2, "{d:?}");
        assert!((d[0][1][0] - 2.0).abs() < 1e-9);
        assert!((d[1][0][0] - 5.0).abs() < 1e-9 && (d[1][1][0] - 7.0).abs() < 1e-9);
        assert_eq!(dash_polyline(&[[0.0, 0.0], [10.0, 0.0]], false, &[], 0.0).len(), 1);
    }
}
