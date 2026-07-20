//! Progress events + the step→friendly-group map.
//!
//! The install engine emits [`ProgressEvent`]s onto a channel; a renderer thread
//! consumes them and draws the live progress (rich) or prints line transitions
//! (plain). The 14 technical install steps are collapsed into ~10 human-readable
//! groups so the checklist reads at a glance; a group lights up when any of its
//! member steps starts and finalizes when all of them have a result.

use crate::graph::StepOutcome;

/// A checklist group set: friendly labels (in display order) each mapping to one
/// or more technical step ids. The renderer is generic over this so it drives
/// both the install and the uninstall flows.
pub type GroupMap = &'static [(&'static str, &'static [&'static str])];

/// The install checklist groups. Each maps to one or more of the technical step
/// ids in the install chain; every chain step appears in exactly one group.
pub const INSTALL_GROUPS: GroupMap = &[
    ("Checking system", &["preflight", "purge_residue"]),
    ("Installing dependencies", &["deps"]),
    ("Agent runtime", &["venv_agent"]),
    ("Building radio stack", &["wfb_ng"]),
    ("Downloading components", &["fetch_binaries"]),
    ("Building drivers", &["dkms"]),
    (
        "Configuring",
        &["config_identity", "network_mac_pin", "rtl_regulatory"],
    ),
    ("Registering services", &["watchdog", "systemd"]),
    ("Starting agent", &["start"]),
    ("Verifying", &["health"]),
];

/// The uninstall checklist groups (one per teardown phase; see
/// [`crate::uninstall::run_uninstall`]).
pub const UNINSTALL_GROUPS: GroupMap = &[
    ("Stopping services", &["stop_units"]),
    ("Reloading systemd", &["reload"]),
    ("Removing commands", &["commands"]),
    ("Removing files", &["files"]),
    ("Cleaning up", &["cleanup"]),
];

/// The full-screen footer reassurance line for the install flow.
pub const INSTALL_FOOTER: &str = "First install can take a few minutes. Safe to leave running.";
/// The full-screen footer line for the uninstall flow.
pub const UNINSTALL_FOOTER: &str = "Removing the ADOS Drone Agent. This only takes a moment.";

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
    /// The terminal summary: render the success card / failure panel.
    Summary(Box<SummaryData>),
    /// Stop the renderer loop and restore the terminal.
    Finished,
}

/// The data the renderer needs to draw the final success card or failure panel.
/// Assembled by the installer after the graph run; the renderer combines it with
/// its own buffered log lines for the failure panel.
#[derive(Debug, Clone)]
pub struct SummaryData {
    /// `ok` | `degraded` | `failed`.
    pub status: String,
    /// Installed agent version, or `unknown`.
    pub version: String,
    /// `drone` | `ground_station`.
    pub profile: String,
    /// Detected board model.
    pub board: String,
    /// The 12-hex device id.
    pub device_id: String,
    /// Hostname (drives the `<host>.local` mDNS hint + setup URL).
    pub hostname: String,
    /// The on-box setup URL.
    pub setup_url: String,
    /// Non-loopback IPv4 addresses the box owns, in interface order. The
    /// success card lists one reach URL per entry so the console stays
    /// reachable even when `<host>.local` mDNS does not resolve.
    pub lan_ips: Vec<String>,
    /// Whether the agent has pairing material on disk.
    pub paired: bool,
    /// Every step that did not succeed.
    pub failed_steps: Vec<String>,
    /// The subset that were Required (hard failures).
    pub required_failures: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_chain_step_maps_to_exactly_one_group() {
        let chain = [
            "preflight",
            "purge_residue",
            "deps",
            "venv_agent",
            "wfb_ng",
            "fetch_binaries",
            "dkms",
            "config_identity",
            "network_mac_pin",
            "rtl_regulatory",
            "watchdog",
            "systemd",
            "start",
            "health",
        ];
        for step in chain {
            let hits = INSTALL_GROUPS
                .iter()
                .filter(|(_, steps)| steps.contains(&step))
                .count();
            assert_eq!(hits, 1, "step {step} must map to exactly one group");
        }
        // And no group references a step outside the chain.
        for (_, steps) in INSTALL_GROUPS {
            for s in *steps {
                assert!(chain.contains(s), "group references unknown step {s}");
            }
        }
    }

    #[test]
    fn group_lookup_resolves() {
        assert_eq!(group_index_for_step(INSTALL_GROUPS, "deps"), Some(1));
        assert_eq!(
            group_index_for_step(INSTALL_GROUPS, "health"),
            Some(INSTALL_GROUPS.len() - 1)
        );
        assert_eq!(group_index_for_step(INSTALL_GROUPS, "nope"), None);
        // Uninstall groups resolve against their own map.
        assert_eq!(group_index_for_step(UNINSTALL_GROUPS, "cleanup"), Some(4));
        assert_eq!(group_index_for_step(UNINSTALL_GROUPS, "deps"), None);
    }
}
