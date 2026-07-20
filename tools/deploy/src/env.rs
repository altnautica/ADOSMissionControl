//! Filesystem locations for the deployer.

use std::path::PathBuf;

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
