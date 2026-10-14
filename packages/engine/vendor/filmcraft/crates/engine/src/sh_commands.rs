//! Commands added by sh-video-editor on top of the upstream registry (see `VENDOR.md` and
//! `docs/guides/engine-commands.md` in the host repository): transition removal and resizing in
//! place, effect reordering and bypass, Maintain Audio Pitch on speed-changed clips, and grouped
//! undo (transactions).
//!
//! Transactions: `edit.beginTransaction {label}` marks the undo depth; every edit until
//! `edit.endTransaction` pushes its own snapshot as usual, and the end collapses them into one
//! undo step labelled `label` (the snapshot before the first edit). A nested begin only deepens
//! the open transaction (its label is ignored) and the matching end closes nothing; only the
//! outermost end collapses. `edit.cancelTransaction` restores the project from before the first
//! edit and closes the transaction whatever its depth. Undo and redo are refused while a
//! transaction is open. `edit.transaction {label, commands}` runs a list in one transaction and
//! cancels it when any command fails (its error is returned).

use filmcraft_edit as edit;
use filmcraft_project::{ClipId, Interpolation, TrackItem, TransitionAlign, TransitionId};
use filmcraft_time::Tick;
use serde_json::{Value, json};

use crate::commands::{CommandSpec, always, bad, bool_p, clip_p, clips_p, has_seq, param_to_json, str_p, u64_p};
use crate::{EngineError, Result, Session, Transaction};

type Run = fn(&mut Session, &Value) -> Result<Value>;
type Enabled = fn(&Session) -> std::result::Result<(), String>;

fn spec(id: &'static str, label: &'static str, menu: &'static [&'static str], params: &'static str, enabled: Enabled, run: Run) -> CommandSpec {
    CommandSpec { id, label, menu, shortcut: None, params, enabled, run, journal: true }
}
fn query(id: &'static str, label: &'static str, params: &'static str, run: Run) -> CommandSpec {
    CommandSpec { id, label, menu: &[], shortcut: None, params, enabled: always, run, journal: false }
}

pub(crate) fn commands() -> Vec<CommandSpec> {
    vec![
        spec("sequence.removeTransition", "Remove Transition", &[], r#"{"transition":id}"#, has_seq, remove_transition),
        spec(
            "sequence.setTransitionLength",
            "Set Transition Length",
            &[],
            r#"{"transition":id,"frames":i64,"align":"center"|"start"|"end"?}"#,
            has_seq,
            set_transition_length,
        ),
        spec("effects.move", "Move Effect", &[], r#"{"clip":id,"from":n,"to":n}"#, has_seq, move_effect),
        spec("effects.bypass", "Bypass Effects", &[], r#"{"clips":[id]?,"enabled":bool}"#, has_seq, bypass_effects),
        query("effects.keyframes", "List Keyframes", r#"{"clip":id,"effect":str|index="motion","param":str?}"#, list_keyframes),
        spec("clip.setMaintainPitch", "Maintain Audio Pitch", &[], r#"{"clips":[id]?,"enabled":bool,"linked":bool=true}"#, has_seq, set_maintain_pitch),
        spec("edit.beginTransaction", "Begin Transaction", &[], r#"{"label":str}"#, always, begin_transaction),
        spec("edit.endTransaction", "End Transaction", &[], "{}", always, end_transaction),
        spec("edit.cancelTransaction", "Cancel Transaction", &[], "{}", always, cancel_transaction),
        spec("edit.transaction", "Transaction", &[], r#"{"label":str,"commands":[{"id":str,"params":{}}]}"#, always, run_transaction),
    ]
}

fn transition_p(p: &Value, cmd: &str) -> Result<TransitionId> {
    u64_p(p, "transition").map(TransitionId).ok_or_else(|| bad(cmd, "need `transition`"))
}

/// `sequence.removeTransition`: drop a transition or an audio fade (one undo step).
fn remove_transition(s: &mut Session, p: &Value) -> Result<Value> {
    const CMD: &str = "sequence.removeTransition";
    let id = transition_p(p, CMD)?;
    let track = s.edit_sequence("Remove Transition", |q, _, _| Ok(edit::remove_transition(q, id)?))?;
    Ok(json!({"transition": id.0, "track": track.0}))
}

/// `sequence.setTransitionLength`: a new duration (frames, at least 1) and alignment on the cut,
/// keeping the transition's id, effect, parameters and direction.
fn set_transition_length(s: &mut Session, p: &Value) -> Result<Value> {
    const CMD: &str = "sequence.setTransitionLength";
    let id = transition_p(p, CMD)?;
    let frames = p.get("frames").and_then(Value::as_i64).ok_or_else(|| bad(CMD, "need `frames`"))?;
    if frames <= 0 {
        return Err(bad(CMD, format!("`frames` must be at least 1, got {frames}")));
    }
    let align = match str_p(p, "align") {
        None => None,
        Some("center") => Some(TransitionAlign::CenterAtCut),
        Some("start") => Some(TransitionAlign::StartAtCut),
        Some("end") => Some(TransitionAlign::EndAtCut),
        Some(other) => return Err(bad(CMD, format!("`align` must be center, start or end, got `{other}`"))),
    };
    let dur = s.sequence_rate().tick_of(frames);
    s.edit_sequence("Set Transition Length", |q, ctx, _| Ok(edit::set_transition_span(q, id, dur, align, ctx)?))?;
    let q = s.active_sequence().ok_or(EngineError::NoSequence)?;
    let tr = q.all_tracks().flat_map(|t| t.transitions.iter()).find(|x| x.id == id).ok_or_else(|| bad(CMD, format!("no transition {}", id.0)))?;
    let align = match tr.align {
        TransitionAlign::CenterAtCut => "center",
        TransitionAlign::StartAtCut => "start",
        TransitionAlign::EndAtCut => "end",
    };
    Ok(json!({"transition": id.0, "start": tr.start.0, "duration": tr.duration.0, "align": align}))
}

fn intrinsic(e: &filmcraft_project::EffectInstance) -> bool {
    e.def().is_some_and(|d| d.intrinsic)
}

/// `effects.move`: reorder a clip's effects (`from` index to `to` index, as `sequence.inspect`
/// lists them). Intrinsic effects stay at the end and cannot be moved or passed.
fn move_effect(s: &mut Session, p: &Value) -> Result<Value> {
    const CMD: &str = "effects.move";
    let c = clip_p(p, "clip").ok_or_else(|| bad(CMD, "need `clip`"))?;
    // (not `u64_p`: a negative or fractional index must not round to a valid one)
    let index = |k: &str| -> Result<usize> {
        let v = p.get(k).and_then(Value::as_u64).ok_or_else(|| bad(CMD, format!("`{k}` must be an index (unsigned integer)")))?;
        usize::try_from(v).map_err(|_| bad(CMD, format!("`{k}` is out of range")))
    };
    let (from, to) = (index("from")?, index("to")?);
    s.edit_sequence("Move Effect", |q, _, _| {
        let (_, it) = q.find_item_mut(c).ok_or(edit::EditError::NoItem(c))?;
        let standard = it.effects.iter().position(intrinsic).unwrap_or(it.effects.len());
        if from >= standard || to >= standard {
            return Err(bad(CMD, format!("`from` and `to` must index the clip's {standard} standard effects (intrinsic ones stay last)")));
        }
        if from != to {
            let e = it.effects.remove(from);
            it.effects.insert(to, e);
        }
        Ok(())
    })?;
    Ok(json!({"clip": c.0, "from": from, "to": to}))
}

/// `effects.bypass`: turn every standard effect of the clips on (`enabled: true`) or off at once
/// (view the original). Intrinsic effects and graphic layers are left alone.
fn bypass_effects(s: &mut Session, p: &Value) -> Result<Value> {
    const CMD: &str = "effects.bypass";
    let enabled = bool_p(p, "enabled").ok_or_else(|| bad(CMD, "need `enabled`"))?;
    let clips: Vec<ClipId> = clips_p(s, p);
    if clips.is_empty() {
        return Err(bad(CMD, "select clips first"));
    }
    let n = s.edit_sequence(if enabled { "Enable Effects" } else { "Bypass Effects" }, |q, _, _| {
        let mut n = 0usize;
        for c in &clips {
            let (_, it) = q.find_item_mut(*c).ok_or(edit::EditError::NoItem(*c))?;
            for e in it.effects.iter_mut().filter(|e| !intrinsic(e) && !filmcraft_project::graphic::is_layer(e)) {
                if e.enabled != enabled {
                    e.enabled = enabled;
                    n += 1;
                }
            }
        }
        Ok(n)
    })?;
    Ok(json!({"clips": clips.iter().map(|c| c.0).collect::<Vec<_>>(), "enabled": enabled, "effects": n}))
}

/// `clip.setMaintainPitch`: Speed/Duration's Maintain Audio Pitch on the clips (and, by default,
/// their linked partners: the flag lives on every member so the sound follows whichever clip is
/// selected). A clip with it on plays its sound time-stretched (WSOLA) instead of resampled when
/// its speed is not 1; reversed clips keep resampling. `clip.speedDuration {maintainPitch}` sets
/// the same flag together with the speed.
fn set_maintain_pitch(s: &mut Session, p: &Value) -> Result<Value> {
    const CMD: &str = "clip.setMaintainPitch";
    let enabled = bool_p(p, "enabled").ok_or_else(|| bad(CMD, "need `enabled` (bool)"))?;
    let linked = match p.get("linked") {
        None | Some(Value::Null) => true,
        Some(v) => v.as_bool().ok_or_else(|| bad(CMD, "`linked` must be a bool"))?,
    };
    let given = clips_p(s, p);
    if given.is_empty() {
        return Err(bad(CMD, "select clips first"));
    }
    let clips: Vec<ClipId> = if linked { crate::commands::with_partners(s, &given) } else { given };
    s.edit_sequence(if enabled { "Maintain Audio Pitch" } else { "Resample Audio" }, |q, _, _| {
        for c in &clips {
            let (_, it) = q.find_item_mut(*c).ok_or(edit::EditError::NoItem(*c))?;
            it.maintain_pitch = enabled;
        }
        Ok(())
    })?;
    Ok(json!({"clips": clips.iter().map(|c| c.0).collect::<Vec<_>>(), "enabled": enabled}))
}

/// Name of an interpolation as `effects.setInterpolation` takes it.
fn interpolation_name(i: Interpolation) -> &'static str {
    match i {
        Interpolation::Linear => "linear",
        Interpolation::Hold => "hold",
        Interpolation::Bezier => "bezier",
        Interpolation::AutoBezier => "autoBezier",
        Interpolation::ContinuousBezier => "continuousBezier",
        Interpolation::EaseIn => "easeIn",
        Interpolation::EaseOut => "easeOut",
        Interpolation::EaseInOut => "easeInOut",
    }
}

/// Timeline time at which a clip shows media time `mt` (the inverse of
/// `TrackItem::moving_source_time_at`); a frame hold shows everything at its start.
pub(crate) fn timeline_time_of(it: &TrackItem, mt: Tick) -> Tick {
    if it.frame_hold.is_some() {
        return it.start;
    }
    let speed = it.speed.abs().max(1e-9);
    let span = Tick((it.duration.0 as f64 * speed).round() as i64);
    let scaled = if it.reverse { it.source_in + span - Tick(1) - mt } else { mt - it.source_in };
    it.start + Tick((scaled.0 as f64 / speed).round() as i64)
}

/// `effects.keyframes`: every keyframe of an effect's parameters (one parameter with `param`):
/// `{clip, effect, playhead, params: {name: {kind, animated, value, keyframes: [{mediaTime, time,
/// value, interpolation, inInfluence, outInfluence}]}}}`. `value` is the parameter's value at
/// the playhead; `time` is the sequence tick the keyframe's media time plays at.
fn list_keyframes(s: &mut Session, p: &Value) -> Result<Value> {
    const CMD: &str = "effects.keyframes";
    let c = clip_p(p, "clip").ok_or_else(|| bad(CMD, "need `clip`"))?;
    let eff = p.get("effect").cloned().unwrap_or(json!("motion"));
    let ph = s.playhead();
    let q = s.active_sequence().ok_or(EngineError::NoSequence)?;
    let (_, it) = q.find_item(c).ok_or_else(|| bad(CMD, format!("no clip {} in the active sequence", c.0)))?;
    let e = match &eff {
        Value::Number(n) => n.as_u64().and_then(|n| usize::try_from(n).ok()).and_then(|n| it.effects.get(n)),
        Value::String(sid) => it.effects.iter().find(|e| &e.effect == sid),
        _ => None,
    }
    .ok_or_else(|| bad(CMD, "no such effect"))?;
    let mt_now = it.effect_time_at(ph.clamp(it.start, (it.end() - Tick(1)).max(it.start)));
    let only = str_p(p, "param");
    if let Some(name) = only
        && !e.params.contains_key(name)
    {
        return Err(bad(CMD, format!("no param `{name}`")));
    }
    let mut params = serde_json::Map::new();
    for (name, prm) in e.params.iter().filter(|(n, _)| only.is_none_or(|o| o == n.as_str())) {
        let (kind, value) = param_to_json(&prm.value_at(mt_now));
        let keyframes: Vec<Value> = prm
            .keyframes
            .iter()
            .map(|k| {
                let (_, v) = param_to_json(&k.value);
                json!({
                    "mediaTime": k.time.0,
                    "time": timeline_time_of(it, k.time).0,
                    "value": v,
                    "interpolation": interpolation_name(k.interp),
                    "inInfluence": k.in_influence,
                    "outInfluence": k.out_influence,
                })
            })
            .collect();
        params.insert(name.clone(), json!({"kind": kind, "animated": prm.is_animated(), "value": value, "keyframes": keyframes}));
    }
    Ok(json!({"clip": c.0, "effect": e.effect, "playhead": ph.0, "mediaTime": mt_now.0, "params": params}))
}

fn begin_transaction(s: &mut Session, p: &Value) -> Result<Value> {
    let label = str_p(p, "label").map(str::trim).filter(|l| !l.is_empty()).unwrap_or("Edit").to_string();
    s.history.merge_key = None;
    let depth = match s.history.transaction.as_mut() {
        Some(t) => {
            t.depth = t.depth.saturating_add(1);
            t.depth
        }
        None => {
            s.history.transaction = Some(Transaction { label, mark: s.history.undo.len(), depth: 0 });
            0
        }
    };
    Ok(json!({"depth": depth}))
}

fn end_transaction(s: &mut Session, _: &Value) -> Result<Value> {
    const CMD: &str = "edit.endTransaction";
    let Some(t) = s.history.transaction.as_mut() else { return Err(bad(CMD, "no transaction is open")) };
    if t.depth > 0 {
        t.depth -= 1;
        return Ok(json!({"open": true, "depth": t.depth}));
    }
    let Some(t) = s.history.transaction.take() else { return Err(bad(CMD, "no transaction is open")) };
    let steps = s.history.undo.len().saturating_sub(t.mark);
    if steps > 0 {
        s.history.undo.truncate(t.mark.saturating_add(1));
        if let Some(first) = s.history.undo.get_mut(t.mark) {
            first.0 = t.label.clone();
        }
    }
    s.history.merge_key = None;
    Ok(json!({"open": false, "label": t.label, "steps": steps}))
}

fn cancel_transaction(s: &mut Session, _: &Value) -> Result<Value> {
    const CMD: &str = "edit.cancelTransaction";
    let Some(t) = s.history.transaction.take() else { return Err(bad(CMD, "no transaction is open")) };
    let steps = s.history.undo.len().saturating_sub(t.mark);
    if steps > 0 {
        s.history.undo.truncate(t.mark.saturating_add(1));
        if let Some((_, before)) = s.history.undo.pop() {
            s.project = before;
            s.fix_state();
            s.bump();
        }
    }
    s.history.merge_key = None;
    Ok(json!({"label": t.label, "rolledBack": steps}))
}

/// `edit.transaction`: run `commands` in order as one undo step; the first failure cancels the
/// transaction (nothing of it stays) and is returned.
fn run_transaction(s: &mut Session, p: &Value) -> Result<Value> {
    const CMD: &str = "edit.transaction";
    let list = p.get("commands").and_then(Value::as_array).ok_or_else(|| bad(CMD, "need `commands`"))?;
    if list.len() > 1000 {
        return Err(bad(CMD, "at most 1000 commands per transaction"));
    }
    let label = str_p(p, "label").unwrap_or("Edit").to_string();
    begin_transaction(s, &json!({"label": label}))?;
    let mut results = Vec::with_capacity(list.len());
    for (i, c) in list.iter().enumerate() {
        let id = c.get("id").and_then(Value::as_str).map(str::to_string);
        let params = c.get("params").cloned().unwrap_or_else(|| json!({}));
        const NESTED: [&str; 6] = ["edit.undo", "edit.redo", "edit.beginTransaction", "edit.endTransaction", "edit.cancelTransaction", "edit.transaction"];
        let r = match id {
            Some(id) if NESTED.contains(&id.as_str()) => Err(bad(CMD, format!("`{id}` cannot run inside a transaction"))),
            Some(id) => s.execute(&id, params),
            None => Err(bad(CMD, format!("command {i} has no `id`"))),
        };
        match r {
            Ok(v) => results.push(v),
            Err(e) => {
                cancel_transaction(s, &Value::Null)?;
                return Err(e);
            }
        }
    }
    let end = end_transaction(s, &Value::Null)?;
    Ok(json!({"label": label, "steps": end["steps"], "results": results}))
}
