#!/usr/bin/env bash
# 실매체 호환성 테스트 소재 생성기. 실제 폰·카메라 파일은 저장소에 없으므로 ffmpeg 로 그 특성(코덱·프로파일·
# 프레임 속도·회전 메타데이터·VFR·채널 수·용기)을 흉내낸 짧은 파일을 만든다. ffmpeg 는 생성기(테스트 오라클)로만
# 쓰고 엔진에 링크하지 않는다(packages/engine/AGENTS.md 3번). 멱등: 이미 있는 파일은 건너뛴다.
# 산출물: tests/corpus/out/ (gitignore). 전부 지우고 다시 만들려면 `rm -rf out`.
set -euo pipefail
cd "$(dirname "$0")"
OUT=${1:-out}
mkdir -p "$OUT"
FF=(ffmpeg -hide_banner -loglevel error -nostdin -y)
VID="testsrc2=size=1920x1080:rate=30"
TONE="sine=frequency=440:sample_rate=48000"

ENCODERS=$(ffmpeg -hide_banner -encoders 2>/dev/null || true)
have() { [ -s "$OUT/$1" ]; }
has_encoder() { grep -q " $1 " <<<"$ENCODERS"; }

# 갤럭시 류: H.264 High 1080p30 + AAC 48 kHz 스테레오, faststart
have galaxy_h264_high_1080p30_aac48k.mp4 || "${FF[@]}" -f lavfi -i "$VID" -f lavfi -i "$TONE" -t 3 \
  -c:v libx264 -preset veryfast -profile:v high -pix_fmt yuv420p -g 30 -c:a aac -b:a 128k -ar 48000 -ac 2 \
  -movflags +faststart "$OUT/galaxy_h264_high_1080p30_aac48k.mp4"

# 갤럭시 60 fps 모드: H.264 High 1080p60
have h264_high_1080p60.mp4 || "${FF[@]}" -f lavfi -i "testsrc2=size=1920x1080:rate=60" -f lavfi -i "$TONE" -t 2 \
  -c:v libx264 -preset veryfast -profile:v high -pix_fmt yuv420p -g 60 -c:a aac -ar 48000 -ac 2 \
  "$OUT/h264_high_1080p60.mp4"

# iPhone 류: HEVC Main 1080p30 (hvc1 태그) + AAC 48 kHz. libx265 가 없으면 건너뛴다
if has_encoder libx265; then
  have iphone_hevc_main_1080p30.mp4 || "${FF[@]}" -f lavfi -i "$VID" -f lavfi -i "$TONE" -t 3 \
    -c:v libx265 -preset ultrafast -x265-params log-level=error -tag:v hvc1 -pix_fmt yuv420p -c:a aac -ar 48000 -ac 2 \
    "$OUT/iphone_hevc_main_1080p30.mp4"
fi

# 화면 녹화 흉내: 가변 프레임 속도(VFR). 60 fps 소스에서 프레임을 불규칙하게 골라(원래 pts 유지) 간격이 1/60 의
# 들쭉날쭉한 배수가 된다. ffprobe 의 r_frame_rate 는 60, avg_frame_rate 는 그보다 낮다
have screenrec_h264_vfr.mp4 || "${FF[@]}" -f lavfi -i "testsrc2=size=1280x720:rate=60" -t 3 \
  -vf "select='gt(random(0),0.55)'" -fps_mode vfr \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -an "$OUT/screenrec_h264_vfr.mp4"

# 회전 메타데이터: 가로 1920x1080 으로 저장하고 tkhd 행렬로 90도(세로 표시). 폰 세로 촬영과 같다
have rotate90_portrait_h264.mp4 || "${FF[@]}" -display_rotation 90 -i "$OUT/galaxy_h264_high_1080p30_aac48k.mp4" \
  -t 2 -c copy "$OUT/rotate90_portrait_h264.mp4"
have rotate180_h264.mp4 || "${FF[@]}" -display_rotation 180 -i "$OUT/galaxy_h264_high_1080p30_aac48k.mp4" \
  -t 2 -c copy "$OUT/rotate180_h264.mp4"

# 모노 오디오(보이스 레코더 겸용 카메라)
have mono_audio_h264_720p.mp4 || "${FF[@]}" -f lavfi -i "testsrc2=size=1280x720:rate=30" -f lavfi -i "$TONE" -t 2 \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -ar 44100 -ac 1 "$OUT/mono_audio_h264_720p.mp4"

# 4K 짧은 클립
have h264_4k_2160p30.mp4 || "${FF[@]}" -f lavfi -i "testsrc2=size=3840x2160:rate=30" -f lavfi -i "$TONE" -t 1 \
  -c:v libx264 -preset veryfast -profile:v high -level 5.1 -pix_fmt yuv420p -c:a aac -ar 48000 -ac 2 \
  "$OUT/h264_4k_2160p30.mp4"

# 조각난 MP4(Windows 게임 바·일부 화면 녹화기가 쓰는 moof 조각)
have fragmented_h264_720p.mp4 || "${FF[@]}" -f lavfi -i "testsrc2=size=1280x720:rate=30" -f lavfi -i "$TONE" -t 2 \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -ar 48000 -ac 2 \
  -movflags +frag_keyframe+empty_moov+default_base_moof "$OUT/fragmented_h264_720p.mp4"

# 오디오만: mp3, aac(m4a)
if has_encoder libmp3lame; then
  have audio_only.mp3 || "${FF[@]}" -f lavfi -i "sine=frequency=330:sample_rate=44100" -t 3 -c:a libmp3lame -b:a 128k -ac 2 "$OUT/audio_only.mp3"
fi
have audio_only.m4a || "${FF[@]}" -f lavfi -i "$TONE" -t 3 -c:a aac -b:a 128k -ac 2 "$OUT/audio_only.m4a"

# 사진: PNG, JPEG
have photo.png || "${FF[@]}" -f lavfi -i "testsrc2=size=1280x720" -frames:v 1 "$OUT/photo.png"
have photo.jpg || "${FF[@]}" -f lavfi -i "testsrc2=size=1280x720" -frames:v 1 -q:v 3 "$OUT/photo.jpg"

ls -l "$OUT"
