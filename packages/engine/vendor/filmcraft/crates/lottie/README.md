> Ported into sh-video-editor on 2026-10-15 from effectcraft 0.4.0 `crates/lottie` (https://github.com/storytold/effectcraft, MIT OR Apache-2.0,
> Copyright (c) 2026 ArtCraft Team and the EffectCraft contributors). Only the import side came across (value readers, keyframe eases, shape
> item and layer field mapping, base64 and ZIP helpers); effectcraft turns Lottie into its project model, this crate samples the document
> directly and rasterises it with `filmcraft-text`. Crate renamed `effectcraft-lottie` to `filmcraft-lottie`. Origin and license: `packages/engine/VENDOR.md`.

# filmcraft-lottie

Lottie (bodymovin JSON, stored-entry dotLottie) animations as a looping, resolution-independent `filmcraft_media::MediaSource`
(layer L2, `serde_json` + filmcraft crates only, no `unsafe`, no `std::time`, builds for `wasm32-unknown-unknown`).

## What it renders

- Shape layers: groups, rectangles, ellipses, stars and polygons, Bezier paths, fills and strokes (caps, joins, dashes), linear and radial
  gradients, trim paths, repeaters, group and layer transforms with skew; fill rules non-zero and even-odd.
- Solid, null and precomposition layers: parenting, in / out points, time stretch, time remap, clipping to the precomp size.
- Keyframes with Bezier temporal easing (per dimension), hold keys, spatial tangents (motion paths at arc-length speed), legacy `e` end values.
- Masks (add, subtract, intersect, inverted, opacity) and track mattes (alpha, luma, inverted). Blend modes Normal, Multiply, Screen, Add.
- Not supported, listed in `Animation::warnings` and skipped: image, text, audio and camera layers, expressions, path modifiers (round
  corners, offset, pucker, twist, zig zag, merge), layer effects and styles, compressed dotLottie entries.

## How it is used

`opener` is registered in the engine's media pool, so `file.import` of a `.json` / `.lottie` file (or bytes that sniff as Lottie) yields a
`LottieSource`: video with alpha at the document size and frame rate, `LOOP_SECONDS` (60 s) of media with the document looping,
rasterised per frame and cached per scale bucket. `MediaSource::at_size` re-targets the document to the size a project item declares.
The editor's animated stickers (`packages/editor/src/features/stickers`) are hand-written documents in this format.

## Tests

`cargo test -p filmcraft-lottie`: easing math, keyframes, shape items and the style-above rule, trim and repeater, parenting and timing,
masks and mattes, precomps with time remap, dotLottie archives, the media source, adversarial input, and a full-HD timing print.
Engine-level golden renders of the editor's ten stickers: `packages/engine/tests/lottie.test.ts`.
