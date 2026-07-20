//! The deploy flow: the interactive wizard + the turnkey state machine that
//! self-hosts the ADOS cloud stack.
//!
//! Phase 2 (this): run the wizard stages (`wizard::screens`) or build the config
//! from flags, then either print the `--plan` dry-run or hand off to the state
//! machine. Phase 3 replaces the placeholder execution with the ordered,
//! idempotent `graph`-driven state machine rendered in the split view.

pub mod plan;

use std::path::Path;

use crate::cli::Args;
use crate::shell;
use crate::ui::tty::Tty;
use crate::ui::Theme;
use crate::wizard::screens;
use crate::wizard::state::DeployConfig;
use plan::Plan;

/// Run the deploy wizard (or non-interactive build) and then plan/execute.
pub fn run_wizard(theme: &Theme, repo_root: &Path, args: &Args) -> anyhow::Result<()> {
    // The interactive wizard runs only for a real deploy on a terminal;
    // `--plan` / `--non-interactive` build the config from flags + defaults.
    let interactive = !args.plan && !args.non_interactive && Tty::is_available();
    let cfg: DeployConfig = if interactive {
        match screens::run(theme, args)? {
            Some(c) => c,
            None => {
                println!("{}", theme.dim("Cancelled — nothing was changed."));
                return Ok(());
            }
        }
    } else {
        screens::config_from_args(args)
    };

    let plan = Plan::build(&cfg);

    if args.plan {
        plan.render(theme);
        return Ok(());
    }

    // Phase 3 executes this plan as the ordered, idempotent state machine with
    // live progress. Until then, show what would run and how to preview it.
    execute(theme, repo_root, &cfg, &plan)
}

/// Placeholder executor — Phase 3 replaces this with the `graph`-driven turnkey
/// state machine (preflight → up Convex → admin key → push functions → auth keys
/// → mosquitto passwd → up the rest → verify → reach-links card).
fn execute(
    theme: &Theme,
    _repo_root: &Path,
    _cfg: &DeployConfig,
    plan: &Plan,
) -> anyhow::Result<()> {
    plan.render(theme);
    println!(
        "\n{}",
        theme.warn("The turnkey executor lands in the next build step.")
    );
    println!(
        "{}",
        theme.dim("Preview the exact commands + files any time with:  ados-deploy deploy --plan")
    );
    shell::pause_for_enter(theme);
    Ok(())
}
