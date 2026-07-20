//! The deploy flow: the interactive wizard + the turnkey state machine that
//! self-hosts the ADOS cloud stack.
//!
//! Runs the wizard stages (or builds the config from flags), then either prints
//! the `--plan` dry-run or executes the ordered, idempotent `graph`-driven state
//! machine (preflight → write config → up Convex → wait → admin key → push
//! functions → auth keys → MQTT passwd → up the rest → verify) with live progress
//! in the split view, finishing with a verified reach-links card.

pub mod lifecycle;
pub mod plan;
pub mod steps;

use std::path::Path;
use std::time::Duration;

use crate::cli::Args;
use crate::ctx::Ctx;
use crate::docker;
use crate::graph::run_graph;
use crate::shell;
use crate::ui::tty::Tty;
use crate::ui::{self, RenderMode, Theme};
use crate::wizard::screens;
use crate::wizard::state::DeployConfig;
use plan::Plan;

/// Run the deploy wizard (or non-interactive build) and then plan/execute.
pub fn run_wizard(theme: &Theme, repo_root: &Path, args: &Args) -> anyhow::Result<()> {
    let interactive = !args.plan && !args.non_interactive && Tty::is_available();
    let cfg: DeployConfig = if interactive {
        match screens::run(theme, args, repo_root)? {
            Some(c) => c,
            None => {
                println!("{}", theme.dim("Cancelled — nothing was changed."));
                return Ok(());
            }
        }
    } else {
        screens::config_from_args(args, repo_root)
    };

    if args.plan {
        Plan::build(&cfg).render(theme);
        return Ok(());
    }

    // Pause for Enter at the end only when a human is watching: a scripted /
    // non-interactive / --yes run returns immediately.
    let pause = !args.non_interactive && !args.yes && Tty::is_available();
    execute(theme, repo_root, &cfg, ui::detect_mode(args), pause)
}

/// Run the deploy state machine for a prepared config (no wizard). Used by
/// Upgrade, which reconstructs the config from the deployed `.env` and re-runs
/// the idempotent graph so functions are re-pushed and env re-set.
pub fn deploy_config(theme: &Theme, repo_root: &Path, cfg: &DeployConfig) -> anyhow::Result<()> {
    execute(theme, repo_root, cfg, RenderMode::Rich, true)
}

/// Execute the deploy as the ordered step machine with live progress, then print
/// the reach-links completion card.
fn execute(
    theme: &Theme,
    repo_root: &Path,
    cfg: &DeployConfig,
    base_mode: RenderMode,
    pause: bool,
) -> anyhow::Result<()> {
    let (mode, tty) = ui::resolve_live_mode(base_mode, None);
    let (sink, handle) = ui::start(
        mode,
        "Deploying the ADOS stack…".to_string(),
        *theme,
        tty,
        ui::DEPLOY_GROUPS,
        ui::DEPLOY_FOOTER,
    );

    let mut ctx = Ctx::for_deploy(cfg.clone(), repo_root.to_path_buf(), sink.clone());
    let reports = run_graph(steps::build_steps(), &mut ctx);
    sink.finish();
    handle.finish();

    let status = ctx.failures.derive_status();
    print_completion(theme, cfg, &status, &reports, pause);
    Ok(())
}

/// Print the completion card on the primary buffer: status, verified reach
/// links, and next steps. Health is re-probed so the URLs shown are proven
/// reachable, not assumed (Rule 44).
fn print_completion(
    theme: &Theme,
    cfg: &DeployConfig,
    status: &str,
    reports: &[crate::graph::StepReport],
    pause: bool,
) {
    println!();
    match status {
        "ok" => println!(
            "{}  {}",
            theme.ok(theme.glyph_ok()),
            theme.heading("Your ADOS stack is live")
        ),
        "degraded" => println!(
            "{}  {}",
            theme.warn("!"),
            theme.heading("Deployed — some services are still warming up")
        ),
        _ => {
            println!(
                "{}  {}",
                theme.fail(theme.glyph_fail()),
                theme.heading("Deploy did not complete")
            );
            for r in reports {
                if let crate::graph::StepOutcome::Failed(msg) = &r.outcome {
                    println!(
                        "  {} {}: {}",
                        theme.fail(theme.glyph_fail()),
                        r.id,
                        theme.dim(msg)
                    );
                }
            }
            println!(
                "\n{}",
                theme.dim("Fix the issue above and re-run — the deploy is idempotent.")
            );
            if pause {
                shell::pause_for_enter(theme);
            }
            return;
        }
    }

    println!("\n{}", theme.heading("Open Mission Control"));
    reach_row(theme, "Mission Control", &cfg.gcs_url(), cfg.gcs);
    reach_row(
        theme,
        "Convex dashboard",
        &cfg.dashboard_url(),
        !cfg.convex.is_managed(),
    );
    reach_row(
        theme,
        "Video relay",
        &format!("http://{}:{}", cfg.host, cfg.ports.video),
        !cfg.video.is_managed(),
    );
    let mqtt_ok = if cfg.mqtt.is_managed() {
        true
    } else {
        docker::tcp_open(&cfg.host, cfg.ports.mqtt_tcp, Duration::from_secs(2))
    };
    println!(
        "  {} {:<18} {}",
        dot(theme, mqtt_ok),
        theme.bold("MQTT broker"),
        theme.dim(&format!("{}:{}", cfg.host, cfg.ports.mqtt_ws))
    );

    if matches!(cfg.tls, crate::wizard::state::Tls::HttpLan) {
        println!(
            "\n{}",
            theme.dim("HTTP on the LAN: browser cloud mode stays off; add a tunnel for internet fleet control.")
        );
    }
    println!(
        "{}",
        theme.dim("Direct IP is the most reliable reach. Pair a drone by hostname/IP in the Add-a-Node card.")
    );
    if pause {
        shell::pause_for_enter(theme);
    }
}

/// One reach-links row with a verified health dot + the full copyable URL.
fn reach_row(theme: &Theme, label: &str, url: &str, applicable: bool) {
    if !applicable {
        return;
    }
    let ok = docker::http_ok(url);
    println!(
        "  {} {:<18} {}",
        dot(theme, ok),
        theme.bold(label),
        theme.accent(url)
    );
}

fn dot(theme: &Theme, ok: bool) -> String {
    if ok {
        theme.ok(theme.dot_filled())
    } else {
        theme.dim(theme.dot_empty())
    }
}
