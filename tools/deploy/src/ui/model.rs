//! The renderer's view model: the checklist groups and their live state.
//!
//! Both the plain and rich renderers drive the same [`Model`]. It maps step
//! events onto display groups, tracks per-group timing, and finalizes a group's
//! status (ok / skipped / failed) once all of its member steps have a result.

use std::time::{Duration, Instant};

use crate::graph::StepOutcome;
use crate::ui::events::{group_index_for_step, GroupMap, INSTALL_GROUPS};

/// A display group's lifecycle state.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum GStatus {
    /// No member step has started yet.
    Pending,
    /// A member step is running.
    Running,
    /// All members done; at least one ran and none failed.
    Ok,
    /// All members were skipped (e.g. checkpoints already done on a re-run).
    Skipped,
    /// A member step failed.
    Failed,
}

/// One checklist group.
#[derive(Clone, Debug)]
pub struct Group {
    /// Friendly label shown in the checklist.
    pub label: &'static str,
    /// The technical step ids this group covers.
    pub steps: &'static [&'static str],
    /// Lifecycle state.
    pub status: GStatus,
    /// When the first member started (drives the live elapsed clock).
    pub started: Option<Instant>,
    /// Total elapsed once finalized.
    pub elapsed: Option<Duration>,
    /// How many member steps have reported a result.
    done_count: usize,
    /// At least one member actually ran (vs being skipped).
    any_ran: bool,
    /// At least one member failed.
    any_failed: bool,
    /// Sub-progress `(done, total)` for a step that reports a fraction.
    pub sub: Option<(u64, u64)>,
    /// The current curated activity headline (e.g. "installing ffmpeg"), shown
    /// in the full-screen detail pane while the group runs.
    pub activity: Option<String>,
    /// Byte-level download progress `(done, total, label)` for the running
    /// file; `total` is 0 when unknown.
    pub bytes: Option<(u64, u64, String)>,
}

impl Group {
    /// Live or finalized elapsed time for display.
    pub fn elapsed_now(&self) -> Option<Duration> {
        self.elapsed.or_else(|| self.started.map(|s| s.elapsed()))
    }
}

/// The full renderer model: the ordered checklist groups + the step→group map
/// they were built from (so the model can resolve a step id to a group without
/// a global const — install and uninstall use different maps).
#[derive(Clone, Debug)]
pub struct Model {
    /// Groups in display order.
    pub groups: Vec<Group>,
    /// The step→group map this model was built from.
    map: GroupMap,
}

impl Default for Model {
    fn default() -> Self {
        Self::new(INSTALL_GROUPS)
    }
}

impl Model {
    /// A fresh model with every group pending, built from `map`.
    pub fn new(map: GroupMap) -> Self {
        let groups = map
            .iter()
            .map(|(label, steps)| Group {
                label,
                steps,
                status: GStatus::Pending,
                started: None,
                elapsed: None,
                done_count: 0,
                any_ran: false,
                any_failed: false,
                sub: None,
                activity: None,
                bytes: None,
            })
            .collect();
        Model { groups, map }
    }

    /// The display group index a step maps to within this model's map, if any.
    pub fn group_index(&self, step_id: &str) -> Option<usize> {
        group_index_for_step(self.map, step_id)
    }

    /// Mark the group owning `step_id` as running (if still pending). Returns the
    /// group index, if the step maps to a group.
    pub fn start(&mut self, step_id: &str) -> Option<usize> {
        let idx = self.group_index(step_id)?;
        let g = &mut self.groups[idx];
        if g.status == GStatus::Pending {
            g.status = GStatus::Running;
            g.started = Some(Instant::now());
        }
        Some(idx)
    }

    /// Record a member step's outcome. Returns the group index *only when this
    /// result finalizes the group* (all members now have a result), so the
    /// renderer can emit/redraw the completed line.
    pub fn record(&mut self, step_id: &str, outcome: &StepOutcome) -> Option<usize> {
        let idx = self.group_index(step_id)?;
        let g = &mut self.groups[idx];
        g.done_count += 1;
        match outcome {
            StepOutcome::Ok => g.any_ran = true,
            StepOutcome::Failed(_) => {
                g.any_ran = true;
                g.any_failed = true;
            }
            StepOutcome::Skipped => {}
        }
        if g.done_count >= g.steps.len() {
            g.status = if g.any_failed {
                GStatus::Failed
            } else if g.any_ran {
                GStatus::Ok
            } else {
                GStatus::Skipped
            };
            g.elapsed = g.started.map(|s| s.elapsed());
            g.sub = None;
            g.activity = None;
            g.bytes = None;
            Some(idx)
        } else {
            None
        }
    }

    /// Update a group's sub-progress fraction. Marks it running if still pending.
    pub fn set_sub(&mut self, step_id: &str, done: u64, total: u64) -> Option<usize> {
        let idx = self.group_index(step_id)?;
        let g = &mut self.groups[idx];
        if g.status == GStatus::Pending {
            g.status = GStatus::Running;
            g.started = Some(Instant::now());
        }
        g.sub = Some((done, total));
        Some(idx)
    }

    /// Set a group's curated activity headline. Marks it running if still pending.
    pub fn set_activity(&mut self, step_id: &str, message: String) -> Option<usize> {
        let idx = self.group_index(step_id)?;
        let g = &mut self.groups[idx];
        if g.status == GStatus::Pending {
            g.status = GStatus::Running;
            g.started = Some(Instant::now());
        }
        g.activity = Some(message);
        Some(idx)
    }

    /// Set a group's byte-level download progress. Marks it running if pending.
    pub fn set_bytes(
        &mut self,
        step_id: &str,
        done: u64,
        total: u64,
        label: String,
    ) -> Option<usize> {
        let idx = self.group_index(step_id)?;
        let g = &mut self.groups[idx];
        if g.status == GStatus::Pending {
            g.status = GStatus::Running;
            g.started = Some(Instant::now());
        }
        g.bytes = Some((done, total, label));
        Some(idx)
    }

    /// Number of groups that have reached a terminal state.
    pub fn finalized(&self) -> usize {
        self.groups
            .iter()
            .filter(|g| matches!(g.status, GStatus::Ok | GStatus::Skipped | GStatus::Failed))
            .count()
    }

    /// Total group count.
    pub fn total(&self) -> usize {
        self.groups.len()
    }
}

/// Format a duration as `M:SS` or `S.s` for compact display.
pub fn fmt_dur(d: Duration) -> String {
    let secs = d.as_secs();
    if secs >= 60 {
        format!("{}:{:02}", secs / 60, secs % 60)
    } else {
        format!("{}.{}s", secs, d.subsec_millis() / 100)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn group_finalizes_only_after_all_members() {
        let mut m = Model::new(INSTALL_GROUPS);
        // "Configuring" has 3 members; it must not finalize until all 3 report.
        assert_eq!(m.record("config_identity", &StepOutcome::Ok), None);
        assert_eq!(m.record("network_mac_pin", &StepOutcome::Ok), None);
        let idx = m
            .record("rtl_regulatory", &StepOutcome::Skipped)
            .expect("finalizes on the 3rd");
        assert_eq!(m.groups[idx].status, GStatus::Ok); // one ran → Ok, not Skipped
    }

    #[test]
    fn all_skipped_group_is_skipped() {
        let mut m = Model::new(INSTALL_GROUPS);
        let idx = m.record("deps", &StepOutcome::Skipped).unwrap();
        assert_eq!(m.groups[idx].status, GStatus::Skipped);
    }

    #[test]
    fn any_failure_fails_the_group() {
        let mut m = Model::new(INSTALL_GROUPS);
        m.record("watchdog", &StepOutcome::Ok);
        let idx = m
            .record("systemd", &StepOutcome::Failed("boom".into()))
            .unwrap();
        assert_eq!(m.groups[idx].status, GStatus::Failed);
    }

    #[test]
    fn fmt_dur_forms() {
        assert_eq!(fmt_dur(Duration::from_millis(400)), "0.4s");
        assert_eq!(fmt_dur(Duration::from_secs(42)), "42.0s");
        assert_eq!(fmt_dur(Duration::from_secs(75)), "1:15");
    }
}
