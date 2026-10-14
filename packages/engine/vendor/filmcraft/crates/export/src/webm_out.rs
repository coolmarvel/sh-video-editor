//! WebM output of the stepped exporter: VP9 video and Opus audio in a Matroska file written with
//! [`filmcraft_matroska::MkvWriter`] (EBML header with DocType `webm`, Info, Tracks, SimpleBlock
//! clusters cut at video key frames, Cues, SeekHead).
//!
//! The exporter hands over one [`crate::job::INTERLEAVE`] group at a time: the group's video
//! packets, then the audio up to its end. Blocks of a group are sorted by presentation time before
//! they are written (an audio packet that straddles the group boundary comes with the next group),
//! and a group is written when the next one arrives, so at most one group is held in memory.
//!
//! Timestamps: video frame `n` is at `n × 1e9 × den / num` ns, Opus packet `k` at `k × 20` ms;
//! the track's `CodecDelay` is the encoder pre-skip (the muxer adds it to the stored timestamps,
//! as players subtract it), `SeekPreRoll` is 80 ms (RFC 7845).

use filmcraft_matroska::{MkvWriter, MuxOptions, TrackKind, TrackSpec};
use filmcraft_time::FrameRate;

use crate::{AudioEncoder, EncodedPacket, ExportError, ExportSettings, Out, Result, VideoEncoder};

/// Opus packets are 20 ms (960 samples at 48 kHz).
const OPUS_PACKET_NS: i64 = 20_000_000;
const OPUS_RATE: i64 = 48_000;

fn mkv(e: filmcraft_matroska::Error) -> ExportError {
    ExportError::Io(e.to_string())
}

struct Block {
    pts_ns: i64,
    video: bool,
    key: bool,
    data: Vec<u8>,
}

pub(crate) struct WebmMux {
    w: MkvWriter<Out>,
    rate: FrameRate,
    /// Video frames handed in so far (the next frame's index).
    vframes: u64,
    /// Opus packets handed in so far.
    apackets: u64,
    /// Blocks of the current group, written when the next group starts or on finish.
    pending: Vec<Block>,
}

impl WebmMux {
    pub fn new(settings: &ExportSettings, w: u32, h: u32, rate: FrameRate, venc: &dyn VideoEncoder, aenc: Option<&dyn AudioEncoder>) -> Result<Self> {
        let (vid, vpriv) = venc.matroska_codec().ok_or_else(|| ExportError::Unsupported("the video encoder cannot be stored in WebM".into()))?;
        let mut v = TrackSpec::new(TrackKind::Video, vid);
        v.codec_private = vpriv;
        v.video_size = Some((w, h));
        v.default_duration_ns = Some(frame_ns(rate, 1).max(1) as u64);
        let mut tracks = vec![v];
        if let Some(a) = aenc {
            let (aid, apriv) = a.matroska_codec().ok_or_else(|| ExportError::Unsupported("the audio encoder cannot be stored in WebM".into()))?;
            let mut t = TrackSpec::new(TrackKind::Audio, aid);
            t.codec_private = apriv;
            t.audio = Some((OPUS_RATE as f64, u64::from(settings.audio.channels.clamp(1, 2)), None));
            t.default_duration_ns = Some(OPUS_PACKET_NS as u64);
            t.codec_delay_ns = (i64::from(a.priming()) * 1_000_000_000 / OPUS_RATE) as u64;
            t.seek_pre_roll_ns = 80_000_000;
            tracks.push(t);
        }
        let opts = MuxOptions {
            doc_type: "webm".into(),
            timestamp_scale: 1_000_000,
            cluster_duration_ns: 1_000_000_000,
            title: Some(settings.metadata.title.clone()).filter(|t| !t.trim().is_empty()),
            writing_app: "sh-video-editor".into(),
            ..Default::default()
        };
        let out = Out::create(settings)?;
        let w = MkvWriter::new(out, tracks, opts).map_err(mkv)?;
        Ok(WebmMux { w, rate, vframes: 0, apackets: 0, pending: Vec::new() })
    }

    /// Write the held group in presentation order.
    fn flush_group(&mut self) -> Result<()> {
        let mut blocks = std::mem::take(&mut self.pending);
        // video before audio at equal times, so a cluster cut at a key frame starts with it (stable:
        // packets of one track keep their order)
        blocks.sort_by_key(|b| (b.pts_ns, !b.video));
        for b in blocks {
            let track = if b.video { 0 } else { 1 };
            self.w.write_frame(track, b.pts_ns, b.key, &b.data, None).map_err(mkv)?;
        }
        Ok(())
    }

    /// The video packets of a group (one per frame, in order). Writes the previous group.
    pub fn write_video(&mut self, packets: Vec<EncodedPacket>) -> Result<()> {
        if !packets.is_empty() {
            self.flush_group()?;
        }
        for p in packets {
            let pts_ns = frame_ns(self.rate, self.vframes);
            self.vframes += 1;
            self.pending.push(Block { pts_ns, video: true, key: p.key, data: p.data });
        }
        Ok(())
    }

    /// Opus packets (20 ms each) up to the end of the current group.
    pub fn write_audio(&mut self, packets: Vec<Vec<u8>>) -> Result<()> {
        for data in packets {
            let pts_ns = self.apackets as i64 * OPUS_PACKET_NS;
            self.apackets += 1;
            self.pending.push(Block { pts_ns, video: false, key: true, data });
        }
        Ok(())
    }

    /// Write the last group, Cues and SeekHead; returns the file size.
    pub fn finish(mut self, settings: &ExportSettings) -> Result<u64> {
        self.flush_group()?;
        let out = self.w.finish().map_err(mkv)?;
        out.finish(settings)
    }
}

/// Presentation time of output frame `n` in nanoseconds (rounded, so the last frame's start plus the
/// DefaultDuration lands on the whole duration).
fn frame_ns(rate: FrameRate, n: u64) -> i64 {
    let num = rate.num.max(1) as i128;
    ((n as i128 * 1_000_000_000 * rate.den as i128 + num / 2) / num) as i64
}
