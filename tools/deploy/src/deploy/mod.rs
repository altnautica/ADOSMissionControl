//! The deploy flow: the interactive wizard + the turnkey state machine that
//! self-hosts the ADOS cloud stack.
//!
//! Phase 2 builds the wizard stages (`wizard::state` + `wizard::screens`) and the
//! `--plan` dry-run; Phase 3 builds the ordered, idempotent state machine
//! (`deploy::steps` on the `graph` engine) with live progress in the split view.
//! Until then this is the wired entry point the menu + a `deploy` action call.

use std::path::Path;

use crate::cli::Args;
use crate::shell;
use crate::ui::Theme;

/// Run the deploy wizard + state machine against the repo at `repo_root`.
pub fn run_wizard(theme: &Theme, _repo_root: &Path, _args: &Args) -> anyhow::Result<()> {
    // Placeholder wiring — Phase 2 replaces this body with the wizard stages
    // and Phase 3 with the turnkey deploy state machine.
    println!(
        "\n{}",
        theme.heading("Deploy the full ADOS stack (Convex + Mission Control + MQTT + video)")
    );
    println!(
        "{}",
        theme.dim("The guided wizard is being assembled. Preview the plan with:")
    );
    println!("{}", theme.accent("  ados-deploy deploy --plan"));
    shell::pause_for_enter(theme);
    Ok(())
}
