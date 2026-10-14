//! 오디오 미리듣기(시퀀스 믹스)와 파형(미디어 항목 피크) 계산. napi 와 wasm 바인딩이 `#[path]` 로 같은 파일을
//! 포함해 같은 모양·같은 결과를 낸다. 편집 로직은 없다: 엔진의 믹스(`PreviewStore::mix`)와 트랙 입력
//! 미디어 소스(`MediaSource::audio`)를 부르고 바이트 모양만 바꾼다.

use filmcraft_audio_dsp::resample::StreamResampler;
use filmcraft_engine::Session;
use filmcraft_engine::project::ItemId;
use filmcraft_time::Tick;

/// `render_audio` 가 한 번에 돌려주는 최대 프레임 수(48 kHz 기준 10초). 호스트가 더 달라고 해도 여기서 자른다.
pub const MAX_FRAMES: usize = 480_000;
/// 호스트가 샘플레이트를 주지 않을 때의 출력 레이트.
pub const DEFAULT_SAMPLE_RATE: u32 = 48_000;
/// `audio_peaks` 의 초당 칸 수 상한.
pub const PEAK_RATE_MAX: u32 = 400;
/// `audio_peaks` 의 총 칸 수 상한(100/s 로 약 2.9시간).
pub const PEAK_BINS_MAX: usize = 1 << 20;

/// 활성 시퀀스의 `tick` 부터 `frames` 프레임을 interleaved 스테레오 f32 로. 길이는 항상 `frames * 2`
/// (시퀀스가 없으면 무음). 시퀀스 샘플레이트와 `sample_rate` 가 다르면 엔진의 스트림 리샘플러(선형 보간,
/// 절대 위치 기반이라 블록 경계에서 이어진다)로 바꾼다.
pub fn render_audio(session: &Session, tick: i64, frames: usize, sample_rate: u32) -> Vec<f32> {
    let frames = frames.min(MAX_FRAMES);
    let sr = if sample_rate == 0 { DEFAULT_SAMPLE_RATE } else { sample_rate };
    let mut out = vec![0.0f32; frames.saturating_mul(2)];
    if frames == 0 {
        return out;
    }
    let Some(seq_id) = session.state.active_sequence else {
        return out;
    };
    let project = session.project.clone();
    let Some(seq) = project.sequence(seq_id) else {
        return out;
    };
    let seq_sr = seq.settings.sample_rate.max(1);
    let provider = session.media.provider(project.clone(), session.services.clone());
    let previews = session.previews.clone();
    let t = Tick(tick.max(0));
    let start = t.to_units_floor(i64::from(sr));
    let channels = if seq_sr == sr {
        previews.mix(&project, seq_id, start, frames, &provider).channels
    } else {
        let mut r = StreamResampler::new(seq_sr, sr);
        r.process(start, frames, |s0, m| previews.mix(&project, seq_id, s0, m, &provider).channels)
    };
    interleave(&channels, frames, &mut out);
    out
}

fn interleave(channels: &[Vec<f32>], frames: usize, out: &mut [f32]) {
    let Some(left) = channels.first() else { return };
    let right = channels.get(1).unwrap_or(left);
    for i in 0..frames {
        let l = left.get(i).copied().unwrap_or(0.0);
        let r = right.get(i).copied().unwrap_or(0.0);
        if let Some(s) = out.get_mut(i * 2) {
            *s = l;
        }
        if let Some(s) = out.get_mut(i * 2 + 1) {
            *s = r;
        }
    }
}

/// 미디어 항목 `item` 의 소리 전체를 초당 `per_second` 칸의 min/max 피크로(interleaved `[min, max]`, 길이 = 칸 수 * 2,
/// 두 채널을 합친 값). 소리가 없는 항목이면 빈 배열. 타임라인 파형은 이 배열을 항목마다 한 번 받아 두고 클립의
/// 소스 구간(sourceIn..sourceOut)을 잘라 줌에 맞춰 다시 줄인다(트림·이동에 다시 계산하지 않는다).
pub fn audio_peaks(session: &Session, item: u64, per_second: u32) -> Vec<f32> {
    let per_second = per_second.clamp(1, PEAK_RATE_MAX);
    let id = ItemId(item);
    let Some(duration) = filmcraft_engine::media_duration(&session.project, &session.media, id) else {
        return Vec::new();
    };
    let Some(src) = session.source(id) else {
        return Vec::new();
    };
    if !src.info().has_audio() {
        return Vec::new();
    }
    let sr = DEFAULT_SAMPLE_RATE;
    let total = duration.to_units_floor(i64::from(sr)).max(0);
    let bins = usize::try_from((total.saturating_mul(i64::from(per_second)) + i64::from(sr) - 1) / i64::from(sr)).unwrap_or(0).min(PEAK_BINS_MAX);
    if bins == 0 {
        return Vec::new();
    }
    let mut out = vec![0.0f32; bins * 2];
    let mut pos = 0i64;
    while pos < total {
        let n = usize::try_from(total - pos).unwrap_or(0).min(sr as usize);
        if n == 0 {
            break;
        }
        let Ok(buf) = src.audio(pos, n, sr) else {
            break;
        };
        for i in 0..n {
            let bin = usize::try_from((pos + i as i64).saturating_mul(i64::from(per_second)) / i64::from(sr)).unwrap_or(0);
            if bin >= bins {
                break;
            }
            for ch in buf.channels.iter().take(2) {
                let Some(v) = ch.get(i) else { continue };
                if let Some(lo) = out.get_mut(bin * 2)
                    && *v < *lo
                {
                    *lo = *v;
                }
                if let Some(hi) = out.get_mut(bin * 2 + 1)
                    && *v > *hi
                {
                    *hi = *v;
                }
            }
        }
        pos = pos.saturating_add(n as i64);
    }
    out
}
