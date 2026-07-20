//! The mutable run context threaded (by `&mut`) through the deploy step graph.
//!
//! Carries the parsed args, host facts, the checkpoint store, the failure
//! accumulator, and the live-progress sink the graph records into — the exact
//! surface `graph::run_graph` needs — plus the deploy-specific state the steps
//! share: the collected config, the repo + self-host paths, and the Convex admin
//! key one step retrieves and later steps consume.

use std::path::PathBuf;

use crate::checkpoint::Checkpoint;
use crate::cli::Args;
use crate::env::EnvInfo;
use crate::result::FailureAccumulator;
use crate::ui::ProgressSink;
use crate::wizard::state::DeployConfig;

/// Per-run state shared across the step graph.
#[derive(Debug)]
pub struct Ctx {
    /// Parsed command-line arguments.
    pub args: Args,
    /// Probed host facts (arch, os).
    pub env: EnvInfo,
    /// Checkpoint store (resume markers).
    pub checkpoint: Checkpoint,
    /// Accumulated step failures; classified into a run status at the end.
    pub failures: FailureAccumulator,
    /// Whether checkpoints are bypassed this run (`--force`).
    pub force: bool,
    /// Live-progress sink. Defaults to a no-op; the binary swaps in a real sink
    /// after starting the renderer.
    pub progress: ProgressSink,

    // --- deploy state ------------------------------------------------------
    /// The collected deploy configuration (the wizard answers).
    pub config: DeployConfig,
    /// The ADOSMissionControl repo root the deploy runs from.
    pub repo_root: PathBuf,
    /// The Convex admin key, retrieved by the `admin_key` step and consumed by
    /// the function-push + env-set steps. `None` until retrieved.
    pub admin_key: Option<String>,
}

impl Ctx {
    /// Build the run context from parsed arguments (a default config; the deploy
    /// path uses [`Ctx::for_deploy`]).
    pub fn from_args(args: Args, env: EnvInfo, checkpoint: Checkpoint) -> Self {
        let force = args.force;
        Ctx {
            args,
            env,
            checkpoint,
            failures: FailureAccumulator::new(),
            force,
            progress: ProgressSink::default(),
            config: DeployConfig::default(),
            repo_root: PathBuf::from("."),
            admin_key: None,
        }
    }

    /// Build the deploy context from the collected config + repo root + the live
    /// progress sink. The checkpoint store is pinned under the self-host dir.
    pub fn for_deploy(
        config: DeployConfig,
        repo_root: PathBuf,
        progress: ProgressSink,
        force: bool,
    ) -> Self {
        let checkpoint = Checkpoint::with_root(repo_root.join("tools/selfhost/.deploy-state"));
        Ctx {
            args: Args::default(),
            env: EnvInfo::probe(),
            checkpoint,
            failures: FailureAccumulator::new(),
            force,
            progress,
            config,
            repo_root,
            admin_key: None,
        }
    }

    /// The self-host directory (`<repo>/tools/selfhost`).
    pub fn selfhost_dir(&self) -> PathBuf {
        self.repo_root.join("tools/selfhost")
    }

    /// A minimal context for unit tests.
    pub fn for_test(checkpoint: Checkpoint) -> Self {
        let mut c = Ctx::from_args(Args::default(), EnvInfo::probe(), checkpoint);
        c.repo_root = PathBuf::from(".");
        c
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deploy_ctx_pins_checkpoint_under_selfhost() {
        let sink = ProgressSink::default();
        let c = Ctx::for_deploy(
            DeployConfig::default(),
            PathBuf::from("/tmp/repo"),
            sink,
            false,
        );
        assert_eq!(c.selfhost_dir(), PathBuf::from("/tmp/repo/tools/selfhost"));
        assert!(c.admin_key.is_none());
    }
}
