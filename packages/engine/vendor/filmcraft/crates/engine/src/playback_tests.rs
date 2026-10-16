//! Playback read-ahead ([`crate::playback`]): frames served from the queue are byte-identical to
//! frames rendered on demand, the queue follows skips, seeks, edits and reverse play, warms the
//! next clip's decoder and stays within its bounds.

use filmcraft_media::DemoScene;
use filmcraft_time::Tick;
use serde_json::json;

use crate::Session;
use crate::media_test_util::{make_movie, session_with, tmp_dir};
use crate::playback::{AHEAD_FRAMES, MAX_READY_BYTES, PREPARE_FRAMES};

fn frame(s: &Session) -> Tick {
    s.sequence_rate().frame_duration()
}

fn status(s: &Session) -> serde_json::Value {
    s.playback_status()
}

fn wait_ready(s: &Session, n: u64) {
    let t0 = std::time::Instant::now();
    while status(s)["ready"].as_u64().unwrap_or(0) < n {
        assert!(t0.elapsed().as_secs() < 60, "read-ahead never filled: {}", status(s));
        std::thread::sleep(std::time::Duration::from_millis(2));
    }
}

/// Two 24-frame movies one after the other on V1.
fn two_clips(name: &str) -> Session {
    let dir = tmp_dir(name);
    let a = dir.join("a.mp4");
    let b = dir.join("b.mp4");
    make_movie(&a, DemoScene::Plasma, 160, 90, 24);
    make_movie(&b, DemoScene::Aurora, 160, 90, 24);
    let (s, _, _) = session_with(&[&a, &b]);
    s
}

fn on_demand(s: &Session, t: Tick) -> Vec<u8> {
    s.render_program_at(1.0, t).unwrap().over_black_rgba8()
}

#[test]
fn ready_frames_are_identical_to_rendering_on_demand() {
    let s = two_clips("ra-same");
    let f = frame(&s);
    let expected: Vec<Vec<u8>> = (0..12).map(|i| on_demand(&s, Tick(f.0 * i))).collect();
    s.playback_start(Tick::ZERO, 1.0, 1.0).unwrap();
    wait_ready(&s, AHEAD_FRAMES as u64);
    for (i, want) in expected.iter().enumerate() {
        let (_, _, got) = s.render_program_rgba8(1.0, Tick(f.0 * i as i64)).unwrap();
        assert!(&got == want, "frame {i} differs from the on-demand render");
    }
    let st = status(&s);
    assert!(st["hits"].as_u64().unwrap() >= AHEAD_FRAMES as u64, "{st}");
    s.playback_stop();
    assert_eq!(status(&s)["active"], false);
}

#[test]
fn skipped_frames_are_dropped_and_a_seek_replans_after_the_wanted_frame() {
    let s = two_clips("ra-seek");
    let f = frame(&s);
    s.playback_start(Tick::ZERO, 1.0, 1.0).unwrap();
    wait_ready(&s, AHEAD_FRAMES as u64);
    // the host skipped frames 0..3 (late): frame 3 still comes from the queue
    let (_, _, got) = s.render_program_rgba8(1.0, Tick(f.0 * 3)).unwrap();
    assert_eq!(got, on_demand(&s, Tick(f.0 * 3)));
    let hits = status(&s)["hits"].as_u64().unwrap();
    assert_eq!(hits, 1);
    // a seek far ahead: rendered here (miss), and the queue continues after it
    let far = Tick(f.0 * 30);
    let (_, _, got) = s.render_program_rgba8(1.0, far).unwrap();
    assert_eq!(got, on_demand(&s, far));
    wait_ready(&s, 2);
    let (_, _, next) = s.render_program_rgba8(1.0, Tick(far.0 + f.0)).unwrap();
    assert_eq!(next, on_demand(&s, Tick(far.0 + f.0)));
    assert!(status(&s)["hits"].as_u64().unwrap() > hits, "{}", status(&s));
}

#[test]
fn an_edit_drops_the_old_frames_and_replans_on_the_new_project() {
    let mut s = two_clips("ra-edit");
    let f = frame(&s);
    s.playback_start(Tick::ZERO, 1.0, 1.0).unwrap();
    wait_ready(&s, AHEAD_FRAMES as u64);
    let clip = s.active_sequence().unwrap().video_tracks[0].items[0].id.0;
    s.execute("effects.apply", json!({"clips": [clip], "effect": "black_white"})).unwrap();
    // the queue was rendered before the edit: frame 1 must show the edit
    let (_, _, got) = s.render_program_rgba8(1.0, Tick(f.0)).unwrap();
    assert_eq!(got, on_demand(&s, Tick(f.0)), "an old (pre-edit) frame was served");
    wait_ready(&s, 2);
    let (_, _, got) = s.render_program_rgba8(1.0, Tick(f.0 * 2)).unwrap();
    assert_eq!(got, on_demand(&s, Tick(f.0 * 2)));
}

#[test]
fn reverse_and_double_rate_plans_follow_the_direction_and_stride() {
    let s = two_clips("ra-rate");
    let f = frame(&s);
    let start = Tick(f.0 * 40);
    s.playback_start(start, -1.0, 1.0).unwrap();
    wait_ready(&s, 3);
    for k in 0..3 {
        let t = Tick(start.0 - f.0 * k);
        let (_, _, got) = s.render_program_rgba8(1.0, t).unwrap();
        assert_eq!(got, on_demand(&s, t), "reverse frame {k}");
    }
    let hits = status(&s)["hits"].as_u64().unwrap();
    assert_eq!(hits, 3, "{}", status(&s));
    s.playback_start(Tick::ZERO, 2.0, 1.0).unwrap();
    wait_ready(&s, 3);
    for k in 0..3 {
        let t = Tick(f.0 * 2 * k);
        let (_, _, got) = s.render_program_rgba8(1.0, t).unwrap();
        assert_eq!(got, on_demand(&s, t), "2x frame {k}");
    }
    assert_eq!(status(&s)["hits"].as_u64().unwrap(), hits + 3, "{}", status(&s));
}

#[test]
fn prepare_readies_the_first_frames_and_play_keeps_them() {
    let s = two_clips("ra-prepare");
    let f = frame(&s);
    s.playback_prepare(Tick::ZERO, 1.0).unwrap();
    wait_ready(&s, PREPARE_FRAMES as u64);
    std::thread::sleep(std::time::Duration::from_millis(50));
    assert_eq!(status(&s)["ready"].as_u64().unwrap(), PREPARE_FRAMES as u64, "paused prepare must stop at its target");
    assert_eq!(status(&s)["playing"], false);
    s.playback_start(Tick::ZERO, 1.0, 1.0).unwrap();
    assert!(status(&s)["ready"].as_u64().unwrap() >= PREPARE_FRAMES as u64, "play dropped the prepared frames: {}", status(&s));
    let (_, _, got) = s.render_program_rgba8(1.0, Tick::ZERO).unwrap();
    assert_eq!(got, on_demand(&s, Tick::ZERO));
    assert_eq!(status(&s)["hits"].as_u64().unwrap(), 1);
    let _ = f;
}

#[test]
fn a_full_queue_warms_the_next_clip_and_stays_within_its_bounds() {
    let s = two_clips("ra-warm");
    // 24-frame clips: the second starts at 1 s, within the warm reach of the first frames
    s.playback_start(Tick::ZERO, 1.0, 1.0).unwrap();
    let t0 = std::time::Instant::now();
    while status(&s)["warmed"].as_u64().unwrap_or(0) == 0 {
        assert!(t0.elapsed().as_secs() < 60, "next clip never warmed: {}", status(&s));
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    let st = status(&s);
    assert!(st["ready"].as_u64().unwrap() <= AHEAD_FRAMES as u64, "{st}");
    assert!(st["bytes"].as_u64().unwrap() as usize <= MAX_READY_BYTES, "{st}");
}

#[test]
fn no_sequence_is_an_error_and_status_is_inactive() {
    let s = Session::default();
    assert!(s.playback_start(Tick::ZERO, 1.0, 0.5).is_err());
    assert_eq!(s.playback_status()["active"], false);
    s.playback_stop();
}

#[test]
fn play_after_prepare_takes_the_shown_frame_from_the_queue() {
    let s = two_clips("ra-shown");
    let f = frame(&s);
    // paused: the monitor shows frame 0 on demand, then prepares from there (frame 0 again, in the background)
    let (_, _, shown) = s.render_program_rgba8(1.0, Tick::ZERO).unwrap();
    s.playback_prepare(Tick::ZERO, 1.0).unwrap();
    wait_ready(&s, PREPARE_FRAMES as u64);
    s.playback_start(Tick::ZERO, 1.0, 1.0).unwrap();
    assert_eq!(status(&s)["ready"].as_u64().unwrap(), PREPARE_FRAMES as u64, "play dropped the prepared frames: {}", status(&s));
    let (_, _, first) = s.render_program_rgba8(1.0, Tick::ZERO).unwrap();
    assert_eq!(first, shown);
    let (_, _, next) = s.render_program_rgba8(1.0, f).unwrap();
    assert_eq!(next, on_demand(&s, f));
    assert_eq!(status(&s)["hits"].as_u64().unwrap(), 2, "{}", status(&s));
}
