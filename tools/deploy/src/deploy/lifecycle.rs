//! Managing an already-deployed stack: status, logs, restart, upgrade, and a
//! guarded teardown. Reads the deployed state from `tools/selfhost/.env` +
//! `docker compose ps`, and drives compose lifecycle commands via Pattern A.

use std::path::Path;

use crate::docker;
use crate::shell;
use crate::ui::tty::Tty;
use crate::ui::Theme;
use crate::wizard::widgets::{confirm_card, select_list, Choice, Flow};

/// The self-host `.env` path relative to the repo root.
const ENV_REL: &str = "tools/selfhost/.env";

/// Whether a stack has been deployed from this repo (the generated `.env` exists).
pub fn is_deployed(repo_root: &Path) -> bool {
    repo_root.join(ENV_REL).is_file()
}

/// The "Manage running stack" submenu loop.
pub fn manage(theme: &Theme, repo_root: &Path) {
    if !is_deployed(repo_root) {
        println!(
            "\n{}",
            theme.dim(
                "No stack has been deployed from this repo yet. Run \"Deploy the stack\" first."
            )
        );
        shell::pause_for_enter(theme);
        return;
    }
    let items: &[(&str, &str, Op)] = &[
        ("Status", "containers + reach links", Op::Status),
        ("Logs", "follow all service logs", Op::Logs),
        ("Restart", "restart every service", Op::Restart),
        ("Stop", "stop the stack (keeps data)", Op::Stop),
        ("Upgrade", "pull images + rebuild + restart", Op::Upgrade),
        ("Teardown", "stop + remove containers", Op::Teardown),
        ("Back", "", Op::Back),
    ];
    let mut default = 0usize;
    loop {
        let picked = {
            let mut tty = match Tty::open() {
                Ok(Some(t)) => t,
                _ => return,
            };
            tty.set_chrome(0, 0, "");
            let choices: Vec<Choice> = items
                .iter()
                .map(|(l, h, _)| Choice::new(l, l, if h.is_empty() { None } else { Some(h) }))
                .collect();
            match select_list(
                &mut tty,
                theme,
                "Manage stack",
                "Manage the running stack",
                &choices,
                default,
            ) {
                Flow::Value(i) => i,
                Flow::Back | Flow::Abort => return,
            }
        };
        default = picked;
        match items[picked].2 {
            Op::Back => return,
            Op::Status => status(theme, repo_root),
            Op::Logs => {
                shell::banner(theme, "Stack logs", "docker compose", &["logs", "-f"]);
                println!(
                    "{}\n",
                    theme.dim("Press Ctrl-C to stop following and return.")
                );
                // Follow logs via Pattern A (long-running; Ctrl-C returns here).
                let (prog, args) = compose_shell(repo_root, &["logs", "-f"]);
                let refs: Vec<&str> = args.iter().map(String::as_str).collect();
                let outcome = shell::run_foreground(&prog, &refs, repo_root, &[]);
                shell::report_and_pause(theme, outcome);
            }
            Op::Restart => run_compose(theme, repo_root, "Restart", &["restart"]),
            Op::Stop => run_compose(theme, repo_root, "Stop", &["stop"]),
            Op::Upgrade => {
                run_compose(theme, repo_root, "Pull images", &["pull"]);
                run_compose(
                    theme,
                    repo_root,
                    "Rebuild + restart",
                    &["up", "-d", "--build"],
                );
            }
            Op::Teardown => teardown(theme, repo_root),
        }
    }
}

#[derive(Clone, Copy)]
enum Op {
    Status,
    Logs,
    Restart,
    Stop,
    Upgrade,
    Teardown,
    Back,
}

/// Print `docker compose ps` + the reach links read from `.env`.
pub fn status(theme: &Theme, repo_root: &Path) {
    println!(
        "\n{}  {}",
        theme.accent("▌ ADOS"),
        theme.heading("Stack status")
    );
    let res = docker::compose_capture(repo_root, &["ps"]);
    if res.success() {
        for line in res.stdout.lines() {
            println!("  {}", theme.dim(line));
        }
    } else {
        println!(
            "  {}",
            theme.warn("could not read container status (is Docker running?)")
        );
    }
    if let Some(urls) = reach_urls(repo_root) {
        println!("\n{}", theme.heading("Reach links"));
        for (label, url) in urls {
            println!(
                "  {} {:<18} {}",
                theme.accent("➜"),
                theme.bold(&label),
                theme.accent(&url)
            );
        }
    }
    shell::pause_for_enter(theme);
}

/// A guarded teardown: `down`, with an opt-in (default-No) data-volume purge.
fn teardown(theme: &Theme, repo_root: &Path) {
    let purge = {
        let mut tty = match Tty::open() {
            Ok(Some(t)) => t,
            _ => return,
        };
        tty.set_chrome(0, 0, "");
        let detail = vec![
            theme.dim("Stops + removes the containers. Your data volumes (the Convex"),
            theme.dim("database, MQTT state) are kept unless you also purge them."),
        ];
        match confirm_card(
            &mut tty,
            theme,
            "Teardown",
            "Also delete the data volumes? This ERASES the Convex database.",
            &detail,
            "Keep data",
            "Delete everything",
            true,
        ) {
            Flow::Value(true) => false, // keep data
            Flow::Value(false) => true, // purge
            Flow::Back | Flow::Abort => return,
        }
    };
    if purge {
        run_compose(
            theme,
            repo_root,
            "Teardown + purge volumes",
            &["down", "--volumes"],
        );
    } else {
        run_compose(theme, repo_root, "Teardown", &["down"]);
    }
}

/// Run a compose subcommand via Pattern A and report the outcome.
fn run_compose(theme: &Theme, repo_root: &Path, title: &str, args: &[&str]) {
    let (prog, full) = compose_shell(repo_root, args);
    shell::banner(
        theme,
        title,
        &prog,
        &full.iter().map(String::as_str).collect::<Vec<_>>(),
    );
    let refs: Vec<&str> = full.iter().map(String::as_str).collect();
    let outcome = shell::run_foreground(&prog, &refs, repo_root, &[]);
    shell::report_and_pause(theme, outcome);
}

/// The (program, args) for `docker compose -f <file> <extra…>` as owned strings.
fn compose_shell(_repo_root: &Path, extra: &[&str]) -> (String, Vec<String>) {
    let mut args = vec![
        "compose".to_string(),
        "-f".to_string(),
        docker::COMPOSE_REL.to_string(),
    ];
    args.extend(extra.iter().map(|s| s.to_string()));
    ("docker".to_string(), args)
}

/// Read the reach URLs from the generated `.env` (best-effort).
fn reach_urls(repo_root: &Path) -> Option<Vec<(String, String)>> {
    let text = std::fs::read_to_string(repo_root.join(ENV_REL)).ok()?;
    let get = |key: &str| {
        text.lines()
            .find_map(|l| l.strip_prefix(&format!("{key}=")))
            .map(|v| v.trim().to_string())
    };
    let gcs = get("NEXT_PUBLIC_CONVEX_URL")?;
    // Derive the GCS origin (:4000) from the host in the Convex URL.
    let host = gcs
        .trim_start_matches("http://")
        .trim_start_matches("https://")
        .split(':')
        .next()
        .unwrap_or("127.0.0.1")
        .to_string();
    Some(vec![
        ("Mission Control".to_string(), format!("http://{host}:4000")),
        (
            "Convex dashboard".to_string(),
            format!("http://{host}:6791"),
        ),
        ("Video relay".to_string(), format!("http://{host}:3001")),
    ])
}
