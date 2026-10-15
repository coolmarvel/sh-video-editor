//! `effects.analyzeStabilizer`: the job analyses a generated movie, reports progress as events,
//! fills the render cache (the next render stabilises without analysing) and cancels cleanly.

use filmcraft_media::DemoScene;
use serde_json::{Value, json};

use crate::media_test_util::{make_movie, session_with, tmp_dir};
use crate::{Event, Session};

fn v1_clip(s: &Session) -> u64 {
    s.active_sequence().unwrap().video_tracks[0].items[0].id.0
}

fn progress_events(events: &[Event]) -> Vec<(f64, bool, bool)> {
    events
        .iter()
        .filter_map(|e| match e {
            Event::JobProgress { kind, progress, done, cancelled, .. } if kind == "stabilizer" => Some((*progress, *done, *cancelled)),
            _ => None,
        })
        .collect()
}

fn wait_for(s: &mut Session, job: u64) -> Vec<Event> {
    let t0 = std::time::Instant::now();
    let mut all = Vec::new();
    loop {
        all.extend(s.drain_events());
        if s.pump_jobs(std::time::Duration::from_millis(50)) {
            // web: the task advances here; native: the thread is working
        }
        let j = s.execute("jobs.list", json!({})).unwrap();
        let j = j.as_array().unwrap().iter().find(|x| x["id"] == job).unwrap().clone();
        if j["finished"] == true {
            all.extend(s.drain_events());
            return all;
        }
        assert!(t0.elapsed().as_secs() < 120, "job never finished");
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
}

#[test]
fn analysis_job_reports_progress_applies_the_effect_and_fills_the_render_cache() {
    filmcraft_render::vfx::clear_stabilizer_cache();
    let dir = tmp_dir("stab-job");
    let path = dir.join("shaky.mov");
    make_movie(&path, DemoScene::Plasma, 96, 54, 24);
    let (mut s, _, _) = session_with(&[&path]);
    let clip = v1_clip(&s);
    let r = s.execute("effects.analyzeStabilizer", json!({"clip": clip, "smoothness": 80})).unwrap();
    let job = r["job"].as_u64().expect("a job id");
    assert_eq!(r["frames"], 24);
    assert_eq!(r["cached"], false);
    // the effect was applied with the smoothness asked for, in one undo step
    let it = &s.active_sequence().unwrap().video_tracks[0].items[0];
    let e = it.effects.iter().find(|e| e.effect == "warp_stabilizer").expect("effect applied");
    assert_eq!(e.param("smoothness").map(|p| p.value.as_f64()), Some(Some(80.0)));
    assert_eq!(s.history.undo.last().map(|(l, _)| l.as_str()), Some("Warp Stabilizer"));
    let events = wait_for(&mut s, job);
    let p = progress_events(&events);
    assert!(p.len() >= 2, "progress events: {p:?}");
    assert!(p.windows(2).all(|w| w[0].0 <= w[1].0), "monotonic: {p:?}");
    assert_eq!(p.last().copied(), Some((1.0, true, false)));
    assert!(p.iter().take(p.len() - 1).all(|e| !e.1), "only the last is done: {p:?}");
    let listed = s.execute("jobs.list", json!({})).unwrap();
    let listed = listed.as_array().unwrap().iter().find(|x| x["id"] == job).unwrap().clone();
    assert_eq!(listed["kind"], "stabilizer");
    assert_eq!(listed["done"], 24);
    assert!(listed["result"]["error"].is_null(), "{listed}");
    // the render cache has the analysis: a second call says so and the view was bumped
    let again = s.execute("effects.analyzeStabilizer", json!({"clip": clip})).unwrap();
    assert_eq!(again["cached"], true);
    assert!(again["job"].is_null());
    assert!(events.iter().any(|e| matches!(e, Event::ProjectChanged { .. })), "view bumped when the analysis landed");
    // a render now stabilises without analysing (fast)
    let t0 = std::time::Instant::now();
    assert!(s.render_program_at(0.5, filmcraft_time::Tick::ZERO).is_some());
    assert!(t0.elapsed().as_secs_f64() < 5.0);
}

#[test]
fn cancel_stops_the_job_with_cancelled_and_leaves_no_analysis() {
    filmcraft_render::vfx::clear_stabilizer_cache();
    let dir = tmp_dir("stab-cancel");
    let path = dir.join("long.mov");
    make_movie(&path, DemoScene::Aurora, 96, 54, 240);
    let (mut s, _, _) = session_with(&[&path]);
    let clip = v1_clip(&s);
    let r = s.execute("effects.analyzeStabilizer", json!({"clip": clip})).unwrap();
    let job = r["job"].as_u64().unwrap();
    s.execute("jobs.cancel", json!({"job": job})).unwrap();
    let events = wait_for(&mut s, job);
    let p = progress_events(&events);
    let last = p.last().copied().expect("a final event");
    assert!(last.1 && last.2, "done + cancelled: {p:?}");
    assert!(last.0 < 1.0);
    let listed = s.execute("jobs.list", json!({})).unwrap();
    let listed = listed.as_array().unwrap().iter().find(|x| x["id"] == job).unwrap().clone();
    assert_eq!(listed["result"]["error"], "stopped");
    // nothing cached: asking again starts a new job
    let again = s.execute("effects.analyzeStabilizer", json!({"clip": clip})).unwrap();
    assert_eq!(again["cached"], false);
    assert_ne!(again["job"], Value::Null);
    s.execute("jobs.cancel", json!({"job": again["job"]})).unwrap();
    wait_for(&mut s, again["job"].as_u64().unwrap());
}

#[test]
fn wait_runs_on_this_thread_and_refuses_audio_clips() {
    filmcraft_render::vfx::clear_stabilizer_cache();
    let dir = tmp_dir("stab-wait");
    let path = dir.join("short.mov");
    make_movie(&path, DemoScene::Forest, 96, 54, 12);
    let (mut s, _, _) = session_with(&[&path]);
    let clip = v1_clip(&s);
    let r = s.execute("effects.analyzeStabilizer", json!({"clip": clip, "wait": true})).unwrap();
    let job = r["job"].as_u64().unwrap();
    let listed = s.execute("jobs.list", json!({})).unwrap();
    let listed = listed.as_array().unwrap().iter().find(|x| x["id"] == job).unwrap().clone();
    assert_eq!(listed["finished"], true);
    assert_eq!(listed["done"], 12);
    let audio = s.active_sequence().unwrap().audio_tracks[0].items[0].id.0;
    assert!(s.execute("effects.analyzeStabilizer", json!({"clip": audio})).is_err());
    assert!(s.execute("effects.analyzeStabilizer", json!({})).is_err());
}

#[test]
fn relinking_the_footage_analyses_again_instead_of_reusing_the_old_path() {
    // sh-video-editor: the analysis cache key holds the media reference, so the same project item
    // pointing at other footage (relink, replace) is not stabilised with the old footage's path
    let dir = tmp_dir("stab-relink");
    let a = dir.join("a.mov");
    let b = dir.join("b.mov");
    make_movie(&a, DemoScene::Plasma, 96, 54, 24);
    make_movie(&b, DemoScene::Aurora, 96, 54, 24);
    let (mut s, items, _) = session_with(&[&a]);
    let clip = v1_clip(&s);
    let r = s.execute("effects.analyzeStabilizer", json!({"clip": clip, "wait": true})).unwrap();
    assert_eq!(r["cached"], false);
    let r = s.execute("effects.analyzeStabilizer", json!({"clip": clip})).unwrap();
    assert_eq!(r["cached"], true, "same footage: the analysis is reused");
    s.execute("media.relink", json!({"item": items[0].0, "path": b.to_string_lossy(), "force": true})).unwrap();
    let r = s.execute("effects.analyzeStabilizer", json!({"clip": clip})).unwrap();
    assert_eq!(r["cached"], false, "other footage under the same item: analysed again");
    let job = r["job"].as_u64().expect("a job id");
    wait_for(&mut s, job);
    // undo of the relink brings the first footage back, and its analysis is still cached
    s.execute("edit.undo", json!({})).unwrap();
    let r = s.execute("effects.analyzeStabilizer", json!({"clip": clip})).unwrap();
    assert_eq!(r["cached"], true, "back to the first footage: its analysis is reused");
}
