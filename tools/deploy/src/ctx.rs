//! The mutable run context threaded (by `&mut`) through the deploy step graph.
//!
//! Carries the parsed args, host facts, the checkpoint store, the failure
//! accumulator, and the live-progress sink the graph records into — the exact
//! surface `graph::run_graph` needs. The deploy-specific state (collected wizard
//! answers, admin key, repo paths, dry-run plan) is layered on for Phase 3.

use crate::checkpoint::Checkpoint;
use crate::cli::Args;
use crate::env::EnvInfo;
use crate::result::FailureAccumulator;
use crate::ui::ProgressSink;

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
}

impl Ctx {
    /// Build the run context from parsed arguments.
    pub fn from_args(args: Args, env: EnvInfo, checkpoint: Checkpoint) -> Self {
        let force = args.force;
        Ctx {
            args,
            env,
            checkpoint,
            failures: FailureAccumulator::new(),
            force,
            progress: ProgressSink::default(),
        }
    }

    /// A minimal context for unit tests.
    pub fn for_test(checkpoint: Checkpoint) -> Self {
        Ctx::from_args(Args::default(), EnvInfo::probe(), checkpoint)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_args_carries_force() {
        let a = Args {
            force: true,
            ..Args::default()
        };
        let ctx = Ctx::from_args(a, EnvInfo::probe(), Checkpoint::new());
        assert!(ctx.force);
        assert!(ctx.failures.is_clean());
    }
}
