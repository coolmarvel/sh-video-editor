//! The animation as a `filmcraft_media::MediaSource`: a looping, resolution-independent video
//! stream with alpha, and the media pool opener for `.json` / `.lottie` files.

use std::sync::Arc;

use filmcraft_color::ColorInfo;
use filmcraft_frame::{AudioBuffer, VideoFrame};
use filmcraft_media::{FrameCache, FrameRequest, MediaError, MediaInfo, MediaKind, MediaSource, Result, SharedSource, VideoStreamInfo};
use filmcraft_time::{FrameRate, Tick};

use crate::Animation;

/// How long a looping animation offers itself as media: a sticker can sit on the timeline for up
/// to this long (or one pass when that is longer). Clips take what they need (`graphics.newFromFile`
/// `duration`, `timeline.place` `duration`); the frames loop the document's own length.
pub const LOOP_SECONDS: f64 = 60.0;

/// Largest scale a frame is rasterised at (relative to the item size): a sticker enlarged by
/// Motion is drawn at the size it is shown, up to 4x (a 512 px sticker at 2048 px).
const MAX_SCALE: f32 = 4.0;

/// A Lottie document bound to a pixel size: frames are rasterised on demand (and cached by
/// frame number and scale bucket). The animation loops, so [`MediaInfo::duration`] reports
/// [`LOOP_SECONDS`] (or one pass when longer); [`Animation::duration_seconds`] is one pass.
pub struct LottieSource {
    anim: Arc<Animation>,
    info: MediaInfo,
    cache: FrameCache<(i64, u16)>,
}

impl LottieSource {
    /// At the document's own size.
    pub fn new(anim: Animation, name: &str) -> Self {
        let (w, h) = (anim.width, anim.height);
        Self::with_size(Arc::new(anim), name, w, h)
    }

    fn with_size(anim: Arc<Animation>, name: &str, width: u32, height: u32) -> Self {
        let rate = FrameRate::from_f64(anim.frame_rate).sane();
        let one_pass = rate.snap_nearest(Tick::from_seconds_f64(anim.duration_seconds())).max(rate.frame_duration());
        let duration = one_pass.max(rate.snap_nearest(Tick::from_seconds_f64(LOOP_SECONDS)));
        let info = MediaInfo {
            name: name.to_string(),
            kind: MediaKind::Movie,
            duration,
            video: Some(VideoStreamInfo {
                width: width.max(1),
                height: height.max(1),
                frame_rate: rate,
                par: (1, 1),
                codec: "Lottie (vector)".into(),
                pixel_format: "RGBA 8-bit".into(),
                color: ColorInfo::SRGB_FULL,
                has_alpha: true,
                bitrate: None,
                hdr: None,
            }),
            audio: None,
            container: "Lottie".into(),
            start_timecode: None,
            file_size: None,
        };
        Self { anim, info, cache: FrameCache::new(64 << 20) }
    }

    pub fn animation(&self) -> &Animation {
        &self.anim
    }

    /// The pixel size the document renders at, keeping the aspect, with its longer side `size`.
    pub fn fit_size(anim: &Animation, size: u32) -> (u32, u32) {
        let (w, h) = (anim.width.max(1) as f64, anim.height.max(1) as f64);
        let f = size.max(1) as f64 / w.max(h);
        (((w * f).round() as u32).max(1), ((h * f).round() as u32).max(1))
    }
}

impl MediaSource for LottieSource {
    fn info(&self) -> &MediaInfo {
        &self.info
    }

    fn video_frame(&self, req: FrameRequest) -> Result<Arc<VideoFrame>> {
        let v = self.info.video.as_ref().ok_or(MediaError::NoStream("video"))?;
        let rate = v.frame_rate;
        let frame = rate.frame_at(req.time.max(Tick::ZERO));
        let scale = req.scale.clamp(1.0 / 64.0, MAX_SCALE);
        let bucket = (scale * 64.0).round() as u16;
        let s = bucket as f32 / 64.0;
        let (w, h) = (((v.width as f32 * s).round() as u32).max(2), ((v.height as f32 * s).round() as u32).max(2));
        let t = rate.tick_of(frame).seconds();
        self.cache.get_or_insert_with((frame, bucket), || {
            let px = self.anim.render(self.anim.frame_at(t), w, h);
            Ok(Arc::new(VideoFrame::rgba8(w, h, px).with_pts(rate.tick_of(frame))))
        })
    }

    fn audio(&self, _start: i64, _frames: usize, _sample_rate: u32) -> Result<AudioBuffer> {
        Err(MediaError::NoStream("audio"))
    }

    fn warnings(&self) -> Vec<String> {
        self.anim.warnings.clone()
    }

    fn max_scale(&self) -> f32 {
        MAX_SCALE
    }

    fn at_size(&self, width: u32, height: u32) -> Option<SharedSource> {
        let v = self.info.video.as_ref()?;
        if v.width == width && v.height == height {
            return None;
        }
        Some(Arc::new(Self::with_size(self.anim.clone(), &self.info.name, width, height)))
    }
}

/// Media pool opener: `.json` / `.lottie` files (or any bytes that sniff as Lottie).
pub fn opener(name: &str, bytes: Arc<[u8]>) -> Option<Result<SharedSource>> {
    let lower = name.to_ascii_lowercase();
    let by_ext = lower.ends_with(".json") || lower.ends_with(".lottie");
    if !by_ext && !Animation::sniff(&bytes) {
        return None;
    }
    if by_ext && !Animation::sniff(&bytes) {
        return Some(Err(MediaError::Unsupported(format!("{name}: not a Lottie animation"))));
    }
    Some(Animation::parse(&bytes).map(|a| Arc::new(LottieSource::new(a, name)) as SharedSource).map_err(|e| MediaError::Unsupported(format!("{name}: {e}"))))
}
