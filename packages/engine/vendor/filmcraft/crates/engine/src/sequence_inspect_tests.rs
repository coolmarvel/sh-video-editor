//! `sequence.inspect` is how an agent checks its edits: it has to show where a clip ends in the
//! sequence and in its media, the clip's audio gain, whether it plays backward and what a marker says.

use serde_json::json;

use crate::Session;

#[test]
fn sequence_inspect_reports_clip_ends_gain_and_marker_comments() {
    let mut s = Session::default();
    s.execute("file.openDemoProject", json!({})).unwrap();
    let rate = s.sequence_rate();
    // a clip at 200 %, a clip with gain and a marker with a comment, all made through commands
    s.execute("sequence.linkedSelection", json!({"on": false})).unwrap();
    let (fast, loud) = {
        let q = s.active_sequence().unwrap();
        (q.video_tracks[0].items.last().unwrap().id, q.audio_tracks[0].items[0].id)
    };
    s.execute("timeline.select", json!({"clips": [fast.0]})).unwrap();
    s.execute("clip.speedDuration", json!({"speed": 200})).unwrap();
    s.execute("timeline.select", json!({"clips": [loud.0]})).unwrap();
    s.execute("clip.audioGain", json!({"mode": "set", "db": -6.5})).unwrap();
    let marker = s.execute("markers.add", json!({"time": rate.tick_of(12).0, "name": "Beat", "comment": "cut on the downbeat"})).unwrap()["marker"].clone();

    let q = s.active_sequence().unwrap().clone();
    let js = s.execute("sequence.inspect", json!({})).unwrap();
    let m = js["markers"].as_array().unwrap().iter().find(|m| m["id"] == marker).unwrap();
    assert_eq!((m["name"].as_str(), m["comment"].as_str()), (Some("Beat"), Some("cut on the downbeat")));
    let mut seen = 0;
    for (key, tracks) in [("video", &q.video_tracks), ("audio", &q.audio_tracks)] {
        for (ti, t) in tracks.iter().enumerate() {
            for (ci, c) in t.items.iter().enumerate() {
                let j = &js[key][ti]["items"][ci];
                assert_eq!(j["clip"], c.id.0);
                assert_eq!(j["end"], c.end().0, "{j}");
                assert_eq!(j["end"].as_i64(), j["start"].as_i64().zip(j["duration"].as_i64()).map(|(a, b)| a + b));
                assert_eq!(j["endFrame"], rate.frame_at(c.end()));
                assert_eq!(j["sourceOut"], c.source_out().0, "{j}");
                assert_eq!(j["gainDb"], c.gain_db);
                // the keys that were there before stay
                for old in ["item", "name", "start", "duration", "startFrame", "durationFrames", "sourceIn", "speed", "enabled", "link", "label", "effects"] {
                    assert!(j.get(old).is_some(), "{old} is still reported");
                }
                if c.id == fast {
                    assert_eq!(j["speed"], 2.0);
                    assert_eq!(
                        j["sourceOut"].as_i64().unwrap() - j["sourceIn"].as_i64().unwrap(),
                        2 * j["duration"].as_i64().unwrap(),
                        "at 200% a clip uses twice its length of media"
                    );
                    seen += 1;
                }
                if c.id == loud {
                    assert_eq!(j["gainDb"], -6.5);
                    seen += 1;
                }
            }
        }
    }
    assert_eq!(seen, 2, "both edited clips were found in the readback");
}

/// A clip set to play backward read back exactly like a forward one: same `speed`, same source
/// range, and nothing that said it was reversed.
#[test]
fn sequence_inspect_reports_a_reversed_clip() {
    let mut s = Session::default();
    s.execute("file.openDemoProject", json!({})).unwrap();
    let backward = s.active_sequence().unwrap().video_tracks[0].items[1].id;
    let all = |js: &serde_json::Value| -> Vec<(u64, bool)> {
        ["video", "audio"]
            .iter()
            .flat_map(|k| js[*k].as_array().unwrap().iter())
            .flat_map(|t| t["items"].as_array().unwrap().iter())
            .map(|i| (i["clip"].as_u64().unwrap(), i["reverse"].as_bool().expect("every clip reports `reverse`")))
            .collect()
    };
    let js = s.execute("sequence.inspect", json!({})).unwrap();
    assert!(all(&js).iter().all(|(_, reversed)| !reversed), "nothing plays backward yet");
    s.execute("sequence.linkedSelection", json!({"on": false})).unwrap();
    s.execute("timeline.select", json!({"clips": [backward.0]})).unwrap();
    s.execute("clip.speedDuration", json!({"speed": 100, "reverse": true})).unwrap();
    let js = s.execute("sequence.inspect", json!({})).unwrap();
    let reversed: Vec<u64> = all(&js).into_iter().filter(|(_, r)| *r).map(|(c, _)| c).collect();
    assert_eq!(reversed, vec![backward.0], "only the reversed clip says so");
    s.execute("edit.undo", json!({})).unwrap();
    let js = s.execute("sequence.inspect", json!({})).unwrap();
    assert!(all(&js).iter().all(|(_, reversed)| !reversed));
}

/// sh-video-editor: `effects: "summary"` drops the static parameters of intrinsic effects on clips
/// that are not selected, and nothing else: every clip, effect entry, animated parameter, selected
/// clip and non-intrinsic effect reads the same as in the full shape.
#[test]
fn sequence_inspect_summary_keeps_what_the_editor_reads() {
    let mut s = Session::default();
    s.execute("file.openDemoProject", json!({})).unwrap();
    let (a, b) = {
        let q = s.active_sequence().unwrap();
        (q.video_tracks[0].items[0].id, q.video_tracks[0].items[1].id)
    };
    // b: an animated opacity and a non-intrinsic effect; a: selected
    s.execute("effects.addKeyframe", json!({"clip": b.0, "effect": "opacity", "param": "opacity", "time": 0})).unwrap();
    s.execute("effects.apply", json!({"clips": [b.0], "effect": "gaussian_blur"})).unwrap();
    s.execute("timeline.select", json!({"clips": [a.0]})).unwrap();

    let full = s.execute("sequence.inspect", json!({})).unwrap();
    assert_eq!(full, s.execute("sequence.inspect", json!({"effects": "full"})).unwrap(), "default is the full shape");
    let brief = s.execute("sequence.inspect", json!({"effects": "summary"})).unwrap();
    assert!(serde_json::to_string(&brief).unwrap().len() < serde_json::to_string(&full).unwrap().len());

    let clip = |js: &serde_json::Value, id: crate::ClipId| -> serde_json::Value {
        ["video", "audio"]
            .iter()
            .flat_map(|k| js[*k].as_array().unwrap().iter())
            .flat_map(|t| t["items"].as_array().unwrap().iter())
            .find(|c| c["clip"] == id.0)
            .cloned()
            .unwrap()
    };
    // the selected clip is the same in both shapes
    assert_eq!(clip(&full, a), clip(&brief, a));
    // everything but the effects is the same for every clip, and the effect list keeps its order
    for (key, _) in [("video", 0), ("audio", 0)] {
        for (ft, bt) in full[key].as_array().unwrap().iter().zip(brief[key].as_array().unwrap()) {
            assert_eq!(ft["transitions"], bt["transitions"]);
            for (fc, bc) in ft["items"].as_array().unwrap().iter().zip(bt["items"].as_array().unwrap()) {
                let (mut f2, mut b2) = (fc.clone(), bc.clone());
                f2["effects"] = json!(null);
                b2["effects"] = json!(null);
                assert_eq!(f2, b2);
                let names = |c: &serde_json::Value| c["effects"].as_array().unwrap().iter().map(|e| e["effect"].clone()).collect::<Vec<_>>();
                assert_eq!(names(fc), names(bc));
            }
        }
    }
    let (fb, bb) = (clip(&full, b), clip(&brief, b));
    let fx = |c: &serde_json::Value, id: &str| c["effects"].as_array().unwrap().iter().find(|e| e["effect"] == id).cloned().unwrap();
    // intrinsic, not selected: only the animated parameter, marked as a summary
    let op = fx(&bb, "opacity");
    assert_eq!(op["summary"], true);
    assert_eq!(op["params"].as_object().unwrap().keys().collect::<Vec<_>>(), vec!["opacity"]);
    assert_eq!(op["params"]["opacity"], fx(&fb, "opacity")["params"]["opacity"]);
    let motion = fx(&bb, "motion");
    assert_eq!(motion["summary"], true);
    assert!(motion["params"].as_object().unwrap().is_empty());
    // non-intrinsic: full
    assert_eq!(fx(&bb, "gaussian_blur"), fx(&fb, "gaussian_blur"));
    assert!(fx(&bb, "gaussian_blur").get("summary").is_none());

    let err = s.execute("sequence.inspect", json!({"effects": "some"})).unwrap_err().to_string();
    assert!(err.contains("full or summary"), "{err}");
}
