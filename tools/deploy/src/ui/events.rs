//! Progress events + the step→friendly-group map.
//!
//! The deploy engine emits [`ProgressEvent`]s onto a channel; a renderer thread
//! consumes them and draws the live progress (rich) or prints line transitions
//! (plain). The technical deploy steps are collapsed into human-readable groups
//! so the checklist reads at a glance; a group lights up when any of its member
//! steps starts and finalizes when all of them have a result.

use crate::graph::StepOutcome;

/// A checklist group set: friendly labels (in display order) each mapping to one
/// or more technical step ids. The renderer is generic over this.
pub type GroupMap = &'static [(&'static str, &'static [&'static str])];

/// The deploy checklist groups. Each maps to one or more of the technical step
/// ids in the deploy chain; every chain step appears in exactly one group.
pub const DEPLOY_GROUPS: GroupMap = &[
    ("Checking system", &["preflight"]),
    ("Writing config", &["write_config"]),
    ("Starting Convex", &["up_convex", "wait_convex"]),
    (
        "Configuring Convex",
        &["admin_key", "push_functions", "auth_keys"],
    ),
    ("MQTT credentials", &["mqtt_passwd"]),
    ("Starting services", &["up_rest"]),
    ("Verifying", &["verify"]),
];

/// The full-screen footer reassurance line for the deploy flow.
pub const DEPLOY_FOOTER: &str =
    "First deploy pulls images + builds Mission Control. Safe to leave running.";

/// The display group index a step belongs to within `groups`, if any.
pub fn group_index_for_step(groups: GroupMap, step_id: &str) -> Option<usize> {
    groups
        .iter()
        .position(|(_, steps)| steps.contains(&step_id))
}

/// An event emitted from the install engine to the renderer thread.
#[derive(Debug)]
pub enum ProgressEvent {
    /// A step's `run()` is about to execute (lights up its group's spinner).
    StepStarted { id: String },
    /// A step finished (ran or was skipped) with the given outcome.
    StepResult { id: String, outcome: StepOutcome },
    /// Incremental sub-progress for a step that reports a fraction (the
    /// component download). `done`/`total` are in the step's own units.
    SubProgress { id: String, done: u64, total: u64 },
    /// A curated one-line headline for the running step ("installing ffmpeg",
    /// "compiling radio stack") — the accent line in the live-detail pane.
    Activity { id: String, message: String },
    /// One raw subprocess line for the running step's dim scrolling log tail.
    SubLog { id: String, line: String },
    /// Byte-level download progress for the running step's current file.
    /// `total` is 0 when the size is unknown. `label` names the file (e.g. the
    /// service being fetched) so the detail pane reads "ados-control 4.2/8.1 MB".
    ByteProgress {
        id: String,
        done: u64,
        total: u64,
        label: String,
    },
    /// A forwarded log line (from the tracing layer) to scroll above the block.
    Log { level: tracing::Level, line: String },
    /// Stop the renderer loop and restore the terminal.
    Finished,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn group_lookup_resolves() {
        assert_eq!(group_index_for_step(DEPLOY_GROUPS, "preflight"), Some(0));
        assert_eq!(
            group_index_for_step(DEPLOY_GROUPS, "verify"),
            Some(DEPLOY_GROUPS.len() - 1)
        );
        assert_eq!(group_index_for_step(DEPLOY_GROUPS, "nope"), None);
    }
}
