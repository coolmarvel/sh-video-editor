//! sh-video-editor additions (`sh_commands`, parameter validation, `linked` options, inspect
//! parameter JSON, reversed source times, truncated media warnings).

use super::*;
use filmcraft_project::{ClipId, TransitionAlign};
use serde_json::{Value, json};

fn demo() -> Session {
    let mut s = Session::default();
    s.execute("file.openDemoProject", json!({})).unwrap();
    s
}

/// A 30 fps sequence with two 4 s colour mattes on V1, meeting at 4 s.
fn mattes() -> (Session, u64, u64) {
    let mut s = Session::default();
    s.execute("file.newProject", json!({"name": "t"})).unwrap();
    s.execute("file.newSequence", json!({"name": "seq", "width": 320, "height": 180, "fps": 30})).unwrap();
    let r = s.execute("file.newColorMatte", json!({"color": "#ff0000", "seconds": 4})).unwrap()["item"].as_u64().unwrap();
    let b = s.execute("file.newColorMatte", json!({"color": "#0000ff", "seconds": 4})).unwrap()["item"].as_u64().unwrap();
    let red = s.execute("timeline.place", json!({"item": r, "track": "V1", "time": 0, "insert": true})).unwrap()["clips"][0].as_u64().unwrap();
    let t = 4 * filmcraft_time::TICKS_PER_SECOND;
    let blue = s.execute("timeline.place", json!({"item": b, "track": "V1", "time": t, "insert": true})).unwrap()["clips"][0].as_u64().unwrap();
    (s, red, blue)
}

fn transitions(s: &Session) -> Vec<filmcraft_project::Transition> {
    s.active_sequence().unwrap().video_tracks[0].transitions.clone()
}

fn frames(s: &Session, t: Tick) -> i64 {
    s.sequence_rate().frame_at(t)
}

#[test]
fn remove_transition_drops_a_transition_or_a_fade_in_one_undo_step() {
    let (mut s, red, _blue) = mattes();
    let id = s.execute("sequence.applyVideoTransition", json!({"clip": red, "edge": "out", "frames": 30})).unwrap()["transition"].as_u64().unwrap();
    let fade = s.execute("sequence.applyVideoTransition", json!({"clip": red, "edge": "in", "frames": 15})).unwrap()["transition"].as_u64().unwrap();
    assert_eq!(transitions(&s).len(), 2);
    let r = s.execute("sequence.removeTransition", json!({"transition": id})).unwrap();
    assert_eq!(r["transition"], id);
    assert_eq!(transitions(&s).iter().map(|t| t.id.0).collect::<Vec<_>>(), vec![fade]);
    assert!(s.execute("sequence.removeTransition", json!({"transition": id})).is_err(), "gone");
    assert!(s.execute("sequence.removeTransition", json!({})).is_err(), "needs an id");
    assert_eq!(s.undo().as_deref(), Some("Remove Transition"));
    assert_eq!(transitions(&s).len(), 2);
    s.execute("sequence.removeTransition", json!({"transition": fade})).unwrap();
    assert_eq!(transitions(&s).len(), 1);
}

#[test]
fn set_transition_length_resizes_and_realigns_in_place() {
    let (mut s, red, blue) = mattes();
    let id = s.execute("sequence.applyVideoTransition", json!({"clip": red, "edge": "out", "frames": 30})).unwrap()["transition"].as_u64().unwrap();
    let cut = 4 * 30;
    let span = |s: &Session| {
        let t = transitions(s).into_iter().find(|t| t.id.0 == id).unwrap();
        (frames(s, t.start), frames(s, t.duration), t.align, t.from.map(|c| c.0), t.to.map(|c| c.0))
    };
    assert_eq!(span(&s), (cut - 15, 30, TransitionAlign::CenterAtCut, Some(red), Some(blue)));
    let r = s.execute("sequence.setTransitionLength", json!({"transition": id, "frames": 60})).unwrap();
    assert_eq!(r["align"], "center");
    assert_eq!(span(&s), (cut - 30, 60, TransitionAlign::CenterAtCut, Some(red), Some(blue)));
    s.execute("sequence.setTransitionLength", json!({"transition": id, "frames": 20, "align": "start"})).unwrap();
    assert_eq!(span(&s), (cut, 20, TransitionAlign::StartAtCut, Some(red), Some(blue)));
    s.execute("sequence.setTransitionLength", json!({"transition": id, "frames": 20, "align": "end"})).unwrap();
    assert_eq!(span(&s), (cut - 20, 20, TransitionAlign::EndAtCut, Some(red), Some(blue)));
    // the alignment sticks when only the length changes
    s.execute("sequence.setTransitionLength", json!({"transition": id, "frames": 10})).unwrap();
    assert_eq!(span(&s), (cut - 10, 10, TransitionAlign::EndAtCut, Some(red), Some(blue)));
    for bad in [
        json!({"transition": id, "frames": 0}),
        json!({"transition": id, "frames": -5}),
        json!({"transition": id}),
        json!({"transition": id, "frames": 10, "align": "middle"}),
    ] {
        assert!(s.execute("sequence.setTransitionLength", bad.clone()).is_err(), "{bad}");
    }
    assert_eq!(span(&s), (cut - 10, 10, TransitionAlign::EndAtCut, Some(red), Some(blue)), "a refused call changes nothing");
    assert_eq!(s.undo().as_deref(), Some("Set Transition Length"));
    assert_eq!(span(&s), (cut - 20, 20, TransitionAlign::EndAtCut, Some(red), Some(blue)));
    // a fade in always starts at its clip
    let fade = s.execute("sequence.applyVideoTransition", json!({"clip": red, "edge": "in", "frames": 15})).unwrap()["transition"].as_u64().unwrap();
    s.execute("sequence.setTransitionLength", json!({"transition": fade, "frames": 6, "align": "end"})).unwrap();
    let f = transitions(&s).into_iter().find(|t| t.id.0 == fade).unwrap();
    assert_eq!((frames(&s, f.start), frames(&s, f.duration), f.align), (0, 6, TransitionAlign::StartAtCut));
}

#[test]
fn a_regular_trim_that_opens_a_gap_removes_the_transition_through_the_command() {
    let (mut s, red, _blue) = mattes();
    s.execute("sequence.applyVideoTransition", json!({"clip": red, "edge": "out", "frames": 30})).unwrap();
    s.execute("timeline.trim", json!({"clip": red, "edge": "out", "mode": "ripple", "deltaFrames": -10})).unwrap();
    assert_eq!(transitions(&s).len(), 1, "ripple keeps the cut");
    s.execute("timeline.trim", json!({"clip": red, "edge": "out", "mode": "regular", "deltaFrames": -10})).unwrap();
    assert!(transitions(&s).is_empty(), "a gap has no cut to dissolve across");
}

fn effects_of(s: &Session, clip: u64) -> Vec<String> {
    s.active_sequence().unwrap().find_item(ClipId(clip)).unwrap().1.effects.iter().map(|e| e.effect.clone()).collect()
}

#[test]
fn effects_move_reorders_standard_effects_only() {
    let mut s = demo();
    let clip = s.active_sequence().unwrap().video_tracks[0].items[0].id.0;
    s.execute("effects.apply", json!({"clips": [clip], "effect": "gaussian_blur"})).unwrap();
    s.execute("effects.apply", json!({"clips": [clip], "effect": "brightness_contrast"})).unwrap();
    let before = effects_of(&s, clip);
    let standard = before.iter().position(|e| e != "gaussian_blur" && e != "brightness_contrast").unwrap_or(before.len());
    assert!(standard >= 2, "{before:?}");
    let (i, j) = (standard - 2, standard - 1);
    s.execute("effects.move", json!({"clip": clip, "from": i, "to": j})).unwrap();
    let after = effects_of(&s, clip);
    assert_eq!((after[i].as_str(), after[j].as_str()), (before[j].as_str(), before[i].as_str()));
    assert_eq!(after[standard..], before[standard..], "intrinsics untouched");
    assert!(s.execute("effects.move", json!({"clip": clip, "from": i, "to": standard})).is_err(), "cannot pass an intrinsic");
    assert!(s.execute("effects.move", json!({"clip": clip, "from": before.len() - 1, "to": 0})).is_err(), "cannot move an intrinsic");
    assert!(s.execute("effects.move", json!({"clip": clip, "from": 0, "to": 100})).is_err());
    assert!(s.execute("effects.move", json!({"clip": clip, "from": -1, "to": 0})).is_err());
    assert_eq!(s.undo().as_deref(), Some("Move Effect"));
    assert_eq!(effects_of(&s, clip), before);
}

#[test]
fn effects_bypass_switches_every_standard_effect_at_once() {
    let mut s = demo();
    let clip = s.active_sequence().unwrap().video_tracks[0].items[0].id.0;
    s.execute("effects.apply", json!({"clips": [clip], "effect": "gaussian_blur"})).unwrap();
    s.execute("effects.apply", json!({"clips": [clip], "effect": "brightness_contrast"})).unwrap();
    let enabled = |s: &Session| -> Vec<(String, bool)> {
        s.active_sequence().unwrap().find_item(ClipId(clip)).unwrap().1.effects.iter().map(|e| (e.effect.clone(), e.enabled)).collect()
    };
    let r = s.execute("effects.bypass", json!({"clips": [clip], "enabled": false})).unwrap();
    assert_eq!(r["effects"], 2);
    for (e, on) in enabled(&s) {
        let standard = e == "gaussian_blur" || e == "brightness_contrast";
        assert_eq!(on, !standard, "{e}");
    }
    let r = s.execute("effects.bypass", json!({"clips": [clip], "enabled": true})).unwrap();
    assert_eq!(r["effects"], 2);
    assert!(enabled(&s).iter().all(|(_, on)| *on));
    assert!(s.execute("effects.bypass", json!({"clips": [clip]})).is_err(), "needs `enabled`");
    assert_eq!(s.undo().as_deref(), Some("Enable Effects"));
    assert_eq!(s.undo().as_deref(), Some("Bypass Effects"));
}

#[test]
fn lumetri_preset_replaces_the_clips_lumetri_unless_asked_to_stack() {
    let mut s = demo();
    let clip = s.active_sequence().unwrap().video_tracks[0].items[0].id.0;
    let presets = s.execute("lumetri.presets", json!({})).unwrap();
    let names: Vec<String> = presets["presets"].as_array().unwrap().iter().filter_map(|p| p["name"].as_str().map(str::to_string)).collect();
    let (a, b) = (names[0].clone(), names[1].clone());
    let lumetris = |s: &Session| effects_of(s, clip).iter().filter(|e| *e == "lumetri").count();
    s.execute("lumetri.applyPreset", json!({"name": a, "clips": [clip]})).unwrap();
    assert_eq!(lumetris(&s), 1);
    let pos = effects_of(&s, clip).iter().position(|e| e == "lumetri").unwrap();
    s.execute("lumetri.applyPreset", json!({"name": b, "clips": [clip]})).unwrap();
    assert_eq!(lumetris(&s), 1, "replaced, not stacked");
    assert_eq!(effects_of(&s, clip).iter().position(|e| e == "lumetri"), Some(pos), "same place in the stack");
    s.execute("lumetri.applyPreset", json!({"name": a, "clips": [clip], "replace": false})).unwrap();
    assert_eq!(lumetris(&s), 2, "stacked on request");
    s.execute("lumetri.applyPreset", json!({"name": b, "clips": [clip]})).unwrap();
    assert_eq!(lumetris(&s), 1, "replace clears every Lumetri on the clip");
}

fn undo_labels(s: &Session) -> Vec<String> {
    s.history.undo.iter().map(|u| u.0.clone()).collect()
}

#[test]
fn a_transaction_collapses_several_edits_into_one_undo_step() {
    let mut s = demo();
    let clips: Vec<u64> = s.active_sequence().unwrap().video_tracks[0].items.iter().map(|i| i.id.0).collect();
    let n0 = undo_labels(&s).len();
    s.execute("edit.beginTransaction", json!({"label": "Change Ratio"})).unwrap();
    s.execute("sequence.settings", json!({"width": 1080, "height": 1920})).unwrap();
    s.execute("clip.fitToFrame", json!({"clips": clips})).unwrap();
    assert!(s.execute("edit.undo", json!({})).is_err(), "undo waits for the transaction");
    assert!(s.undo().is_none(), "the binding's undo too");
    let r = s.execute("edit.endTransaction", json!({})).unwrap();
    assert_eq!(r["steps"], 2);
    assert_eq!(r["open"], false);
    let labels = undo_labels(&s);
    assert_eq!(labels.len(), n0 + 1);
    assert_eq!(labels.last().map(String::as_str), Some("Change Ratio"));
    assert_eq!(s.active_sequence().unwrap().settings.width, 1080);
    assert_eq!(s.undo().as_deref(), Some("Change Ratio"));
    assert_eq!(s.active_sequence().unwrap().settings.width, 1920, "both edits undone at once");
    assert_eq!(s.redo().as_deref(), Some("Change Ratio"));
    assert_eq!(s.active_sequence().unwrap().settings.width, 1080);
    assert!(s.execute("edit.endTransaction", json!({})).is_err(), "nothing open");
    assert!(s.execute("edit.cancelTransaction", json!({})).is_err());
    // an empty transaction leaves no step behind
    s.execute("edit.beginTransaction", json!({"label": "Nothing"})).unwrap();
    let r = s.execute("edit.endTransaction", json!({})).unwrap();
    assert_eq!(r["steps"], 0);
    assert_eq!(undo_labels(&s).len(), n0 + 1);
}

#[test]
fn nested_transactions_collapse_once_and_cancel_rolls_everything_back() {
    let mut s = demo();
    let n0 = undo_labels(&s).len();
    let width = |s: &Session| s.active_sequence().unwrap().settings.width;
    s.execute("edit.beginTransaction", json!({"label": "Outer"})).unwrap();
    s.execute("sequence.settings", json!({"width": 1000, "height": 500})).unwrap();
    assert_eq!(s.execute("edit.beginTransaction", json!({"label": "Inner"})).unwrap()["depth"], 1);
    s.execute("sequence.settings", json!({"width": 800, "height": 400})).unwrap();
    let r = s.execute("edit.endTransaction", json!({})).unwrap();
    assert_eq!(r["open"], true, "the inner end closes nothing");
    assert_eq!(undo_labels(&s).len(), n0 + 2, "still every step");
    s.execute("sequence.settings", json!({"width": 640, "height": 360})).unwrap();
    let r = s.execute("edit.endTransaction", json!({})).unwrap();
    assert_eq!((r["open"].clone(), r["steps"].clone(), r["label"].clone()), (json!(false), json!(3), json!("Outer")));
    assert_eq!(undo_labels(&s).len(), n0 + 1);
    assert_eq!(width(&s), 640);
    assert_eq!(s.undo().as_deref(), Some("Outer"));
    assert_eq!(width(&s), 1920);
    // cancel: back to before the first edit, whatever the nesting
    s.execute("edit.beginTransaction", json!({"label": "Try"})).unwrap();
    s.execute("sequence.settings", json!({"width": 1000, "height": 500})).unwrap();
    s.execute("edit.beginTransaction", json!({})).unwrap();
    s.execute("sequence.settings", json!({"width": 800, "height": 400})).unwrap();
    let r = s.execute("edit.cancelTransaction", json!({})).unwrap();
    assert_eq!(r["rolledBack"], 2);
    assert_eq!(width(&s), 1920);
    assert_eq!(undo_labels(&s).len(), n0, "no step left of the cancelled transaction");
    assert!(s.history.transaction.is_none());
    assert!(s.is_dirty(), "a rollback still counts as a change of the shown project");
}

#[test]
fn edit_transaction_runs_a_list_as_one_step_and_rolls_back_on_failure() {
    let mut s = demo();
    let n0 = undo_labels(&s).len();
    let width = |s: &Session| s.active_sequence().unwrap().settings.width;
    let r = s
        .execute(
            "edit.transaction",
            json!({"label": "Batch", "commands": [
                {"id": "sequence.settings", "params": {"width": 1000, "height": 500}},
                {"id": "sequence.settings", "params": {"width": 800, "height": 400}},
            ]}),
        )
        .unwrap();
    assert_eq!(r["steps"], 2);
    assert_eq!(r["results"].as_array().map(Vec::len), Some(2));
    assert_eq!(width(&s), 800);
    assert_eq!(undo_labels(&s).len(), n0 + 1);
    assert_eq!(undo_labels(&s).last().map(String::as_str), Some("Batch"));
    let e = s
        .execute(
            "edit.transaction",
            json!({"label": "Broken", "commands": [
                {"id": "sequence.settings", "params": {"width": 640, "height": 360}},
                {"id": "sequence.settings", "params": {"fps": 0}},
            ]}),
        )
        .unwrap_err();
    assert!(e.to_string().contains("fps"), "{e}");
    assert_eq!(width(&s), 800, "the first command was rolled back");
    assert_eq!(undo_labels(&s).len(), n0 + 1);
    assert!(s.history.transaction.is_none());
    for bad in [
        json!({"label": "x"}),
        json!({"label": "x", "commands": [{"params": {}}]}),
        json!({"label": "x", "commands": [{"id": "edit.undo"}]}),
        json!({"label": "x", "commands": [{"id": "edit.transaction", "params": {"commands": []}}]}),
    ] {
        assert!(s.execute("edit.transaction", bad.clone()).is_err(), "{bad}");
        assert!(s.history.transaction.is_none(), "{bad}: nothing left open");
    }
}

#[test]
fn the_undo_limit_keeps_an_open_transaction_consistent() {
    let mut s = demo();
    s.history.limit = 3;
    s.execute("edit.beginTransaction", json!({"label": "Many"})).unwrap();
    for i in 0..6 {
        s.execute("sequence.settings", json!({"width": 640 + i * 2, "height": 360})).unwrap();
    }
    let r = s.execute("edit.endTransaction", json!({})).unwrap();
    assert_eq!(r["open"], false);
    assert!(undo_labels(&s).len() <= 3);
    assert_eq!(undo_labels(&s).last().map(String::as_str), Some("Many"));
    assert!(s.undo().is_some());
}

#[test]
fn clip_enable_and_link_take_the_linked_partner_along_unless_told_not_to() {
    let mut s = demo();
    s.execute("sequence.linkedSelection", json!({"on": false})).unwrap();
    let q = s.active_sequence().unwrap();
    let v = q.video_tracks[0].items[0].clone();
    let a = q.audio_tracks[0].items.iter().find(|i| i.link == v.link).unwrap().clone();
    assert!(v.link.is_some());
    let enabled = |s: &Session| {
        let q = s.active_sequence().unwrap();
        (q.find_item(v.id).unwrap().1.enabled, q.find_item(a.id).unwrap().1.enabled)
    };
    s.execute("clip.enable", json!({"clips": [v.id.0]})).unwrap();
    assert_eq!(enabled(&s), (false, false), "the sound follows even with Linked Selection off");
    s.execute("clip.enable", json!({"clips": [v.id.0], "linked": false})).unwrap();
    assert_eq!(enabled(&s), (true, false), "only the clip named");
    s.execute("clip.enable", json!({"clips": [a.id.0]})).unwrap();
    assert_eq!(enabled(&s), (true, true), "all on when not all are on, including the partner");
    // unlink from the video clip alone: the partner is unlinked too
    let r = s.execute("clip.link", json!({"clips": [v.id.0]})).unwrap();
    assert_eq!(r["linked"], false);
    let q = s.active_sequence().unwrap();
    assert!(q.find_item(v.id).unwrap().1.link.is_none() && q.find_item(a.id).unwrap().1.link.is_none());
    // link again naming both
    let r = s.execute("clip.link", json!({"clips": [v.id.0, a.id.0]})).unwrap();
    assert_eq!(r["linked"], true);
    let q = s.active_sequence().unwrap();
    assert_eq!(q.find_item(v.id).unwrap().1.link, q.find_item(a.id).unwrap().1.link);
    assert!(q.find_item(v.id).unwrap().1.link.is_some());
}

#[test]
fn timeline_trim_linked_option_overrides_linked_selection() {
    let mut s = demo();
    let q = s.active_sequence().unwrap();
    let v = q.video_tracks[0].items[0].clone();
    let a = q.audio_tracks[0].items.iter().find(|i| i.link == v.link).unwrap().clone();
    let ends = |s: &Session| {
        let q = s.active_sequence().unwrap();
        (frames(s, q.find_item(v.id).unwrap().1.end()), frames(s, q.find_item(a.id).unwrap().1.end()))
    };
    let (ve, ae) = ends(&s);
    assert!(s.state.linked_selection);
    s.execute("timeline.trim", json!({"clip": v.id.0, "edge": "out", "mode": "regular", "deltaFrames": -3, "linked": false})).unwrap();
    assert_eq!(ends(&s), (ve - 3, ae), "linked: false trims the clip alone with Linked Selection on");
    s.execute("sequence.linkedSelection", json!({"on": false})).unwrap();
    s.execute("timeline.trim", json!({"clip": v.id.0, "edge": "out", "mode": "regular", "deltaFrames": -3, "linked": true})).unwrap();
    assert_eq!(ends(&s), (ve - 6, ae - 3), "linked: true trims both with Linked Selection off");
    s.execute("timeline.trim", json!({"clip": v.id.0, "edge": "out", "mode": "regular", "deltaFrames": -3})).unwrap();
    assert_eq!(ends(&s), (ve - 9, ae - 3), "absent: Linked Selection decides");
    assert!(s.execute("timeline.trim", json!({"clip": v.id.0, "edge": "sideways", "deltaFrames": 1})).is_err());
    assert!(s.execute("timeline.trim", json!({"clip": v.id.0, "edge": "in", "mode": "slide", "deltaFrames": 1})).is_err());
}

#[test]
fn malformed_parameters_are_refused_before_anything_runs() {
    let mut s = demo();
    let clip = s.active_sequence().unwrap().video_tracks[0].items[0].id.0;
    let dur = s.active_sequence().unwrap().duration();
    for (cmd, p) in [
        ("timeline.razor", json!([])),
        ("timeline.razor", json!("str")),
        ("timeline.razor", json!(1)),
        ("timeline.razor", json!({"time": "abc"})),
        ("timeline.razor", json!({"time": 1.5})),
        ("timeline.razor", json!({"frame": "1"})),
        ("playhead.set", json!({"seconds": "x"})),
        ("playhead.set", json!({"timecode": 12})),
        ("timeline.select", json!({"clips": [123_456], "add": false, "toggle": false})),
        ("timeline.select", json!({"clips": 5})),
        ("timeline.select", json!({"clips": ["a"]})),
        ("effects.apply", json!({"clips": [clip, 999_999], "effect": "gaussian_blur"})),
        ("timeline.trim", json!({"clip": 999_999, "edge": "out", "deltaFrames": -1})),
        ("timeline.trim", json!({"clip": clip, "edge": "out", "deltaFrames": 1.5})),
        ("file.importDemoFootage", json!({"scene": "Nope"})),
    ] {
        let e = s.execute(cmd, p.clone()).unwrap_err();
        assert!(matches!(e, EngineError::BadParams { .. }), "{cmd} {p}: {e}");
    }
    assert_eq!(s.active_sequence().unwrap().duration(), dur, "nothing ran");
    assert!(s.history.undo.is_empty());
    // what is right still runs: null params, integer-valued ticks, a partner-less clip list
    s.execute("edit.deselectAll", Value::Null).unwrap();
    s.execute("timeline.select", json!({"clips": [clip]})).unwrap();
    assert_eq!(s.state.selection.len(), 2, "with its linked sound");
    s.execute("timeline.razor", json!({"time": s.sequence_rate().tick_of(10).0})).unwrap();
}

#[test]
fn inspect_reports_effect_parameters_as_json_values_with_a_kind() {
    let mut s = demo();
    let clip = s.active_sequence().unwrap().video_tracks[0].items[0].id.0;
    s.execute("effects.apply", json!({"clips": [clip], "effect": "brightness_contrast"})).unwrap();
    s.execute("effects.setParam", json!({"clip": clip, "effect": "brightness_contrast", "param": "brightness", "value": 60})).unwrap();
    let seq = s.execute("sequence.inspect", json!({})).unwrap();
    let item = seq["video"][0]["items"].as_array().unwrap().iter().find(|i| i["clip"] == clip).unwrap();
    let effects = item["effects"].as_array().unwrap();
    let bc = effects.iter().find(|e| e["effect"] == "brightness_contrast").unwrap();
    assert_eq!(bc["params"]["brightness"], json!({"kind": "float", "value": 60.0, "keyframes": 0, "animated": false}));
    let motion = effects.iter().find(|e| e["effect"] == "motion").unwrap();
    assert_eq!(motion["params"]["scale"]["kind"], "float");
    assert_eq!(motion["params"]["scale"]["value"], 100.0);
    let pos = &motion["params"]["position"];
    assert_eq!(pos["kind"], "point");
    assert!(pos["value"].as_array().is_some_and(|a| a.len() == 2 && a.iter().all(|c| c.is_number() || c.is_null())), "{pos}");
    let opacity = effects.iter().find(|e| e["effect"] == "opacity").unwrap();
    assert_eq!(opacity["params"]["opacity"]["kind"], "float");
    // the plain values go straight back into effects.setParam
    let x = pos["value"][0].as_f64().unwrap_or(10.0) + 10.0;
    s.execute("effects.setParam", json!({"clip": clip, "effect": "motion", "param": "position", "value": [x, 20.0]})).unwrap();
    let seq = s.execute("sequence.inspect", json!({})).unwrap();
    let item = seq["video"][0]["items"].as_array().unwrap().iter().find(|i| i["clip"] == clip).unwrap();
    let motion = item["effects"].as_array().unwrap().iter().find(|e| e["effect"] == "motion").unwrap();
    assert_eq!(motion["params"]["position"]["value"], json!([x, 20.0]));
}

#[test]
fn a_reversed_clip_reads_its_last_source_frame_first_even_with_nearest_sample_lookup() {
    use filmcraft_project::TrackItem;
    let mut s = demo();
    let q = s.active_sequence().unwrap();
    let v = q.video_tracks[0].items[0].id.0;
    s.execute("sequence.linkedSelection", json!({"on": false})).unwrap();
    s.execute("clip.speedDuration", json!({"clips": [v], "speed": 100, "reverse": true})).unwrap();
    let q = s.active_sequence().unwrap();
    let it: &TrackItem = q.find_item(ClipId(v)).unwrap().1;
    assert!(it.reverse);
    let rate = q.settings.frame_rate;
    let last = it.end() - rate.frame_duration();
    let frame_time = filmcraft_render::frame_time;
    // the exact mapping (audio, effects) names the last tick of the last source frame
    assert_eq!(it.source_time_at(it.start), it.source_out() - Tick(1));
    let first = frame_time(it, it.start);
    // the decode time lies inside the last source frame (a floor lookup, as generators do, finds
    // it) and is not the boundary itself
    assert!(it.source_out() - rate.frame_duration() < first && first < it.source_out(), "{first:?} vs {:?}", it.source_out());
    // nearest lookup in a millisecond timescale (MP4): still before the boundary, not on it
    assert!(first.to_rational_round(1, 1000) < it.source_out().to_rational_round(1, 1000));
    // the last timeline frame shows the first source frame
    let end = frame_time(it, last);
    assert!(it.source_in <= end && end < it.source_in + rate.frame_duration(), "{end:?} vs {:?}", it.source_in);
    // the decode time never leaves the clip's source range, whatever the speed
    s.execute("clip.speedDuration", json!({"clips": [v], "speed": 250, "reverse": true})).unwrap();
    let q = s.active_sequence().unwrap();
    let it = q.find_item(ClipId(v)).unwrap().1;
    let mut t = it.start;
    while t < it.end() {
        let m = frame_time(it, t);
        assert!(m >= it.source_in && m < it.source_out(), "{t:?}: {m:?} outside {:?}..{:?}", it.source_in, it.source_out());
        t += rate.frame_duration();
    }
    // forward clips are untouched
    s.execute("clip.speedDuration", json!({"clips": [v], "speed": 100, "reverse": false})).unwrap();
    let q = s.active_sequence().unwrap();
    let it = q.find_item(ClipId(v)).unwrap().1;
    assert_eq!(frame_time(it, it.start + rate.tick_of(3)), it.source_time_at(it.start + rate.tick_of(3)));
}

#[test]
fn importing_a_truncated_mp4_warns_instead_of_showing_black_frames_later() {
    let dir = filmcraft_testkit::workspace_root().join("target").join("export-tests").join(format!("engine-sh-truncated-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let whole = dir.join("whole.mp4").to_string_lossy().to_string();
    let mut s = demo();
    s.execute(
        "file.exportMedia",
        json!({"preset": "Match Source – Adaptive Low Bitrate", "path": whole, "range": "custom", "startSeconds": 0, "endSeconds": 0.2, "wait": true}),
    )
    .unwrap();
    let bytes = std::fs::read(&whole).unwrap();
    // keep the top-level boxes except the sample data: an index whose offsets point past the end
    let mut kept = Vec::new();
    let mut at = 0usize;
    while at + 8 <= bytes.len() {
        let size = u32::from_be_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]) as usize;
        let kind = &bytes[at + 4..at + 8];
        let size = if size == 0 { bytes.len() - at } else { size.max(8) };
        let end = (at + size).min(bytes.len());
        if kind != b"mdat" {
            kept.extend_from_slice(&bytes[at..end]);
        }
        at = end;
    }
    assert!(kept.len() < bytes.len(), "the export had sample data");
    let cut = dir.join("cut.mp4").to_string_lossy().to_string();
    std::fs::write(&cut, &kept).unwrap();
    s.events.clear();
    let r = s.execute("file.import", json!({"paths": [cut]})).unwrap();
    assert_eq!(r["items"].as_array().map(Vec::len), Some(1), "{r}");
    let warnings = r["warnings"].as_array().cloned().unwrap_or_default();
    assert!(warnings.iter().any(|w| w.as_str().is_some_and(|w| w.contains("truncated"))), "{r}");
    assert!(s.events.iter().any(|e| matches!(e, Event::Toast { message, error: false } if message.contains("truncated"))));
    // the whole file imports without a word
    s.events.clear();
    let r = s.execute("file.import", json!({"paths": [whole]})).unwrap();
    assert_eq!(r["warnings"].as_array().map(Vec::len), Some(0), "{r}");
    assert!(!s.events.iter().any(|e| matches!(e, Event::Toast { .. })));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn effects_keyframes_lists_each_parameters_keyframes_with_sequence_times() {
    let mut s = demo();
    let q = s.active_sequence().unwrap();
    let it = q.video_tracks[0].items[1].clone();
    let clip = it.id.0;
    let rate = q.settings.frame_rate;
    let t0 = it.start + rate.tick_of(10);
    let t1 = it.start + rate.tick_of(40);
    s.execute("playhead.set", json!({"time": t0.0})).unwrap();
    s.execute("effects.toggleAnimation", json!({"clip": clip, "effect": "motion", "param": "scale"})).unwrap();
    s.execute("effects.setParam", json!({"clip": clip, "effect": "motion", "param": "scale", "value": 50})).unwrap();
    s.execute("playhead.set", json!({"time": t1.0})).unwrap();
    s.execute("effects.setParam", json!({"clip": clip, "effect": "motion", "param": "scale", "value": 150})).unwrap();
    let r = s.execute("effects.keyframes", json!({"clip": clip, "effect": "motion", "param": "scale"})).unwrap();
    assert_eq!(r["effect"], "motion");
    assert_eq!(r["params"].as_object().map(|m| m.len()), Some(1));
    let scale = &r["params"]["scale"];
    assert_eq!(scale["kind"], "float");
    assert_eq!(scale["animated"], true);
    assert_eq!(scale["value"], 150.0, "value at the playhead");
    let ks = scale["keyframes"].as_array().unwrap();
    assert_eq!(ks.len(), 2);
    assert_eq!((ks[0]["time"].as_i64(), ks[0]["value"].as_f64(), ks[0]["interpolation"].as_str()), (Some(t0.0), Some(50.0), Some("linear")));
    assert_eq!((ks[1]["time"].as_i64(), ks[1]["value"].as_f64()), (Some(t1.0), Some(150.0)));
    assert!(ks[0]["mediaTime"].as_i64().is_some_and(|m| m >= it.source_in.0));
    // halfway between the keyframes the value interpolates, and inspect says so too
    let mid = it.start + rate.tick_of(25);
    s.execute("playhead.set", json!({"time": mid.0})).unwrap();
    let r = s.execute("effects.keyframes", json!({"clip": clip, "effect": "motion"})).unwrap();
    assert!(r["params"].as_object().is_some_and(|m| m.len() > 1), "every parameter without `param`");
    let v = r["params"]["scale"]["value"].as_f64().unwrap();
    assert!((v - 100.0).abs() < 1.0, "{v}");
    assert_eq!(r["params"]["position"]["animated"], false);
    assert_eq!(r["params"]["position"]["keyframes"].as_array().map(Vec::len), Some(0));
    let seq = s.execute("sequence.inspect", json!({})).unwrap();
    let item = seq["video"][0]["items"].as_array().unwrap().iter().find(|i| i["clip"] == clip).unwrap();
    let motion = item["effects"].as_array().unwrap().iter().find(|e| e["effect"] == "motion").unwrap();
    assert_eq!(motion["params"]["scale"]["animated"], true);
    assert_eq!(motion["params"]["scale"]["keyframes"], 2);
    assert!((motion["params"]["scale"]["value"].as_f64().unwrap() - 100.0).abs() < 1.0);
    assert_eq!(motion["params"]["position"]["animated"], false);
    // easeInOut: both handles flat, so the midpoint is still 100 but the quarter point lags linear
    s.execute(
        "effects.setInterpolation",
        json!({"clip": clip, "effect": "motion", "param": "scale", "mediaTime": ks[0]["mediaTime"], "interpolation": "easeInOut"}),
    )
    .unwrap();
    s.execute(
        "effects.setInterpolation",
        json!({"clip": clip, "effect": "motion", "param": "scale", "mediaTime": ks[1]["mediaTime"], "interpolation": "easeInOut"}),
    )
    .unwrap();
    let r = s.execute("effects.keyframes", json!({"clip": clip, "effect": "motion", "param": "scale"})).unwrap();
    assert_eq!(r["params"]["scale"]["keyframes"][0]["interpolation"], "easeInOut");
    s.execute("playhead.set", json!({"time": (it.start + rate.tick_of(17)).0})).unwrap();
    let eased =
        s.execute("effects.keyframes", json!({"clip": clip, "effect": "motion", "param": "scale"})).unwrap()["params"]["scale"]["value"].as_f64().unwrap();
    let linear = 50.0 + 100.0 * (7.0 / 30.0);
    assert!(eased < linear - 2.0, "eased {eased} vs linear {linear}");
    // errors
    assert!(s.execute("effects.keyframes", json!({"clip": clip, "effect": "nope"})).is_err());
    assert!(s.execute("effects.keyframes", json!({"clip": clip, "effect": "motion", "param": "nope"})).is_err());
    assert!(s.execute("effects.keyframes", json!({"clip": 999_999})).is_err());
    assert!(s.history.undo.iter().all(|u| u.0 != "List Keyframes"), "a query is not an edit");
}

#[test]
fn timeline_time_of_inverts_the_source_mapping_forward_and_reversed() {
    let mut s = demo();
    s.execute("sequence.linkedSelection", json!({"on": false})).unwrap();
    let v = s.active_sequence().unwrap().video_tracks[0].items[0].id.0;
    for (speed, reverse) in [(100, false), (200, false), (50, true), (100, true)] {
        s.execute("clip.speedDuration", json!({"clips": [v], "speed": speed, "reverse": reverse})).unwrap();
        let q = s.active_sequence().unwrap();
        let it = q.find_item(ClipId(v)).unwrap().1;
        let rate = q.settings.frame_rate;
        let mut t = it.start;
        while t < it.end() {
            let back = crate::sh_commands::timeline_time_of(it, it.source_time_at(t));
            assert!((back - t).0.abs() <= rate.frame_duration().0 / 2, "speed {speed} reverse {reverse}: {t:?} -> {back:?}");
            t += rate.tick_of(7);
        }
        s.undo();
    }
}

/// A 30 fps sequence with the Aurora demo footage (video + linked audio) on V1/A1 at 0.
fn demo_footage() -> (Session, u64, u64) {
    let mut s = Session::default();
    s.execute("file.newProject", json!({"name": "t"})).unwrap();
    s.execute("file.newSequence", json!({"name": "seq", "width": 320, "height": 180, "fps": 30})).unwrap();
    let item = s.execute("file.importDemoFootage", json!({"scene": "Aurora"})).unwrap()["items"][0].as_u64().unwrap();
    s.execute("timeline.place", json!({"item": item, "track": "V1", "time": 0, "insert": true})).unwrap();
    let q = s.execute("sequence.inspect", json!({})).unwrap();
    (s, q["video"][0]["items"][0]["clip"].as_u64().unwrap(), q["audio"][0]["items"][0]["clip"].as_u64().unwrap())
}

fn maintain_pitch_of(s: &Session, clip: u64) -> bool {
    s.active_sequence().unwrap().find_item(ClipId(clip)).unwrap().1.maintain_pitch
}

#[test]
fn set_maintain_pitch_flags_the_clip_and_its_partner_and_inspect_shows_it() {
    let (mut s, video, audio) = demo_footage();
    assert!(!maintain_pitch_of(&s, video) && !maintain_pitch_of(&s, audio));
    let q = s.execute("sequence.inspect", json!({})).unwrap();
    assert_eq!(q["audio"][0]["items"][0]["maintainPitch"], json!(false));
    let r = s.execute("clip.setMaintainPitch", json!({"clips": [video], "enabled": true})).unwrap();
    assert_eq!(r["enabled"], json!(true));
    let mut got: Vec<u64> = r["clips"].as_array().unwrap().iter().map(|v| v.as_u64().unwrap()).collect();
    got.sort_unstable();
    let mut want = vec![video, audio];
    want.sort_unstable();
    assert_eq!(got, want, "the linked sound takes the flag too");
    assert!(maintain_pitch_of(&s, video) && maintain_pitch_of(&s, audio));
    let q = s.execute("sequence.inspect", json!({})).unwrap();
    assert_eq!(q["audio"][0]["items"][0]["maintainPitch"], json!(true));
    assert_eq!(q["video"][0]["items"][0]["maintainPitch"], json!(true));
    assert_eq!(s.undo().as_deref(), Some("Maintain Audio Pitch"));
    assert!(!maintain_pitch_of(&s, audio));
    // linked: false touches only the given clip
    s.execute("clip.setMaintainPitch", json!({"clips": [audio], "enabled": true, "linked": false})).unwrap();
    assert!(maintain_pitch_of(&s, audio) && !maintain_pitch_of(&s, video));
    assert_eq!(s.undo().as_deref(), Some("Maintain Audio Pitch"));
    // input checks
    assert!(s.execute("clip.setMaintainPitch", json!({"clips": [audio]})).is_err(), "needs `enabled`");
    assert!(s.execute("clip.setMaintainPitch", json!({"clips": [audio], "enabled": "yes"})).is_err(), "`enabled` must be a bool");
    assert!(s.execute("clip.setMaintainPitch", json!({"clips": [audio], "enabled": true, "linked": 1})).is_err(), "`linked` must be a bool");
    assert!(s.execute("clip.setMaintainPitch", json!({"clips": [], "enabled": true})).is_err(), "needs clips");
    assert!(s.execute("clip.setMaintainPitch", json!({"clips": [999], "enabled": true})).is_err(), "unknown clip");
    assert!(!maintain_pitch_of(&s, audio) && !maintain_pitch_of(&s, video), "nothing changed on errors");
    // the flag survives a save/load round trip and is absent when off (old files load as off)
    s.execute("clip.setMaintainPitch", json!({"clips": [video], "enabled": true})).unwrap();
    let text = s.project.to_json();
    assert!(text.contains("\"maintain_pitch\": true"));
    let back = filmcraft_project::Project::from_json(&text).unwrap();
    assert!(back.sequence(s.state.active_sequence.unwrap()).unwrap().find_item(ClipId(audio)).unwrap().1.maintain_pitch);
    s.execute("clip.setMaintainPitch", json!({"clips": [video], "enabled": false})).unwrap();
    assert!(!s.project.to_json().contains("maintain_pitch"));
}

#[test]
fn speed_duration_takes_maintain_pitch_and_keeps_it_when_absent() {
    let (mut s, video, audio) = demo_footage();
    s.execute("clip.speedDuration", json!({"clips": [video], "speed": 200, "maintainPitch": true})).unwrap();
    assert!(maintain_pitch_of(&s, video) && maintain_pitch_of(&s, audio));
    let q = s.execute("sequence.inspect", json!({})).unwrap();
    assert_eq!(q["audio"][0]["items"][0]["speed"], json!(2.0));
    assert_eq!(q["audio"][0]["items"][0]["maintainPitch"], json!(true));
    s.execute("clip.speedDuration", json!({"clips": [video], "speed": 50})).unwrap();
    assert!(maintain_pitch_of(&s, audio), "absent keeps the setting");
    s.execute("clip.speedDuration", json!({"clips": [video], "speed": 50, "maintainPitch": false})).unwrap();
    assert!(!maintain_pitch_of(&s, audio));
    assert!(s.execute("clip.speedDuration", json!({"clips": [video], "speed": 50, "maintainPitch": "on"})).is_err());
    assert_eq!(s.undo().as_deref(), Some("Speed/Duration"));
    assert!(maintain_pitch_of(&s, audio), "undo restores the flag");
}

#[test]
fn a_transition_longer_than_its_clips_is_clamped_to_fit_and_reported() {
    let (mut s, red, blue) = mattes();
    // two 4 s clips: a centred transition can take at most 4 s on each side (8 s = 240 frames)
    let r = s.execute("sequence.applyVideoTransition", json!({"clip": red, "edge": "out", "frames": 600})).unwrap();
    assert_eq!(r["frames"], 240);
    assert_eq!(r["clamped"], true);
    // colour mattes are generated: they never run out of media
    assert_eq!(r["repeatFrames"], json!({"from": 0, "to": 0}));
    assert!(r["warning"].is_null());
    let id = r["transition"].as_u64().unwrap();
    let tr = &transitions(&s)[0];
    assert_eq!((frames(&s, tr.start), frames(&s, tr.duration)), (0, 240));
    // in-range lengths are kept as asked
    let r = s.execute("sequence.setTransitionLength", json!({"transition": id, "frames": 30})).unwrap();
    assert_eq!((r["frames"].as_i64(), r["clamped"].as_bool()), (Some(30), Some(false)));
    // start alignment: the whole transition sits on the incoming 4 s clip
    let r = s.execute("sequence.setTransitionLength", json!({"transition": id, "frames": 500, "align": "start"})).unwrap();
    assert_eq!((r["frames"].as_i64(), r["clamped"].as_bool(), r["align"].as_str()), (Some(120), Some(true), Some("start")));
    // a fade out at the end of the last clip is limited by that clip alone
    let r = s.execute("sequence.applyVideoTransition", json!({"clip": blue, "edge": "out", "frames": 999})).unwrap();
    assert_eq!((r["frames"].as_i64(), r["clamped"].as_bool()), (Some(120), Some(true)));
}

#[test]
fn transition_params_inspect_as_plain_values_and_round_trip() {
    let (mut s, red, _blue) = mattes();
    let id = s
        .execute(
            "sequence.applyVideoTransition",
            json!({"clip": red, "edge": "out", "effect": "push", "frames": 20, "params": {"direction": "From East", "motion_blur": 10}}),
        )
        .unwrap()["transition"]
        .as_u64()
        .unwrap();
    let seq = s.execute("sequence.inspect", json!({})).unwrap();
    let params = seq["video"][0]["transitions"][0]["params"].clone();
    assert_eq!(params, json!({"direction": 1, "motion_blur": 10.0}));
    // what inspect gives is what setTransition takes: sending it back changes nothing
    let before = transitions(&s)[0].clone();
    s.execute("sequence.setTransition", json!({"transition": id, "params": params})).unwrap();
    assert_eq!(transitions(&s)[0].effect, before.effect);
    // an unset point ([null, null], the default centre) is accepted and left unset
    let iris = s.execute("sequence.applyVideoTransition", json!({"clip": red, "edge": "out", "effect": "iris_round", "frames": 20})).unwrap()["transition"]
        .as_u64()
        .unwrap();
    let seq = s.execute("sequence.inspect", json!({})).unwrap();
    let p = seq["video"][0]["transitions"][0]["params"].clone();
    s.execute("sequence.setTransition", json!({"transition": iris, "params": p})).unwrap();
}

#[test]
fn transitions_already_in_a_project_keep_their_length() {
    // a project saved before the clamp may hold a transition longer than its clips: other edits leave it alone
    let (mut s, red, blue) = mattes();
    let id = s.execute("sequence.applyVideoTransition", json!({"clip": red, "edge": "out", "frames": 30})).unwrap()["transition"].as_u64().unwrap();
    let long = s.sequence_rate().tick_of(400);
    s.edit_sequence("old project", |q, _, _| {
        let tr = q.video_tracks[0].transitions.iter_mut().find(|x| x.id.0 == id).unwrap();
        tr.duration = long;
        Ok(())
    })
    .unwrap();
    s.execute("sequence.setTransition", json!({"transition": id, "reverse": true})).unwrap();
    let tr = transitions(&s).into_iter().find(|x| x.id.0 == id).unwrap();
    assert_eq!((tr.duration, tr.reverse, tr.from.map(|c| c.0), tr.to.map(|c| c.0)), (long, true, Some(red), Some(blue)));
}
