//! Warp Stabilizer analysis as a background job (sh-video-editor).
//!
//! `effects.analyzeStabilizer {clip, smoothness?, wait=false}` analyses the clip's camera motion
//! for its Warp Stabilizer effect in a job: `jobs.list` shows the progress, `jobs.cancel` stops it
//! and the [`crate::Event::JobProgress`] events (`kind: "stabilizer"`) report it to frontends. The
//! finished analysis lands in the render cache a render-time analysis would fill
//! ([`filmcraft_render::vfx::stabilizer_path`]), so the next `renderFrame` stabilises at once.
//! While the job runs renders of the clip show the picture unchanged (no second analysis on the
//! render thread). If the clip has no Warp Stabilizer yet one is applied (one undo step "Warp
//! Stabilizer"); `smoothness` (0..1000 %) sets the effect's Smoothness in the same step. On the
//! web the job advances a few frames per `pump_jobs` call ([`crate::SteppedTask`]).

use std::sync::{Arc, Mutex};

use filmcraft_project::{ClipId, ItemId, ParamValue, TrackKind, TrackMethod};
use filmcraft_render::vfx::{StabilizerAnalysis, stabilizer_cached, stabilizer_key, stabilizer_pending, stabilizer_scale};
use filmcraft_time::Tick;
use serde_json::{Value, json};

use crate::commands::{CommandSpec, bad, bool_p, clip_p, f64_p, has_seq};
use crate::scene_detect::lock;
use crate::{EngineError, Result, Session};

const CMD: &str = "effects.analyzeStabilizer";
const EFFECT: &str = "warp_stabilizer";

pub(crate) fn commands() -> Vec<CommandSpec> {
    vec![CommandSpec {
        id: CMD,
        label: "Analyze Stabilization",
        menu: &[],
        shortcut: None,
        params: r#"{"clip":id,"smoothness":0..1000?,"wait":bool=false}"#,
        enabled: has_seq,
        run: analyze,
        journal: true,
    }]
}

fn analyze(s: &mut Session, p: &Value) -> Result<Value> {
    let clip = clip_p(p, "clip").ok_or_else(|| bad(CMD, "need `clip`"))?;
    let seq_id = s.state.active_sequence.ok_or(EngineError::NoSequence)?;
    let smoothness = f64_p(p, "smoothness").map(|v| v.clamp(0.0, 1000.0));
    let wait = bool_p(p, "wait").unwrap_or(false);
    {
        let q = s.active_sequence().ok_or(EngineError::NoSequence)?;
        let (tid, it) = q.find_item(clip).ok_or(filmcraft_edit::EditError::NoItem(clip))?;
        if q.track(tid).is_none_or(|t| t.kind != TrackKind::Video) {
            return Err(bad(CMD, "the clip is not on a video track"));
        }
        let has_effect = it.effects.iter().any(|e| e.effect == EFFECT);
        if !has_effect || smoothness.is_some() {
            let def = filmcraft_project::find_effect(EFFECT).ok_or_else(|| bad(CMD, "no Warp Stabilizer effect in this build"))?;
            s.edit_sequence("Warp Stabilizer", |q, _, _| {
                let (_, it) = q.find_item_mut(clip).ok_or(filmcraft_edit::EditError::NoItem(clip))?;
                if !it.effects.iter().any(|e| e.effect == EFFECT) {
                    let pos = it.effects.iter().position(|e| e.def().is_some_and(|d| d.intrinsic)).unwrap_or(it.effects.len());
                    it.effects.insert(pos, def.instance());
                }
                if let Some(v) = smoothness
                    && let Some(e) = it.effects.iter_mut().rev().find(|e| e.effect == EFFECT)
                {
                    match e.params.get_mut("smoothness") {
                        Some(prm) => prm.value = ParamValue::Float(v),
                        None => {
                            e.params.insert("smoothness".into(), filmcraft_project::Param::new(ParamValue::Float(v)));
                        }
                    }
                }
                Ok(())
            })?;
        }
    }
    let q = s.active_sequence().ok_or(EngineError::NoSequence)?;
    let (_, it) = q.find_item(clip).ok_or(filmcraft_edit::EditError::NoItem(clip))?;
    let e = it.effects.iter().rev().find(|e| e.effect == EFFECT).ok_or_else(|| bad(CMD, "no Warp Stabilizer on the clip"))?;
    let method = match e.param("method").map(|p| p.value.clone()) {
        Some(ParamValue::Choice(0)) => TrackMethod::Position,
        _ => TrackMethod::PositionScaleRotation,
    };
    let detailed = e.param("detailed").and_then(|p| p.value.as_bool()).unwrap_or(false);
    let fps = q.settings.frame_rate.as_f64().max(1.0);
    let n = ((it.duration.seconds() * fps).round() as usize).clamp(1, 20_000);
    let key = stabilizer_key(&s.project, it, method, detailed);
    if stabilizer_cached(key) {
        return Ok(json!({"job": Value::Null, "frames": n, "cached": true}));
    }
    if stabilizer_pending(key)
        && let Some((_, job)) = s.stabilizer_jobs.iter().find(|(k, _)| *k == key)
    {
        return Ok(json!({"job": job, "frames": n, "cached": false, "running": true}));
    }
    let src_w = filmcraft_render::source_size(&s.project, it.item).ok_or_else(|| bad(CMD, "the clip has no picture"))?.0;
    let scale = stabilizer_scale(src_w, detailed);
    let id = s.jobs.iter().map(|j| j.id).max().unwrap_or(0) + 1;
    let job = crate::Job {
        id,
        kind: "stabilizer",
        label: format!("Analyzing {} (Warp Stabilizer)", it.name),
        progress: Default::default(),
        result: Default::default(),
    };
    job.progress.total.store(n as u64, std::sync::atomic::Ordering::Relaxed);
    let project = s.project.clone();
    let task = StabilizerTask {
        job: id,
        provider: s.media.provider(project.clone(), s.services.clone()),
        project,
        seq: seq_id,
        clip,
        analysis: Some(StabilizerAnalysis::new(key, fps, method)),
        n,
        fps,
        scale,
        k: 0,
        t0: web_time::Instant::now(),
        prog: job.progress.clone(),
        res: job.result.clone(),
    };
    s.jobs.push(job);
    s.stabilizer_jobs.retain(|(k, _)| *k != key);
    s.stabilizer_jobs.push((key, id));
    s.run_task(Box::new(task), wait)?;
    if wait {
        if let Some(Err(e)) = s.jobs.iter().find(|j| j.id == id).and_then(|j| lock(&j.result).clone()) {
            return Err(EngineError::Other(e));
        }
        s.bump_view();
    }
    Ok(json!({"job": id, "frames": n, "cached": false}))
}

/// The analysis, a frame per unit ([`crate::SteppedTask`]).
struct StabilizerTask {
    job: u64,
    project: Arc<filmcraft_project::Project>,
    provider: crate::media_pool::PoolProvider,
    seq: ItemId,
    clip: ClipId,
    /// None once finished (dropping it clears the render's "pending" mark).
    analysis: Option<StabilizerAnalysis>,
    n: usize,
    fps: f64,
    scale: f32,
    /// Next frame to analyse.
    k: usize,
    t0: web_time::Instant,
    prog: Arc<filmcraft_export::Progress>,
    res: Arc<Mutex<Option<std::result::Result<filmcraft_export::Report, String>>>>,
}

impl StabilizerTask {
    fn finish(&mut self, err: Option<String>) -> bool {
        use std::sync::atomic::Ordering;
        let secs = self.t0.elapsed().as_secs_f64();
        let analysis = self.analysis.take();
        let err = match err {
            Some(e) => Some(e),
            None => match analysis.and_then(StabilizerAnalysis::finish) {
                Some(_) => None,
                None => Some("can't decode the clip".to_string()),
            },
        };
        let done = self.k as u64;
        *lock(&self.prog.status) = match &err {
            Some(e) if e == "stopped" => "Stopped: the clip is not stabilised".into(),
            Some(e) => e.clone(),
            None => format!("Analysed {done} frame(s) ({secs:.1}s)"),
        };
        let r = match err {
            Some(e) => {
                *lock(&self.prog.error) = Some(e.clone());
                Err(e)
            }
            None => Ok(filmcraft_export::Report {
                path: String::new(),
                frames: done,
                seconds: secs,
                bytes: 0,
                render_fps: done as f64 / secs.max(1e-6),
                extra_files: Vec::new(),
            }),
        };
        *lock(&self.res) = Some(r);
        self.prog.finished.store(true, Ordering::Relaxed);
        true
    }
}

impl crate::SteppedTask for StabilizerTask {
    fn job(&self) -> u64 {
        self.job
    }

    fn step(&mut self, max: usize) -> bool {
        use std::sync::atomic::Ordering;
        for _ in 0..max {
            if self.prog.cancel.load(Ordering::Relaxed) {
                return self.finish(Some("stopped".to_string()));
            }
            if self.k >= self.n {
                return self.finish(None);
            }
            let Some(analysis) = self.analysis.as_mut() else { return self.finish(None) };
            let frame = self.project.sequence(self.seq).and_then(|q| q.find_item(self.clip).map(|(_, it)| (q, it))).and_then(|(q, it)| {
                filmcraft_render::clip_source_frame(
                    &self.project,
                    q,
                    it,
                    it.start + Tick::from_seconds_f64(self.k as f64 / self.fps),
                    &self.provider,
                    self.scale,
                )
            });
            analysis.push(frame.as_ref());
            self.k += 1;
            self.prog.done.store(self.k as u64, Ordering::Relaxed);
            *lock(&self.prog.status) = format!("Frame {} of {}", self.k, self.n);
        }
        if self.prog.cancel.load(Ordering::Relaxed) {
            return self.finish(Some("stopped".to_string()));
        }
        false
    }
}

#[cfg(test)]
#[path = "stabilize_tests.rs"]
mod tests;
