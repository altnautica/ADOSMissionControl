//! Host facts probed once at startup, plus filesystem locations.

use std::path::PathBuf;

/// Fallback checkpoint root when a run does not pin one. The deploy engine always
/// pins `Checkpoint::with_root(<selfhost>/.deploy-state)` at runtime, so this is
/// only the `Checkpoint::default()` fallback (used by unit tests).
pub const CHECKPOINT_DIR: &str = ".ados-deploy-checkpoints";

/// Probed facts about the machine the deployer runs on.
#[derive(Debug, Clone)]
pub struct EnvInfo {
    /// CPU architecture (`aarch64`, `x86_64`, …).
    pub arch: String,
    /// Operating system (`macos`, `linux`, `windows`).
    pub os: String,
}

impl EnvInfo {
    /// Probe the host facts from compile-time target info.
    pub fn probe() -> Self {
        EnvInfo {
            arch: std::env::consts::ARCH.to_string(),
            os: match std::env::consts::OS {
                "macos" => "macos",
                "windows" => "windows",
                other => other,
            }
            .to_string(),
        }
    }

    /// True when the host is macOS.
    pub fn is_macos(&self) -> bool {
        self.os == "macos"
    }

    /// True when the host is Windows.
    pub fn is_windows(&self) -> bool {
        self.os == "windows"
    }
}

/// Locate the ADOSMissionControl repo root from the current working directory:
/// walk up until a directory contains `tools/selfhost/docker-compose.yml`. The
/// deployer always operates on a repo checkout (it builds the GCS image + pushes
/// Convex functions from it), so a missing root is a hard, actionable error.
pub fn find_repo_root(start: &std::path::Path) -> Option<PathBuf> {
    let mut dir = Some(start);
    while let Some(d) = dir {
        if d.join("tools/selfhost/docker-compose.yml").is_file() {
            return Some(d.to_path_buf());
        }
        dir = d.parent();
    }
    None
}
