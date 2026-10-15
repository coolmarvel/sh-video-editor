//! Pixel side: a premultiplied RGBA canvas, path fills through the `filmcraft-text` scanline
//! rasteriser (coverage limited to the path's bounding box), gradients, and layer compositing
//! (opacity, masks, track mattes, the blend modes stickers use).

use filmcraft_text::raster::{Mask, Path, fill_into_rule};

/// Premultiplied RGBA, sRGB (Lottie players composite in sRGB; so do we).
#[derive(Clone, Debug)]
pub struct Canvas {
    pub w: usize,
    pub h: usize,
    pub px: Vec<[f32; 4]>,
}

/// Blend modes with a per-channel formula; everything else composites as Normal.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Blend {
    #[default]
    Normal,
    Multiply,
    Screen,
    Add,
}

impl Blend {
    pub fn from_lottie(bm: i64) -> Blend {
        match bm {
            1 => Blend::Multiply,
            2 => Blend::Screen,
            16 => Blend::Add,
            _ => Blend::Normal,
        }
    }
}

/// Coverage of `path` inside the canvas: the bounding box (x0, y0) and a mask of its size.
pub fn coverage(path: &Path, w: usize, h: usize, even_odd: bool) -> Option<(usize, usize, Mask)> {
    let (bx0, by0, bx1, by1) = path.bounds()?;
    if !(bx0.is_finite() && by0.is_finite() && bx1.is_finite() && by1.is_finite()) {
        return None;
    }
    let x0 = (bx0.floor().max(0.0) as usize).min(w);
    let y0 = (by0.floor().max(0.0) as usize).min(h);
    let x1 = (bx1.ceil().max(0.0) as usize + 1).min(w);
    let y1 = (by1.ceil().max(0.0) as usize + 1).min(h);
    if x1 <= x0 || y1 <= y0 {
        return None;
    }
    let mut m = Mask::new(x1 - x0, y1 - y0);
    fill_into_rule(path, &mut m, -(x0 as f32), -(y0 as f32), even_odd);
    Some((x0, y0, m))
}

/// A gradient in pixel space.
#[derive(Clone, Debug)]
pub struct Gradient {
    pub radial: bool,
    pub start: [f64; 2],
    pub end: [f64; 2],
    /// Colour stops `(position, straight rgba)`, sorted by position.
    pub stops: Vec<(f64, [f32; 4])>,
}

impl Gradient {
    fn color_at(&self, t: f64) -> [f32; 4] {
        let t = if t.is_finite() { t.clamp(0.0, 1.0) } else { 0.0 };
        let Some(first) = self.stops.first() else { return [0.0; 4] };
        if t <= first.0 || self.stops.len() == 1 {
            return first.1;
        }
        let Some(last) = self.stops.last() else { return first.1 };
        if t >= last.0 {
            return last.1;
        }
        let k = self.stops.iter().rposition(|s| s.0 <= t).unwrap_or(0);
        let (a, b) = (self.stops[k], self.stops[(k + 1).min(self.stops.len() - 1)]);
        let f = if b.0 > a.0 { ((t - a.0) / (b.0 - a.0)) as f32 } else { 0.0 };
        [a.1[0] + (b.1[0] - a.1[0]) * f, a.1[1] + (b.1[1] - a.1[1]) * f, a.1[2] + (b.1[2] - a.1[2]) * f, a.1[3] + (b.1[3] - a.1[3]) * f]
    }
    fn param(&self, x: f64, y: f64) -> f64 {
        let (dx, dy) = (self.end[0] - self.start[0], self.end[1] - self.start[1]);
        let (px, py) = (x - self.start[0], y - self.start[1]);
        let len2 = dx * dx + dy * dy;
        if self.radial {
            if len2 <= 1e-12 { 1.0 } else { ((px * px + py * py) / len2).sqrt() }
        } else if len2 <= 1e-12 {
            0.0
        } else {
            (px * dx + py * dy) / len2
        }
    }
}

impl Canvas {
    pub fn new(w: usize, h: usize) -> Self {
        Self { w, h, px: vec![[0.0; 4]; w * h] }
    }

    /// Paint `color` (straight rgba, alpha carries the opacity) where the path covers, over the
    /// existing pixels.
    pub fn fill_path(&mut self, path: &Path, color: [f32; 4], even_odd: bool, blend: Blend) {
        let Some((x0, y0, m)) = coverage(path, self.w, self.h, even_odd) else { return };
        for y in 0..m.h {
            for x in 0..m.w {
                let c = m.a[y * m.w + x];
                if c <= 0.0 {
                    continue;
                }
                let a = c * color[3];
                self.blend_px((y0 + y) * self.w + x0 + x, [color[0] * a, color[1] * a, color[2] * a, a], blend);
            }
        }
    }

    pub fn fill_gradient(&mut self, path: &Path, g: &Gradient, opacity: f32, even_odd: bool, blend: Blend) {
        let Some((x0, y0, m)) = coverage(path, self.w, self.h, even_odd) else { return };
        for y in 0..m.h {
            for x in 0..m.w {
                let c = m.a[y * m.w + x];
                if c <= 0.0 {
                    continue;
                }
                let col = g.color_at(g.param((x0 + x) as f64 + 0.5, (y0 + y) as f64 + 0.5));
                let a = c * col[3] * opacity;
                self.blend_px((y0 + y) * self.w + x0 + x, [col[0] * a, col[1] * a, col[2] * a, a], blend);
            }
        }
    }

    #[inline]
    fn blend_px(&mut self, i: usize, s: [f32; 4], blend: Blend) {
        let Some(d) = self.px.get_mut(i) else { return };
        let inv = 1.0 - s[3];
        match blend {
            Blend::Normal => {
                for k in 0..4 {
                    d[k] = s[k] + d[k] * inv;
                }
            }
            Blend::Add => {
                for k in 0..3 {
                    d[k] = (d[k] + s[k]).min(1.0);
                }
                d[3] = s[3] + d[3] * inv;
            }
            Blend::Multiply => {
                // premultiplied multiply: s*d + s*(1-da) + d*(1-sa)
                let da = d[3];
                for k in 0..3 {
                    d[k] = s[k] * d[k] + s[k] * (1.0 - da) + d[k] * inv;
                }
                d[3] = s[3] + da * inv;
            }
            Blend::Screen => {
                for k in 0..3 {
                    d[k] = s[k] + d[k] - s[k] * d[k];
                }
                d[3] = s[3] + d[3] * inv;
            }
        }
    }

    /// Composite `src` (same size) over this canvas with `opacity`, optionally through a per-pixel
    /// alpha `mask`.
    pub fn over(&mut self, src: &Canvas, opacity: f32, mask: Option<&[f32]>, blend: Blend) {
        if src.w != self.w || src.h != self.h {
            return;
        }
        for i in 0..self.px.len() {
            let s = src.px[i];
            if s[3] <= 0.0 {
                continue;
            }
            let f = opacity * mask.and_then(|m| m.get(i)).copied().unwrap_or(1.0);
            if f <= 0.0 {
                continue;
            }
            self.blend_px(i, [s[0] * f, s[1] * f, s[2] * f, s[3] * f], blend);
        }
    }

    /// Multiply every pixel by `mask` (len w*h).
    pub fn multiply_alpha(&mut self, mask: &[f32]) {
        for (p, m) in self.px.iter_mut().zip(mask) {
            for k in p.iter_mut() {
                *k *= m;
            }
        }
    }

    pub fn alpha(&self) -> Vec<f32> {
        self.px.iter().map(|p| p[3]).collect()
    }

    /// Luma of the straight colour, times alpha (what a luma matte lets through).
    pub fn luma(&self) -> Vec<f32> {
        self.px.iter().map(|p| if p[3] > 0.0 { (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]).min(p[3]) } else { 0.0 }).collect()
    }

    pub fn is_blank(&self) -> bool {
        self.px.iter().all(|p| p[3] <= 0.0)
    }

    /// Straight-alpha sRGB RGBA8.
    pub fn to_rgba8(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(self.px.len() * 4);
        for p in &self.px {
            let a = p[3].clamp(0.0, 1.0);
            if a <= 0.0 {
                out.extend_from_slice(&[0, 0, 0, 0]);
                continue;
            }
            let q = |v: f32| ((v / a).clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
            out.extend_from_slice(&[q(p[0]), q(p[1]), q(p[2]), (a * 255.0 + 0.5) as u8]);
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fill_is_antialiased_and_premultiplied() {
        let mut c = Canvas::new(8, 8);
        c.fill_path(&Path::rect(1.5, 1.0, 6.0, 6.0), [1.0, 0.0, 0.0, 0.5], false, Blend::Normal);
        let edge = c.px[2 * 8 + 1];
        assert!((edge[3] - 0.25).abs() < 1e-5, "{edge:?}");
        assert!((edge[0] - 0.25).abs() < 1e-5);
        let inside = c.px[3 * 8 + 3];
        assert!((inside[3] - 0.5).abs() < 1e-5);
        let rgba = c.to_rgba8();
        assert_eq!(&rgba[(3 * 8 + 3) * 4..(3 * 8 + 3) * 4 + 4], &[255, 0, 0, 128]);
        assert_eq!(&rgba[0..4], &[0, 0, 0, 0]);
    }

    #[test]
    fn even_odd_leaves_a_hole_where_non_zero_does_not() {
        let mut p = Path::rect(0.0, 0.0, 10.0, 10.0);
        p.extend(&Path::rect(3.0, 3.0, 7.0, 7.0));
        let (_, _, nz) = coverage(&p, 10, 10, false).unwrap();
        let (_, _, eo) = coverage(&p, 10, 10, true).unwrap();
        assert!((nz.get(5, 5) - 1.0).abs() < 1e-5);
        assert_eq!(eo.get(5, 5), 0.0);
        assert!((eo.get(1, 1) - 1.0).abs() < 1e-5);
    }

    #[test]
    fn gradient_interpolates_between_stops() {
        let g = Gradient { radial: false, start: [0.0, 0.0], end: [10.0, 0.0], stops: vec![(0.0, [1.0, 0.0, 0.0, 1.0]), (1.0, [0.0, 0.0, 1.0, 1.0])] };
        let mid = g.color_at(g.param(5.0, 3.0));
        assert!((mid[0] - 0.5).abs() < 1e-6 && (mid[2] - 0.5).abs() < 1e-6);
        assert_eq!(g.color_at(g.param(-4.0, 0.0)), [1.0, 0.0, 0.0, 1.0]);
        let r = Gradient { radial: true, ..g };
        assert!((r.param(0.0, 5.0) - 0.5).abs() < 1e-9);
    }

    #[test]
    fn over_respects_opacity_and_mask() {
        let mut dst = Canvas::new(2, 1);
        let mut src = Canvas::new(2, 1);
        src.px = vec![[0.0, 1.0, 0.0, 1.0]; 2];
        dst.over(&src, 0.5, Some(&[1.0, 0.0]), Blend::Normal);
        assert!((dst.px[0][3] - 0.5).abs() < 1e-6 && (dst.px[0][1] - 0.5).abs() < 1e-6);
        assert_eq!(dst.px[1], [0.0; 4]);
        assert_eq!(src.luma()[0], 0.7152);
    }
}
