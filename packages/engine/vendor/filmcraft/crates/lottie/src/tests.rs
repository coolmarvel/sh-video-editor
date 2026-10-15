//! Renders small documents built with `json!` and checks pixels: easing math, shape items, the
//! style-above rule, trim and repeater, layer parenting and timing, masks, mattes, precomps with
//! time remap, dotLottie archives, the media source and odd input. The cases mirror the
//! effectcraft `lottie` round-trip tests where a feature exists on the import side.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::sync::Arc;

use filmcraft_media::{FrameRequest, MediaSource};
use filmcraft_time::Tick;
use serde_json::{Value as Json, json};

use crate::anim::{self, eased};
use crate::{Animation, LottieSource, opener};

fn doc(layers: Vec<Json>) -> Animation {
    doc_sized(64, 64, 30.0, 0.0, 60.0, layers, vec![])
}

fn doc_sized(w: u32, h: u32, fr: f64, ip: f64, op: f64, layers: Vec<Json>, assets: Vec<Json>) -> Animation {
    Animation::from_json(&json!({"v": "5.7.4", "fr": fr, "ip": ip, "op": op, "w": w, "h": h, "nm": "test", "assets": assets, "layers": layers})).unwrap()
}

fn shape_layer(shapes: Vec<Json>) -> Json {
    json!({"ty": 4, "nm": "shapes", "ip": 0, "op": 60, "st": 0, "sr": 1, "ks": {}, "shapes": shapes})
}

fn fill(rgb: [f64; 3]) -> Json {
    json!({"ty": "fl", "c": {"a": 0, "k": rgb}, "o": {"a": 0, "k": 100}})
}

fn ellipse(cx: f64, cy: f64, w: f64, h: f64) -> Json {
    json!({"ty": "el", "p": {"a": 0, "k": [cx, cy]}, "s": {"a": 0, "k": [w, h]}})
}

fn rect(cx: f64, cy: f64, w: f64, h: f64) -> Json {
    json!({"ty": "rc", "p": {"a": 0, "k": [cx, cy]}, "s": {"a": 0, "k": [w, h]}, "r": {"a": 0, "k": 0}})
}

fn px(img: &[u8], w: u32, x: u32, y: u32) -> [u8; 4] {
    let i = ((y * w + x) * 4) as usize;
    [img[i], img[i + 1], img[i + 2], img[i + 3]]
}

fn alpha_sum(img: &[u8]) -> u64 {
    img.chunks(4).map(|p| p[3] as u64).sum()
}

#[test]
fn easing_is_linear_for_linear_handles_and_eases_otherwise() {
    assert_eq!(eased(None, 0.3), 0.3);
    assert!((eased(Some(&[0.5, 0.5, 0.5, 0.5]), 0.3) - 0.3).abs() < 1e-9);
    let e = [0.42, 0.0, 0.58, 1.0];
    assert_eq!(eased(Some(&e), 0.0), 0.0);
    assert_eq!(eased(Some(&e), 1.0), 1.0);
    assert!(eased(Some(&e), 0.25) < 0.25, "ease in slows the start");
    assert!(eased(Some(&e), 0.75) > 0.75, "ease out speeds the end");
    assert!((eased(Some(&e), 0.5) - 0.5).abs() < 1e-6, "symmetric ease passes the middle");
    let mut prev = 0.0;
    for i in 1..=100 {
        let v = eased(Some(&e), i as f64 / 100.0);
        assert!(v >= prev, "monotonic");
        prev = v;
    }
}

#[test]
fn keyframes_interpolate_hold_and_read_legacy_end_values() {
    let p = anim::prop(Some(&json!({"a": 1, "k": [{"t": 0, "s": [0], "o": {"x": 0.5, "y": 0.5}, "i": {"x": 0.5, "y": 0.5}}, {"t": 10, "s": [100]}]})), &[0.0]);
    assert!(p.is_animated());
    assert!((p.f(5.0) - 50.0).abs() < 1e-6);
    assert_eq!(p.f(-3.0), 0.0);
    assert_eq!(p.f(30.0), 100.0);
    let h = anim::prop(Some(&json!({"a": 1, "k": [{"t": 0, "s": [0], "h": 1}, {"t": 10, "s": [100]}]})), &[0.0]);
    assert_eq!(h.f(9.9), 0.0);
    assert_eq!(h.f(10.0), 100.0);
    // legacy: `e` on the only key
    let legacy =
        anim::prop(Some(&json!({"a": 1, "k": [{"t": 0, "s": [0], "e": [50], "o": {"x": 0.5, "y": 0.5}, "i": {"x": 0.5, "y": 0.5}}, {"t": 10}]})), &[0.0]);
    assert!((legacy.f(5.0) - 25.0).abs() < 1e-6, "{}", legacy.f(5.0));
    // per-dimension eases
    let v = anim::prop(
        Some(
            &json!({"a": 1, "k": [{"t": 0, "s": [0, 0], "o": {"x": [0.5, 0.42], "y": [0.5, 0.0]}, "i": {"x": [0.5, 1.0], "y": [0.5, 1.0]}}, {"t": 10, "s": [10, 10]}]}),
        ),
        &[0.0, 0.0],
    );
    let at = v.at(5.0);
    assert!((at[0] - 5.0).abs() < 1e-6, "linear first dimension");
    assert!(at[1] < 4.0, "the second dimension eases in and is behind at the middle: {at:?}");
    assert!(v.at(2.5)[1] < v.at(2.5)[0] - 0.5, "the second dimension eases in: {:?}", v.at(2.5));
    assert!((v.at(10.0)[1] - 10.0).abs() < 1e-9);
}

#[test]
fn spatial_tangents_bend_the_motion_path() {
    let straight = anim::prop(
        Some(&json!({"a": 1, "k": [{"t": 0, "s": [0, 0], "o": {"x": 0.5, "y": 0.5}, "i": {"x": 0.5, "y": 0.5}}, {"t": 10, "s": [100, 0]}]})),
        &[0.0, 0.0],
    );
    assert_eq!(straight.v2(5.0)[1], 0.0);
    let bent = anim::prop(
        Some(
            &json!({"a": 1, "k": [{"t": 0, "s": [0, 0], "o": {"x": 0.5, "y": 0.5}, "i": {"x": 0.5, "y": 0.5}, "to": [33, 50], "ti": [-33, 50]}, {"t": 10, "s": [100, 0]}]}),
        ),
        &[0.0, 0.0],
    );
    let mid = bent.v2(5.0);
    assert!(mid[1] > 30.0, "the path curves through y > 0: {mid:?}");
    assert!((mid[0] - 50.0).abs() < 1.0, "{mid:?}");
    assert_eq!(bent.v2(0.0), [0.0, 0.0]);
    assert_eq!(bent.v2(10.0), [100.0, 0.0]);
}

#[test]
fn ellipse_fill_renders_with_antialiased_alpha() {
    let a = doc(vec![shape_layer(vec![json!({"ty": "gr", "it": [ellipse(32.0, 32.0, 40.0, 40.0), fill([1.0, 0.0, 0.0]), {"ty": "tr"}]})])]);
    assert!(a.warnings.is_empty(), "{:?}", a.warnings);
    let img = a.render(0.0, 64, 64);
    assert_eq!(px(&img, 64, 32, 32), [255, 0, 0, 255]);
    assert_eq!(px(&img, 64, 1, 1), [0, 0, 0, 0]);
    // the pixel the 45 degree edge crosses (32 + 20 cos 45 = 46.1, 32 - 20 sin 45 = 17.9) is partly covered
    let edge = px(&img, 64, 46, 17);
    assert!(edge[3] > 0 && edge[3] < 255, "antialiased edge: {edge:?}");
    assert_eq!(px(&img, 64, 32, 11)[3], 0, "above the top of the circle");
    let area = alpha_sum(&img) as f64 / 255.0;
    let want = std::f64::consts::PI * 20.0 * 20.0;
    assert!((area - want).abs() / want < 0.02, "{area} vs {want}");
    // the same document at half size covers a quarter of the pixels
    let half = a.render(0.0, 32, 32);
    assert!(((alpha_sum(&half) as f64 / 255.0) - want / 4.0).abs() / (want / 4.0) < 0.03);
}

#[test]
fn styles_apply_to_the_paths_above_them_and_lower_items_paint_first() {
    // rect A, red fill (A only), rect B, blue fill (A and B): A is red on top of blue, B is blue
    let a = doc(vec![shape_layer(vec![json!({"ty": "gr", "it": [
        rect(16.0, 32.0, 24.0, 24.0), fill([1.0, 0.0, 0.0]),
        rect(48.0, 32.0, 24.0, 24.0), fill([0.0, 0.0, 1.0]),
        {"ty": "tr"}]})])]);
    let img = a.render(0.0, 64, 64);
    assert_eq!(px(&img, 64, 16, 32), [255, 0, 0, 255]);
    assert_eq!(px(&img, 64, 48, 32), [0, 0, 255, 255]);
    // a fill outside a nested group paints the group's paths too
    let b = doc(vec![shape_layer(vec![json!({"ty": "gr", "it": [
        {"ty": "gr", "it": [rect(16.0, 32.0, 24.0, 24.0), {"ty": "tr"}]},
        fill([0.0, 1.0, 0.0]),
        {"ty": "tr"}]})])]);
    assert_eq!(px(&b.render(0.0, 64, 64), 64, 16, 32), [0, 255, 0, 255]);
    // a fill above a path does not paint it
    let c = doc(vec![shape_layer(vec![json!({"ty": "gr", "it": [fill([0.0, 1.0, 0.0]), rect(16.0, 32.0, 24.0, 24.0), {"ty": "tr"}]})])]);
    assert_eq!(alpha_sum(&c.render(0.0, 64, 64)), 0);
}

#[test]
fn group_transform_opacity_and_layer_opacity_compose() {
    let a = doc(vec![shape_layer(vec![json!({"ty": "gr", "it": [
        rect(0.0, 0.0, 20.0, 20.0), fill([1.0, 1.0, 1.0]),
        {"ty": "tr", "p": {"a": 0, "k": [32, 32]}, "s": {"a": 0, "k": [200, 100]}, "r": {"a": 0, "k": 0}, "o": {"a": 0, "k": 50}, "a": {"a": 0, "k": [0, 0]}}]})])]);
    let img = a.render(0.0, 64, 64);
    assert_eq!(px(&img, 64, 32, 32), [255, 255, 255, 128]);
    assert_eq!(px(&img, 64, 32 + 18, 32)[3], 128, "scaled 2x in x");
    assert_eq!(px(&img, 64, 32, 32 + 18)[3], 0, "not in y");
    let mut j = json!({"ty": 4, "ip": 0, "op": 60, "st": 0, "ks": {"o": {"a": 0, "k": 50}}, "shapes": [{"ty": "gr", "it": [rect(32.0, 32.0, 20.0, 20.0), fill([1.0, 1.0, 1.0]), {"ty": "tr"}]}]});
    j["ks"]["r"] = json!({"a": 0, "k": 45});
    j["ks"]["a"] = json!({"a": 0, "k": [32, 32]});
    j["ks"]["p"] = json!({"a": 0, "k": [32, 32]});
    let b = doc(vec![j]);
    let img = b.render(0.0, 64, 64);
    assert_eq!(px(&img, 64, 32, 32)[3], 128, "layer opacity");
    assert_eq!(px(&img, 64, 32, 32 - 13)[3], 255 / 2 + 1, "rotated 45 degrees: the corner points up");
    assert_eq!(px(&img, 64, 32 + 9, 32 + 9)[3], 0, "the original corner is empty");
}

#[test]
fn strokes_trim_paths_and_dashes() {
    let line = json!({"ty": "sh", "ks": {"a": 0, "k": {"c": false, "v": [[4, 32], [60, 32]], "i": [[0, 0], [0, 0]], "o": [[0, 0], [0, 0]]}}});
    let stroke = json!({"ty": "st", "c": {"a": 0, "k": [0, 0, 0]}, "o": {"a": 0, "k": 100}, "w": {"a": 0, "k": 4}, "lc": 1, "lj": 1});
    let a = doc(vec![shape_layer(vec![json!({"ty": "gr", "it": [line, stroke, {"ty": "tr"}]})])]);
    let img = a.render(0.0, 64, 64);
    assert_eq!(px(&img, 64, 32, 32), [0, 0, 0, 255]);
    assert_eq!(px(&img, 64, 32, 29)[3], 0);
    assert!((alpha_sum(&img) as f64 / 255.0 - 56.0 * 4.0).abs() < 2.0);
    // trim 0..50% keeps the left half; animated end draws a growing line
    let trim = json!({"ty": "tm", "s": {"a": 0, "k": 0}, "e": {"a": 1, "k": [{"t": 0, "s": [0]}, {"t": 60, "s": [100]}]}, "o": {"a": 0, "k": 0}, "m": 1});
    let line2 = json!({"ty": "sh", "ks": {"a": 0, "k": {"c": false, "v": [[4, 32], [60, 32]], "i": [[0, 0], [0, 0]], "o": [[0, 0], [0, 0]]}}});
    let stroke2 = json!({"ty": "st", "c": {"a": 0, "k": [0, 0, 0]}, "o": {"a": 0, "k": 100}, "w": {"a": 0, "k": 4}, "lc": 1, "lj": 1});
    let b = doc(vec![shape_layer(vec![json!({"ty": "gr", "it": [line2, trim, stroke2, {"ty": "tr"}]})])]);
    assert_eq!(alpha_sum(&b.render(0.0, 64, 64)), 0);
    let half = b.render(30.0, 64, 64);
    assert_eq!(px(&half, 64, 16, 32)[3], 255);
    assert_eq!(px(&half, 64, 48, 32)[3], 0);
    // dashes 8 on 8 off
    let line3 = json!({"ty": "sh", "ks": {"a": 0, "k": {"c": false, "v": [[0, 32], [64, 32]], "i": [[0, 0], [0, 0]], "o": [[0, 0], [0, 0]]}}});
    let dashed = json!({"ty": "st", "c": {"a": 0, "k": [0, 0, 0]}, "o": {"a": 0, "k": 100}, "w": {"a": 0, "k": 2}, "lc": 1, "lj": 1,
        "d": [{"n": "d", "v": {"a": 0, "k": 8}}, {"n": "g", "v": {"a": 0, "k": 8}}, {"n": "o", "v": {"a": 0, "k": 0}}]});
    let c = doc(vec![shape_layer(vec![json!({"ty": "gr", "it": [line3, dashed, {"ty": "tr"}]})])]);
    let img = c.render(0.0, 64, 64);
    assert_eq!(px(&img, 64, 4, 32)[3], 255);
    assert_eq!(px(&img, 64, 12, 32)[3], 0);
    assert_eq!(px(&img, 64, 20, 32)[3], 255);
}

#[test]
fn trim_paths_after_the_stroke_trims_it_too() {
    // bodymovin writes `tm` after `st`; After Effects trims the stroke all the same
    let tm = json!({"ty": "tm", "s": {"a": 0, "k": 0}, "e": {"a": 0, "k": 50}, "o": {"a": 0, "k": 0}, "m": 1});
    let st = json!({"ty": "st", "c": {"a": 0, "k": [1, 1, 1]}, "o": {"a": 0, "k": 100}, "w": {"a": 0, "k": 4}, "lc": 1});
    let line = json!({"ty": "sh", "ks": {"a": 0, "k": {"c": false, "v": [[4, 32], [60, 32]], "i": [[0, 0], [0, 0]], "o": [[0, 0], [0, 0]]}}});
    let before = doc(vec![shape_layer(vec![json!({"ty": "gr", "it": [line, tm, st, {"ty": "tr"}]})])]).render(0.0, 64, 64);
    let after = doc(vec![shape_layer(vec![json!({"ty": "gr", "it": [line, st, tm, {"ty": "tr"}]})])]).render(0.0, 64, 64);
    assert_eq!(before, after);
    assert_eq!(px(&after, 64, 20, 32)[3], 255, "first half drawn");
    assert_eq!(px(&after, 64, 50, 32)[3], 0, "second half trimmed");
    // a nested group's stroke is trimmed by a Trim Paths below the group
    let nested = doc(vec![shape_layer(vec![json!({"ty": "gr", "it": [{"ty": "gr", "it": [line, st, {"ty": "tr"}]}, tm, {"ty": "tr"}]})])]).render(0.0, 64, 64);
    assert_eq!(px(&nested, 64, 50, 32)[3], 0, "nested stroke trimmed");
    assert_eq!(px(&nested, 64, 20, 32)[3], 255);
}

#[test]
fn repeater_copies_shapes_with_an_offset_transform() {
    let rep = json!({"ty": "rp", "c": {"a": 0, "k": 3}, "o": {"a": 0, "k": 0}, "tr": {"p": {"a": 0, "k": [20, 0]}, "s": {"a": 0, "k": [100, 100]}, "r": {"a": 0, "k": 0}, "so": {"a": 0, "k": 100}, "eo": {"a": 0, "k": 50}}});
    let a = doc(vec![shape_layer(vec![json!({"ty": "gr", "it": [rect(12.0, 32.0, 8.0, 8.0), fill([1.0, 1.0, 1.0]), rep, {"ty": "tr"}]})])]);
    let img = a.render(0.0, 64, 64);
    assert_eq!(px(&img, 64, 12, 32)[3], 255);
    assert_eq!(px(&img, 64, 32, 32)[3], 191, "second copy at 75 percent");
    assert_eq!(px(&img, 64, 52, 32)[3], 128, "third copy at 50 percent");
    assert_eq!(px(&img, 64, 22, 32)[3], 0);
}

#[test]
fn star_polygon_gradient_and_even_odd() {
    let star = json!({"ty": "sr", "sy": 1, "p": {"a": 0, "k": [32, 32]}, "pt": {"a": 0, "k": 5}, "or": {"a": 0, "k": 30}, "ir": {"a": 0, "k": 12}, "os": {"a": 0, "k": 0}, "is": {"a": 0, "k": 0}, "r": {"a": 0, "k": 0}});
    let a = doc(vec![shape_layer(vec![json!({"ty": "gr", "it": [star, fill([1.0, 1.0, 0.0]), {"ty": "tr"}]})])]);
    let img = a.render(0.0, 64, 64);
    assert_eq!(px(&img, 64, 32, 32), [255, 255, 0, 255]);
    // the tip is at y = 2; two rows down the point is 1.7 px wide, four rows down it covers the pixel
    assert!(px(&img, 64, 32, 4)[3] > 100, "top point");
    assert_eq!(px(&img, 64, 32, 7)[3], 255, "top point");
    assert_eq!(px(&img, 64, 32, 1)[3], 0, "above the tip");
    assert_eq!(px(&img, 64, 32, 58)[3], 0, "no bottom point on a 5-point star");
    // linear gradient left red to right blue
    let gf = json!({"ty": "gf", "t": 1, "s": {"a": 0, "k": [0, 32]}, "e": {"a": 0, "k": [64, 32]}, "o": {"a": 0, "k": 100}, "g": {"p": 2, "k": {"a": 0, "k": [0, 1, 0, 0, 1, 0, 0, 1]}}});
    let b = doc(vec![shape_layer(vec![json!({"ty": "gr", "it": [rect(32.0, 32.0, 64.0, 64.0), gf, {"ty": "tr"}]})])]);
    let img = b.render(0.0, 64, 64);
    let l = px(&img, 64, 2, 32);
    let r = px(&img, 64, 61, 32);
    let m = px(&img, 64, 32, 32);
    assert!(l[0] > 230 && l[2] < 25, "{l:?}");
    assert!(r[2] > 230 && r[0] < 25, "{r:?}");
    assert!((m[0] as i32 - 128).abs() < 8 && (m[2] as i32 - 128).abs() < 8, "{m:?}");
    // even-odd fill of two nested rectangles leaves a hole; non-zero does not
    let eo = json!({"ty": "fl", "c": {"a": 0, "k": [1, 1, 1]}, "o": {"a": 0, "k": 100}, "r": 2});
    let c = doc(vec![shape_layer(vec![json!({"ty": "gr", "it": [rect(32.0, 32.0, 48.0, 48.0), rect(32.0, 32.0, 16.0, 16.0), eo, {"ty": "tr"}]})])]);
    let img = c.render(0.0, 64, 64);
    assert_eq!(px(&img, 64, 32, 32)[3], 0);
    assert_eq!(px(&img, 64, 12, 32)[3], 255);
    let d = doc(vec![shape_layer(vec![
        json!({"ty": "gr", "it": [rect(32.0, 32.0, 48.0, 48.0), rect(32.0, 32.0, 16.0, 16.0), fill([1.0, 1.0, 1.0]), {"ty": "tr"}]}),
    ])]);
    assert_eq!(px(&d.render(0.0, 64, 64), 64, 32, 32)[3], 255);
    // a reversed inner rectangle makes the hole under non-zero winding too
    let inner = json!({"ty": "rc", "d": 3, "p": {"a": 0, "k": [32, 32]}, "s": {"a": 0, "k": [16, 16]}, "r": {"a": 0, "k": 0}});
    let e = doc(vec![shape_layer(vec![json!({"ty": "gr", "it": [rect(32.0, 32.0, 48.0, 48.0), inner, fill([1.0, 1.0, 1.0]), {"ty": "tr"}]})])]);
    assert_eq!(px(&e.render(0.0, 64, 64), 64, 32, 32)[3], 0);
}

#[test]
fn layers_parent_time_and_stack() {
    let null = json!({"ty": 3, "ind": 1, "nm": "null", "ip": 0, "op": 60, "st": 0, "ks": {"p": {"a": 1, "k": [{"t": 0, "s": [0, 0], "o": {"x": 0.5, "y": 0.5}, "i": {"x": 0.5, "y": 0.5}}, {"t": 60, "s": [60, 0]}]}}});
    let child = json!({"ty": 4, "ind": 2, "parent": 1, "ip": 10, "op": 40, "st": 10, "ks": {"p": {"a": 1, "k": [{"t": 0, "s": [2, 32]}, {"t": 30, "s": [2, 32]}]}},
        "shapes": [{"ty": "gr", "it": [rect(0.0, 0.0, 4.0, 4.0), fill([1.0, 1.0, 1.0]), {"ty": "tr"}]}]});
    let a = doc(vec![child, null]);
    assert_eq!(alpha_sum(&a.render(5.0, 64, 64)), 0, "before the in point");
    assert_eq!(alpha_sum(&a.render(40.0, 64, 64)), 0, "at the out point");
    let img = a.render(30.0, 64, 64);
    assert_eq!(px(&img, 64, 32, 32)[3], 255, "parent moved the square by 30 px at frame 30");
    assert_eq!(px(&img, 64, 2, 32)[3], 0);
    // z order: the first layer paints on top
    let top = json!({"ty": 4, "ip": 0, "op": 60, "st": 0, "ks": {}, "shapes": [{"ty": "gr", "it": [rect(32.0, 32.0, 20.0, 20.0), fill([1.0, 0.0, 0.0]), {"ty": "tr"}]}]});
    let bottom = json!({"ty": 1, "ip": 0, "op": 60, "st": 0, "ks": {}, "sc": "#0000ff", "sw": 64, "sh": 64});
    let b = doc(vec![top, bottom]);
    let img = b.render(0.0, 64, 64);
    assert_eq!(px(&img, 64, 32, 32), [255, 0, 0, 255]);
    assert_eq!(px(&img, 64, 4, 4), [0, 0, 255, 255]);
    // stretch: sr 2 plays the child's keyframes at half speed
    let slow = json!({"ty": 4, "ip": 0, "op": 60, "st": 0, "sr": 2, "ks": {"p": {"a": 1, "k": [{"t": 0, "s": [2, 32]}, {"t": 30, "s": [62, 32]}]}},
        "shapes": [{"ty": "gr", "it": [rect(0.0, 0.0, 4.0, 4.0), fill([1.0, 1.0, 1.0]), {"ty": "tr"}]}]});
    let c = doc(vec![slow]);
    assert_eq!(px(&c.render(30.0, 64, 64), 64, 32, 32)[3], 255);
}

#[test]
fn masks_and_track_mattes_cut_layers() {
    let square = |mode: &str, inv: bool| {
        json!({"ty": 1, "ip": 0, "op": 60, "st": 0, "ks": {}, "sc": "#ffffff", "sw": 64, "sh": 64,
            "masksProperties": [{"mode": mode, "inv": inv, "o": {"a": 0, "k": 100},
                "pt": {"a": 0, "k": {"c": true, "v": [[16, 16], [48, 16], [48, 48], [16, 48]], "i": [[0, 0], [0, 0], [0, 0], [0, 0]], "o": [[0, 0], [0, 0], [0, 0], [0, 0]]}}}]})
    };
    let add = doc(vec![square("a", false)]).render(0.0, 64, 64);
    assert_eq!(px(&add, 64, 32, 32)[3], 255);
    assert_eq!(px(&add, 64, 4, 4)[3], 0);
    let sub = doc(vec![square("s", false)]).render(0.0, 64, 64);
    assert_eq!(px(&sub, 64, 32, 32)[3], 0);
    assert_eq!(px(&sub, 64, 4, 4)[3], 255);
    let inv = doc(vec![square("a", true)]).render(0.0, 64, 64);
    assert_eq!(px(&inv, 64, 32, 32)[3], 0);
    assert_eq!(px(&inv, 64, 4, 4)[3], 255);
    // alpha matte: the layer above (td) shapes the layer below (tt)
    let matte = json!({"ty": 4, "td": 1, "ip": 0, "op": 60, "st": 0, "ks": {}, "shapes": [{"ty": "gr", "it": [ellipse(32.0, 32.0, 32.0, 32.0), fill([0.0, 0.0, 0.0]), {"ty": "tr"}]}]});
    let solid = json!({"ty": 1, "tt": 1, "ip": 0, "op": 60, "st": 0, "ks": {}, "sc": "#00ff00", "sw": 64, "sh": 64});
    let a = doc(vec![matte.clone(), solid.clone()]);
    let img = a.render(0.0, 64, 64);
    assert_eq!(px(&img, 64, 32, 32), [0, 255, 0, 255]);
    assert_eq!(px(&img, 64, 4, 4)[3], 0, "outside the matte");
    let total = alpha_sum(&img) as f64 / 255.0;
    assert!((total - std::f64::consts::PI * 256.0).abs() / (std::f64::consts::PI * 256.0) < 0.03, "{total}");
    let mut solid_inv = solid.clone();
    solid_inv["tt"] = json!(2);
    let b = doc(vec![matte.clone(), solid_inv]).render(0.0, 64, 64);
    assert_eq!(px(&b, 64, 32, 32)[3], 0);
    assert_eq!(px(&b, 64, 4, 4)[3], 255);
    // luma matte: a black matte lets nothing through, a white one everything
    let mut solid_luma = solid;
    solid_luma["tt"] = json!(3);
    let c = doc(vec![matte, solid_luma.clone()]).render(0.0, 64, 64);
    assert_eq!(alpha_sum(&c), 0);
    let white = json!({"ty": 4, "td": 1, "ip": 0, "op": 60, "st": 0, "ks": {}, "shapes": [{"ty": "gr", "it": [ellipse(32.0, 32.0, 32.0, 32.0), fill([1.0, 1.0, 1.0]), {"ty": "tr"}]}]});
    let d = doc(vec![white, solid_luma]).render(0.0, 64, 64);
    assert_eq!(px(&d, 64, 32, 32)[3], 255);
}

#[test]
fn precomp_with_time_remap_and_clipping() {
    let inner = json!({"ty": 4, "ip": 0, "op": 60, "st": 0, "ks": {"p": {"a": 1, "k": [{"t": 0, "s": [0, 16]}, {"t": 60, "s": [60, 16]}]}},
        "shapes": [{"ty": "gr", "it": [rect(0.0, 0.0, 4.0, 4.0), fill([1.0, 1.0, 1.0]), {"ty": "tr"}]}]});
    let assets = vec![json!({"id": "comp_0", "layers": [inner]})];
    let pre = |tm: Option<Json>, w: u32| {
        let mut l = json!({"ty": 0, "refId": "comp_0", "w": w, "h": 32, "ip": 0, "op": 60, "st": 0, "ks": {"p": {"a": 0, "k": [0, 16]}}});
        if let Some(tm) = tm {
            l["tm"] = tm;
        }
        l
    };
    let a = doc_sized(64, 64, 30.0, 0.0, 60.0, vec![pre(None, 64)], assets.clone());
    assert!(a.warnings.is_empty(), "{:?}", a.warnings);
    assert_eq!(px(&a.render(30.0, 64, 64), 64, 30, 32)[3], 255, "frame 30 of the precomp");
    // time remap fixes the precomp at second 0.5 = frame 15
    let b = doc_sized(64, 64, 30.0, 0.0, 60.0, vec![pre(Some(json!({"a": 0, "k": 0.5})), 64)], assets.clone());
    let img = b.render(50.0, 64, 64);
    assert_eq!(px(&img, 64, 15, 32)[3], 255);
    assert_eq!(px(&img, 64, 50, 32)[3], 0);
    // content outside the precomp size is clipped
    let c = doc_sized(64, 64, 30.0, 0.0, 60.0, vec![pre(None, 20)], assets);
    assert_eq!(alpha_sum(&c.render(50.0, 64, 64)), 0);
    assert_eq!(px(&c.render(10.0, 64, 64), 64, 10, 32)[3], 255);
}

#[test]
fn dotlottie_archive_opens_and_loops_in_the_media_source() {
    let json = json!({"v": "5.7.4", "fr": 24, "ip": 0, "op": 24, "w": 100, "h": 50, "nm": "loop", "layers": [
        {"ty": 4, "ip": 0, "op": 24, "st": 0, "ks": {"p": {"a": 1, "k": [{"t": 0, "s": [0, 25]}, {"t": 24, "s": [100, 25]}]}},
         "shapes": [{"ty": "gr", "it": [rect(0.0, 0.0, 10.0, 10.0), fill([1.0, 1.0, 1.0]), {"ty": "tr"}]}]}]});
    let bytes = serde_json::to_vec(&json).unwrap();
    let archive = crate::zip::store(&[("manifest.json".into(), b"{}".to_vec()), ("animations/loop.json".into(), bytes.clone())]);
    assert!(Animation::sniff(&archive));
    let a = Animation::parse(&archive).unwrap();
    assert_eq!((a.width, a.height, a.frame_rate), (100, 50, 24.0));
    assert!((a.duration_seconds() - 1.0).abs() < 1e-9);
    let src = LottieSource::new(a, "loop.lottie");
    let info = src.info();
    assert_eq!(info.duration, Tick::from_seconds_f64(crate::LOOP_SECONDS), "a looping sticker offers LOOP_SECONDS of media");
    assert!((src.animation().duration_seconds() - 1.0).abs() < 1e-9, "one pass is the document's length");
    let v = info.video.as_ref().unwrap();
    assert!(v.has_alpha);
    assert_eq!((v.width, v.height), (100, 50));
    assert_eq!(v.frame_rate.as_f64(), 24.0);
    let f0 = src.video_frame(FrameRequest::full(Tick::ZERO)).unwrap();
    let f12 = src.video_frame(FrameRequest::full(Tick::from_seconds_f64(0.5))).unwrap();
    let f36 = src.video_frame(FrameRequest::full(Tick::from_seconds_f64(1.5))).unwrap();
    assert_eq!((f0.width, f0.height), (100, 50));
    let rgba = |f: &filmcraft_frame::VideoFrame| match &f.data {
        filmcraft_frame::PixelData::Rgba8(d) => d.to_vec(),
        _ => panic!("rgba8"),
    };
    assert_eq!(px(&rgba(&f0), 100, 2, 25)[3], 255);
    assert_eq!(px(&rgba(&f12), 100, 50, 25)[3], 255);
    assert_eq!(rgba(&f12), rgba(&f36), "the second second loops the first");
    assert!(src.audio(0, 10, 48_000).is_err());
    let half = src.video_frame(FrameRequest { time: Tick::ZERO, scale: 0.5 }).unwrap();
    assert_eq!((half.width, half.height), (50, 25));
    let big = src.at_size(400, 200).unwrap();
    assert_eq!(big.info().video.as_ref().unwrap().width, 400);
    assert_eq!(big.video_frame(FrameRequest::full(Tick::ZERO)).unwrap().width, 400);
    assert!(src.at_size(100, 50).is_none());
    assert_eq!(LottieSource::fit_size(src.animation(), 400), (400, 200));
    // the opener takes the archive and the json, refuses other json
    assert!(opener("a.lottie", Arc::from(archive.as_slice())).unwrap().is_ok());
    assert!(opener("a.json", Arc::from(bytes.as_slice())).unwrap().is_ok());
    assert!(opener("a.json", Arc::from(&b"{\"hello\": 1}"[..])).unwrap().is_err());
    assert!(opener("a.mp4", Arc::from(&b"\0\0\0\x18ftyp"[..])).is_none());
    assert!(Animation::parse(&crate::zip::store(&[("manifest.json".into(), b"{}".to_vec())])).is_err());
}

#[test]
fn odd_input_does_not_panic_and_is_reported() {
    for bad in [
        json!({}),
        json!({"layers": [], "fr": 0, "w": 10, "h": 10}),
        json!({"layers": [], "fr": 30, "w": 0, "h": 10}),
        json!({"layers": [], "fr": 30, "w": 10, "h": 10, "ip": 5, "op": 5}),
    ] {
        assert!(Animation::from_json(&bad).is_err(), "{bad}");
    }
    assert!(Animation::parse(b"not json").is_err());
    assert!(!Animation::sniff(b"[1, 2]"));
    let weird = doc(vec![
        json!({"ty": 4, "ip": 0, "op": 60, "st": 0, "ks": {"r": {"a": 0, "k": 1e300}, "s": {"a": 0, "k": [1e9, -1e9]}},
            "shapes": [{"ty": "gr", "it": [
                {"ty": "sr", "sy": 99999999999u64, "pt": {"a": 0, "k": 1e12}, "or": {"a": 0, "k": f64::NAN}},
                {"ty": "sh", "ks": {"a": 0, "k": {"c": true, "v": [[0, 0]], "i": [], "o": []}}},
                {"ty": "rd"}, {"ty": "zz"}, {"ty": "mm"},
                {"ty": "fl", "c": {"a": 0, "k": [300, 300, 300]}, "o": {"a": 0, "k": 1e9}, "r": 7777777777u64},
                {"ty": "st", "c": {"a": 0, "k": [0, 0, 0]}, "w": {"a": 0, "k": -5}, "lc": -3, "lj": 4000000000u64, "ml": 1e300},
                {"ty": "tm", "s": {"a": 0, "k": 150}, "e": {"a": 0, "k": -40}},
                {"ty": "rp", "c": {"a": 0, "k": 2}, "tr": {"s": {"a": 0, "k": [1e6, 1e6]}}},
                {"ty": "tr"}]}]}),
        json!({"ty": 2, "refId": "image_0", "ip": 0, "op": 60, "st": 0, "ks": {}}),
        json!({"ty": 5, "ip": 0, "op": 60, "st": 0, "ks": {}, "t": {}}),
        json!({"ty": 4, "ind": 7, "parent": 7, "ip": 0, "op": 60, "st": 0, "ks": {}, "shapes": []}),
        json!({"ty": 0, "refId": "missing", "w": 10, "h": 10, "ip": 0, "op": 60, "st": 0, "ks": {}}),
    ]);
    let _ = weird.render(10.0, 32, 32);
    let _ = weird.render(-1e9, 2, 2);
    let w = weird.warnings.join("\n");
    assert!(w.contains("Round Corners") && w.contains("Zig Zag") && w.contains("Merge Paths"), "{w}");
    assert!(w.contains("image layers") && w.contains("text layers"), "{w}");
    assert_eq!(weird.layer_count(), 3, "unsupported layers are dropped");
    let _ = weird.render(f64::NAN, 8, 8);
}

/// Not an assertion: prints how long a full-HD frame of a typical sticker takes (debug and release
/// differ a lot; the engine caches frames per scale bucket).
#[test]
fn full_hd_frame_timing() {
    let mut items = vec![];
    for k in 0..12 {
        let (x, y) = (200.0 + (k % 4) as f64 * 400.0, 300.0 + (k / 4) as f64 * 250.0);
        items.push(json!({"ty": "gr", "it": [ellipse(x, y, 180.0, 180.0), fill([0.9, 0.2, 0.3]),
            {"ty": "st", "c": {"a": 0, "k": [1, 1, 1]}, "o": {"a": 0, "k": 100}, "w": {"a": 0, "k": 12}, "lc": 2, "lj": 2}, {"ty": "tr"}]}));
    }
    let a = doc_sized(1920, 1080, 30.0, 0.0, 60.0, vec![shape_layer(items)], vec![]);
    let t = std::time::Instant::now();
    let img = a.render(0.0, 1920, 1080);
    let ms = t.elapsed().as_secs_f64() * 1000.0;
    assert_eq!(img.len(), 1920 * 1080 * 4);
    assert!(alpha_sum(&img) > 0);
    eprintln!("1080p Lottie frame (12 stroked discs): {ms:.1} ms");
}
