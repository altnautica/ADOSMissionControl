//! The resolved run mode: what the deployer will do this invocation.

use crate::cli::Args;

/// What the deployer does this run, resolved from the action arg + the
/// deployed-state probe (done later, at dispatch).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunMode {
    /// Interactive top-level menu (no action given).
    Menu,
    /// Run the deploy wizard + state machine.
    Deploy,
    /// Re-open the wizard pre-filled from an existing `.env`.
    Reconfigure,
    /// `docker compose pull` + rebuild + restart.
    Upgrade,
    /// `docker compose restart`.
    Restart,
    /// `docker compose down` (with an opt-in volume purge).
    Teardown,
    /// Print the deployed-stack status + reach links.
    Status,
}

impl RunMode {
    /// Resolve the mode from the action argument. An unknown/absent action is
    /// the interactive menu.
    pub fn from_action(args: &Args) -> RunMode {
        match args.action.as_deref() {
            Some("deploy") => RunMode::Deploy,
            Some("reconfigure") => RunMode::Reconfigure,
            Some("upgrade") => RunMode::Upgrade,
            Some("restart") => RunMode::Restart,
            Some("teardown") | Some("down") => RunMode::Teardown,
            Some("status") => RunMode::Status,
            _ => RunMode::Menu,
        }
    }

    /// Whether this mode clears resume checkpoints before running (upgrade
    /// re-runs the container bring-up + verify even if a prior deploy marked
    /// them, because images/config changed).
    pub fn clears_checkpoints(&self) -> bool {
        matches!(self, RunMode::Upgrade)
    }
}
