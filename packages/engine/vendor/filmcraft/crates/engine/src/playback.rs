//! Playback read-ahead and preroll (sh-video-editor).
//!
//! Upstream filmcraft prefetched program frames in its egui player, which this port does not
//! carry, so a host that asks for one frame at a time paid every decoder open, seek and decode
//! inline on the first play (on Windows the Media Foundation session alone took about 400 to
//! 650 ms for the first 1080p H.264 frame). This module is the decode-ahead queue that players
//! keep between demux/decode and display (ffplay's frame queue, mpv's demuxer cache, a
//! GStreamer pipeline's preroll in PAUSED):
//!
//! - [`ReadAhead::start`] plans frames from a sequence tick in the play direction at the
//!   current rate and render scale, against one immutable project snapshot (`Arc<Project>`,
//!   revision) and the shared media pool. A worker renders them into a bounded ready queue
//!   (count and bytes) as sRGB RGBA8, the form the bindings hand to the screen.
//! - [`ReadAhead::take`] returns the ready frame for the tick the host asks for, drops frames
//!   the host skipped, re-plans after a seek or an edit (new revision), and when the frame being
//!   rendered right now is the wanted one waits for it instead of decoding it twice.
//! - [`ReadAhead::status`] reports how many frames are ready; hosts preroll (start the clock)
//!   once `ready >= target` or after their own timeout.
//! - With the queue full the worker opens decoders for clips that start within the next
//!   [`WARM_AHEAD_SECONDS`] (renders one frame there and drops it), so crossing a cut does not pay
//!   the decoder open during playback. [`ReadAhead::prepare`] readies the first frames at the
//!   playhead while paused (the shown frame again, in the background: the next play takes it
//!   from the queue instead of rendering it on the host's thread).
//!
//! Native hosts get one background thread (`filmcraft-readahead`). wasm32 has no threads:
//! the host calls [`ReadAhead::pump`] with a time budget when its worker is idle.

use std::collections::VecDeque;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};

use filmcraft_project::{ItemId, Project};
use filmcraft_time::Tick;

use crate::Services;
use crate::media_pool::MediaPool;

/// Frames kept ready ahead of the playhead during playback (about 0.27 s at 30 fps).
pub const AHEAD_FRAMES: usize = if cfg!(target_arch = "wasm32") { 3 } else { 8 };
/// Frames prepared at the playhead while paused.
pub const PREPARE_FRAMES: usize = if cfg!(target_arch = "wasm32") { 1 } else { 3 };
/// Frames a host should wait for before starting the clock (preroll target), capped by the plan.
/// One: the decoder open and seek land on the first frame; after it the queue fills faster than
/// real time, and waiting for more only delays a replay whose frames are cached (measured in
/// `docs/guides/playback.md`).
pub const PREROLL_FRAMES: usize = 1;
/// Upper bound of the ready queue in bytes (RGBA8), whatever the frame size.
pub const MAX_READY_BYTES: usize = 96 * 1024 * 1024;
/// Clip starts within this many seconds after the queue's end get their decoders opened.
pub const WARM_AHEAD_SECONDS: f64 = 3.0;

/// One rendered program frame: sRGB RGBA8 over black, `w * h * 4` bytes.
#[derive(Clone, Debug)]
pub struct ReadyFrame {
    pub tick: Tick,
    pub w: usize,
    pub h: usize,
    pub rgba: Vec<u8>,
}

/// What the host asks [`ReadAhead::take`] for and what a plan is keyed by.
#[derive(Clone)]
pub struct Target {
    pub project: Arc<Project>,
    pub seq: ItemId,
    pub revision: u64,
    pub scale: f32,
}

#[derive(Clone)]
struct Plan {
    generation: u64,
    project: Arc<Project>,
    seq: ItemId,
    revision: u64,
    scale: f32,
    /// Ticks between planned frames, negative when playing backwards.
    step: i64,
    frame: i64,
    /// Next tick to render.
    next: Tick,
    end: Tick,
    ahead: usize,
    playing: bool,
    /// Clip starts already warmed for this plan.
    warmed: Vec<Tick>,
}

impl Plan {
    fn exhausted(&self) -> bool {
        if self.step >= 0 { self.next >= self.end } else { self.next.0 < 0 }
    }
    fn same_target(&self, t: &Target) -> bool {
        self.seq == t.seq && self.revision == t.revision && self.scale.to_bits() == t.scale.to_bits()
    }
    /// Whether `t` comes before `u` in the play direction.
    fn before(&self, t: Tick, u: Tick) -> bool {
        if self.step >= 0 { t < u } else { t > u }
    }
}

#[derive(Default)]
struct State {
    plan: Option<Plan>,
    ready: VecDeque<ReadyFrame>,
    bytes: usize,
    /// The frame the worker is rendering now: (plan generation, tick).
    rendering: Option<(u64, Tick)>,
    generation: u64,
    quit: bool,
    /// Counters for `status` (frames served from the queue, served by the host itself).
    hits: u64,
    misses: u64,
    rendered: u64,
    warmed: u64,
}

impl State {
    fn clear_ready(&mut self) {
        self.ready.clear();
        self.bytes = 0;
    }
    /// Work for the worker: a frame to render, or a clip start to warm, with the plan generation.
    fn work(&self) -> Option<Work> {
        let p = self.plan.as_ref()?;
        let room = self.ready.len() < p.ahead && (self.bytes < MAX_READY_BYTES || self.ready.is_empty());
        if room && !p.exhausted() {
            return Some(Work { generation: p.generation, tick: p.next, warm: false, project: p.project.clone(), seq: p.seq, scale: p.scale });
        }
        if !p.playing && !self.ready.is_empty() {
            // paused: the prepared frames are enough, warming waits for play
            return None;
        }
        let from = if p.exhausted() { p.end } else { p.next };
        let warm = next_clip_start(&p.project, p.seq, from, p.step, p.frame, &p.warmed)?;
        Some(Work { generation: p.generation, tick: warm, warm: true, project: p.project.clone(), seq: p.seq, scale: p.scale })
    }
}

struct Work {
    generation: u64,
    tick: Tick,
    warm: bool,
    project: Arc<Project>,
    seq: ItemId,
    scale: f32,
}

struct Shared {
    state: Mutex<State>,
    cv: Condvar,
}

fn lock(s: &Shared) -> MutexGuard<'_, State> {
    s.state.lock().unwrap_or_else(|e| e.into_inner())
}

/// The first video clip start after `from` (in the play direction) within
/// [`WARM_AHEAD_SECONDS`] that has not been warmed yet.
fn next_clip_start(project: &Project, seq: ItemId, from: Tick, step: i64, frame: i64, warmed: &[Tick]) -> Option<Tick> {
    let q = project.sequence(seq)?;
    let reach = Tick::from_seconds_f64(WARM_AHEAD_SECONDS).0.max(frame);
    let (lo, hi) = if step >= 0 { (from.0, from.0 + reach) } else { (from.0 - reach, from.0) };
    let mut best: Option<Tick> = None;
    for track in q.video_tracks.iter().filter(|t| t.enabled) {
        for it in &track.items {
            // a reversed play enters a clip at its last frame
            let at = if step >= 0 { it.start } else { Tick((it.start.0 + it.duration.0 - frame).max(it.start.0)) };
            if at.0 < lo || at.0 > hi || warmed.contains(&at) {
                continue;
            }
            let closer = best.is_none_or(|b| if step >= 0 { at < b } else { at > b });
            if closer {
                best = Some(at);
            }
        }
    }
    best
}

/// See the module docs.
pub struct ReadAhead {
    shared: Arc<Shared>,
    pool: Arc<MediaPool>,
    services: Arc<dyn Services>,
    #[cfg(not(target_arch = "wasm32"))]
    thread: Mutex<Option<std::thread::JoinHandle<()>>>,
}

impl ReadAhead {
    pub fn new(pool: Arc<MediaPool>, services: Arc<dyn Services>) -> Self {
        Self {
            shared: Arc::new(Shared { state: Mutex::new(State::default()), cv: Condvar::new() }),
            pool,
            services,
            #[cfg(not(target_arch = "wasm32"))]
            thread: Mutex::new(None),
        }
    }

    /// Plan frames from `t` (already snapped to the sequence frame rate) in the direction and
    /// stride of `rate` (2.0 = every other frame, negative = backwards) and keep
    /// [`AHEAD_FRAMES`] of them ready. Ready frames that still fit the new plan are kept.
    pub fn start(&self, target: Target, t: Tick, rate: f64, frame: Tick) {
        self.plan(target, t, rate, frame, true);
    }

    /// While paused: render the first [`PREPARE_FRAMES`] frames forward from `t` so the next
    /// play starts on ready frames (decoders opened, first GOP decoded).
    pub fn prepare(&self, target: Target, t: Tick, frame: Tick) {
        self.plan(target, t, 1.0, frame, false);
    }

    fn plan(&self, target: Target, t: Tick, rate: f64, frame: Tick, playing: bool) {
        let frame = frame.0.max(1);
        let stride = if rate.is_finite() && rate.abs() >= 1.0 { rate.abs().round() as i64 } else { 1 };
        let step = if rate < 0.0 { -frame * stride } else { frame * stride };
        let end = target.project.sequence(target.seq).map(|q| q.duration()).unwrap_or(Tick::ZERO);
        let mut st = lock(&self.shared);
        let keep = st.plan.as_ref().is_some_and(|p| p.same_target(&target) && p.step == step);
        if !keep {
            st.clear_ready();
        }
        // drop ready frames before `t`; the queue then continues from its last frame
        if keep {
            while let Some(f) = st.ready.front() {
                let behind = if step >= 0 { f.tick < t } else { f.tick > t };
                if !behind {
                    break;
                }
                st.bytes -= f.rgba.len();
                st.ready.pop_front();
            }
            let contiguous = st.ready.front().is_some_and(|f| f.tick == t);
            if !contiguous {
                st.clear_ready();
            }
        }
        st.generation += 1;
        let next = st.ready.back().map(|f| Tick(f.tick.0 + step)).unwrap_or(t);
        let warmed = st.plan.as_ref().filter(|_| keep).map(|p| p.warmed.clone()).unwrap_or_default();
        let ahead = if playing { AHEAD_FRAMES } else { PREPARE_FRAMES };
        st.plan = Some(Plan {
            generation: st.generation,
            project: target.project,
            seq: target.seq,
            revision: target.revision,
            scale: target.scale,
            step,
            frame,
            next,
            end,
            ahead,
            playing,
            warmed,
        });
        drop(st);
        self.shared.cv.notify_all();
        self.ensure_worker();
    }

    /// Stop planning; ready frames are dropped.
    pub fn stop(&self) {
        let mut st = lock(&self.shared);
        st.plan = None;
        st.generation += 1;
        st.clear_ready();
        drop(st);
        self.shared.cv.notify_all();
    }

    /// The ready frame for tick `t` of `target`, if the plan has it (or is rendering it now, in
    /// which case this waits for it). Frames before `t` are dropped. A request the plan cannot
    /// serve (seek, edit, other scale) re-plans from the frame after `t` so the queue catches up,
    /// and returns `None`: the caller renders `t` itself.
    pub fn take(&self, target: &Target, t: Tick) -> Option<ReadyFrame> {
        let mut st = lock(&self.shared);
        let plan = st.plan.clone()?;
        if !plan.same_target(target) {
            // edited (or the scale changed): keep the direction, re-plan on the new snapshot
            st.misses += 1;
            let rate = (plan.step / plan.frame) as f64;
            let (playing, frame) = (plan.playing, Tick(plan.frame));
            drop(st);
            let next = Tick(t.0 + plan.step);
            self.plan(target.clone(), next, if playing { rate } else { 1.0 }, frame, playing);
            return None;
        }
        // skipped frames
        while let Some(f) = st.ready.front() {
            if !plan.before(f.tick, t) {
                break;
            }
            st.bytes -= f.rgba.len();
            st.ready.pop_front();
        }
        loop {
            if let Some(f) = st.ready.front()
                && f.tick == t
            {
                let f = st.ready.pop_front()?;
                st.bytes -= f.rgba.len();
                st.hits += 1;
                drop(st);
                self.shared.cv.notify_all();
                return Some(f);
            }
            let current = st.plan.as_ref().map(|p| p.generation);
            let busy_with_t = st.rendering == Some((plan.generation, t)) && current == Some(plan.generation);
            if busy_with_t && cfg!(not(target_arch = "wasm32")) {
                st = self.shared.cv.wait(st).unwrap_or_else(|e| e.into_inner());
                continue;
            }
            break;
        }
        st.misses += 1;
        // the host is ahead of the queue (or seeked): continue after `t`
        let in_window = st.ready.front().is_some_and(|f| plan.before(t, f.tick));
        if !in_window {
            st.clear_ready();
            st.generation += 1;
            let generation = st.generation;
            if let Some(p) = st.plan.as_mut() {
                p.generation = generation;
                p.next = Tick(t.0 + p.step);
            }
            drop(st);
            self.shared.cv.notify_all();
        }
        None
    }

    /// `{active, playing, ready, target, bytes, hits, misses, rendered, warmed}` for hosts
    /// (preroll waits for `ready >= target`) and diagnostics.
    pub fn status(&self) -> serde_json::Value {
        let st = lock(&self.shared);
        let target = st.plan.as_ref().map(|p| PREROLL_FRAMES.min(p.ahead)).unwrap_or(0);
        let exhausted = st.plan.as_ref().is_some_and(Plan::exhausted);
        serde_json::json!({
            "active": st.plan.is_some(),
            "playing": st.plan.as_ref().is_some_and(|p| p.playing),
            "ready": st.ready.len(),
            // a plan at the sequence end can never fill its target: report it as met
            "target": if exhausted { st.ready.len() } else { target },
            "bytes": st.bytes,
            "hits": st.hits,
            "misses": st.misses,
            "rendered": st.rendered,
            "warmed": st.warmed,
            // false on wasm32: the host advances the queue with `pump`
            "threaded": cfg!(not(target_arch = "wasm32")),
        })
    }

    /// wasm32: do read-ahead work until `budget` is spent or nothing is left; true while work
    /// remains. Native hosts have the worker thread and get `false`.
    pub fn pump(&self, budget: std::time::Duration) -> bool {
        if cfg!(not(target_arch = "wasm32")) {
            return false;
        }
        let t0 = web_time::Instant::now();
        loop {
            let work = lock(&self.shared).work();
            let Some(work) = work else { return false };
            self.run(work);
            if t0.elapsed() >= budget {
                return lock(&self.shared).work().is_some();
            }
        }
    }

    fn run(&self, w: Work) {
        {
            let mut st = lock(&self.shared);
            st.rendering = Some((w.generation, w.tick));
            if w.warm
                && let Some(p) = st.plan.as_mut()
                && p.generation == w.generation
            {
                p.warmed.push(w.tick);
            }
        }
        let provider = self.pool.provider(w.project.clone(), self.services.clone());
        let opts = filmcraft_render::RenderOptions { scale: w.scale, captions: true, ..Default::default() };
        let img = filmcraft_render::render_sequence(&w.project, w.seq, w.tick, opts, &provider);
        let rgba = if w.warm { Vec::new() } else { img.over_black_rgba8() };
        let mut st = lock(&self.shared);
        st.rendering = None;
        let current = st.plan.as_ref().is_some_and(|p| p.generation == w.generation);
        if w.warm {
            st.warmed += 1;
        } else if current {
            st.rendered += 1;
            st.bytes += rgba.len();
            st.ready.push_back(ReadyFrame { tick: w.tick, w: img.w, h: img.h, rgba });
            if let Some(p) = st.plan.as_mut() {
                p.next = Tick(w.tick.0 + p.step);
            }
        }
        drop(st);
        self.shared.cv.notify_all();
    }

    #[cfg(not(target_arch = "wasm32"))]
    fn ensure_worker(&self) {
        let mut slot = self.thread.lock().unwrap_or_else(|e| e.into_inner());
        if slot.is_some() {
            return;
        }
        let shared = self.shared.clone();
        let me = Worker { shared: shared.clone(), pool: self.pool.clone(), services: self.services.clone() };
        if let Ok(h) = std::thread::Builder::new().name("filmcraft-readahead".into()).spawn(move || me.run_loop()) {
            *slot = Some(h);
        }
    }

    #[cfg(target_arch = "wasm32")]
    fn ensure_worker(&self) {}
}

#[cfg(not(target_arch = "wasm32"))]
struct Worker {
    shared: Arc<Shared>,
    pool: Arc<MediaPool>,
    services: Arc<dyn Services>,
}

#[cfg(not(target_arch = "wasm32"))]
impl Worker {
    fn run_loop(self) {
        let ra = ReadAhead { shared: self.shared.clone(), pool: self.pool, services: self.services, thread: Mutex::new(None) };
        loop {
            let work = {
                let mut st = lock(&self.shared);
                loop {
                    if st.quit {
                        return;
                    }
                    if let Some(w) = st.work() {
                        break w;
                    }
                    st = self.shared.cv.wait(st).unwrap_or_else(|e| e.into_inner());
                }
            };
            ra.run(work);
        }
    }
}

impl Drop for ReadAhead {
    fn drop(&mut self) {
        {
            let mut st = lock(&self.shared);
            st.quit = true;
            st.plan = None;
        }
        self.shared.cv.notify_all();
        #[cfg(not(target_arch = "wasm32"))]
        if let Some(h) = self.thread.lock().unwrap_or_else(|e| e.into_inner()).take() {
            let _ = h.join();
        }
    }
}
