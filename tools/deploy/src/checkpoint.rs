//! Per-step checkpoint markers so an interrupted install resumes instead of
//! redoing completed work.
//!
//! A checkpoint is an empty `<root>/<name>.done` file. The marker is created
//! after a step succeeds; on the next run a step whose marker exists is
//! skipped (unless `--force`). The root is injectable so tests run against a
//! tempdir rather than `/var/lib/ados/install-checkpoints`.

use std::path::PathBuf;

use crate::env::CHECKPOINT_DIR;

/// A checkpoint directory. Cheap to clone; holds only the root path.
#[derive(Debug, Clone)]
pub struct Checkpoint {
    root: PathBuf,
}

impl Default for Checkpoint {
    fn default() -> Self {
        Self::new()
    }
}

impl Checkpoint {
    /// Checkpoints under the canonical `CHECKPOINT_DIR`.
    pub fn new() -> Self {
        Checkpoint {
            root: PathBuf::from(CHECKPOINT_DIR),
        }
    }

    /// Checkpoints under an explicit root (tests).
    pub fn with_root(root: impl Into<PathBuf>) -> Self {
        Checkpoint { root: root.into() }
    }

    fn marker(&self, name: &str) -> PathBuf {
        self.root.join(format!("{name}.done"))
    }

    /// True when `<root>/<name>.done` exists.
    pub fn is_done(&self, name: &str) -> bool {
        self.marker(name).exists()
    }

    /// Create the `<root>/<name>.done` marker (idempotent). Creates the root
    /// dir on first use. Best-effort: a write failure surfaces as `Err`.
    pub fn mark(&self, name: &str) -> std::io::Result<()> {
        std::fs::create_dir_all(&self.root)?;
        std::fs::write(self.marker(name), b"")?;
        Ok(())
    }

    /// Remove every `*.done` marker under the root (a `--force` reinstall
    /// clears the resume state). A missing root is a no-op.
    pub fn clear(&self) -> std::io::Result<()> {
        let entries = match std::fs::read_dir(&self.root) {
            Ok(e) => e,
            Err(ref e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) => return Err(e),
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("done") {
                std::fs::remove_file(path)?;
            }
        }
        Ok(())
    }

    /// The base names of all present markers (without the `.done` suffix),
    /// sorted for a stable read.
    pub fn list(&self) -> Vec<String> {
        let mut out = Vec::new();
        if let Ok(entries) = std::fs::read_dir(&self.root) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("done") {
                    if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                        out.push(stem.to_string());
                    }
                }
            }
        }
        out.sort();
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mark_then_is_done() {
        let dir = tempfile::tempdir().unwrap();
        let cp = Checkpoint::with_root(dir.path());
        assert!(!cp.is_done("deps"));
        cp.mark("deps").unwrap();
        assert!(cp.is_done("deps"));
    }

    #[test]
    fn mark_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let cp = Checkpoint::with_root(dir.path());
        cp.mark("deps").unwrap();
        cp.mark("deps").unwrap();
        assert_eq!(cp.list(), vec!["deps".to_string()]);
    }

    #[test]
    fn clear_removes_all_markers() {
        let dir = tempfile::tempdir().unwrap();
        let cp = Checkpoint::with_root(dir.path());
        cp.mark("deps").unwrap();
        cp.mark("systemd").unwrap();
        assert_eq!(cp.list().len(), 2);
        cp.clear().unwrap();
        assert!(cp.list().is_empty());
        assert!(!cp.is_done("deps"));
    }

    #[test]
    fn clear_on_missing_root_is_ok() {
        let dir = tempfile::tempdir().unwrap();
        let cp = Checkpoint::with_root(dir.path().join("never-created"));
        cp.clear().unwrap();
        assert!(cp.list().is_empty());
    }

    #[test]
    fn list_is_sorted_and_ignores_non_markers() {
        let dir = tempfile::tempdir().unwrap();
        let cp = Checkpoint::with_root(dir.path());
        cp.mark("systemd").unwrap();
        cp.mark("agent-package").unwrap();
        // A stray non-marker file must be ignored.
        std::fs::write(dir.path().join("notes.txt"), b"x").unwrap();
        assert_eq!(
            cp.list(),
            vec!["agent-package".to_string(), "systemd".to_string()]
        );
    }
}
