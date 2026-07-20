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
        not_deployed(theme);
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
            Op::Restart => restart(theme, repo_root),
            Op::Stop => run_compose(theme, repo_root, "Stop", &["stop"]),
            Op::Upgrade => upgrade(theme, repo_root),
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

/// Restart every service (compose `restart`).
pub fn restart(theme: &Theme, repo_root: &Path) {
    if !is_deployed(repo_root) {
        not_deployed(theme);
        return;
    }
    run_compose(theme, repo_root, "Restart", &["restart"]);
}

/// Upgrade: pull newer images, then re-run the idempotent deploy graph so images
/// rebuild, Convex functions re-push, and env re-sets — reconstructing the config
/// from the deployed `.env` so it targets the same backend. This is why upgrade
/// runs the graph rather than a bare `up -d` (which would never re-push changed
/// functions).
pub fn upgrade(theme: &Theme, repo_root: &Path) {
    if !is_deployed(repo_root) {
        not_deployed(theme);
        return;
    }
    run_compose(theme, repo_root, "Pull images", &["pull"]);
    match crate::wizard::screens::config_from_env(repo_root) {
        Some(cfg) => {
            let _ = crate::deploy::deploy_config(theme, repo_root, &cfg);
        }
        None => {
            println!(
                "\n{}",
                theme.warn(
                    "could not read the deployed config from .env — re-run \"Deploy the stack\"."
                )
            );
            shell::pause_for_enter(theme);
        }
    }
}

/// The "not deployed yet" notice + pause.
fn not_deployed(theme: &Theme) {
    println!(
        "\n{}",
        theme.dim("No stack has been deployed from this repo yet. Run \"Deploy the stack\" first.")
    );
    shell::pause_for_enter(theme);
}

/// A guarded teardown: `down`, with an opt-in (default-No) data-volume purge.
pub fn teardown(theme: &Theme, repo_root: &Path) {
    if !is_deployed(repo_root) {
        not_deployed(theme);
        return;
    }
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

/// The (program, args) for `docker compose -f <file> [-f <override>] <extra…>`
/// as owned strings, layering the port-remap override when it exists (so a
/// custom-port stack's lifecycle commands act on the right containers).
fn compose_shell(repo_root: &Path, extra: &[&str]) -> (String, Vec<String>) {
    let mut args = vec![
        "compose".to_string(),
        "-f".to_string(),
        docker::COMPOSE_REL.to_string(),
    ];
    if repo_root.join(docker::OVERRIDE_REL).exists() {
        args.push("-f".to_string());
        args.push(docker::OVERRIDE_REL.to_string());
    }
    args.extend(extra.iter().map(|s| s.to_string()));
    ("docker".to_string(), args)
}

/// The reach URLs for the deployed stack, reconstructed from `.env` + the port
/// override. Uses the real local host (from `CONVEX_CLOUD_ORIGIN`, not the
/// possibly-managed `NEXT_PUBLIC_CONVEX_URL`) and the custom ports, and omits the
/// Convex dashboard link when Convex is managed (there is no local dashboard).
fn reach_urls(repo_root: &Path) -> Option<Vec<(String, String)>> {
    let cfg = crate::wizard::screens::config_from_env(repo_root)?;
    let mut urls = vec![("Mission Control".to_string(), cfg.gcs_url())];
    if !cfg.convex.is_managed() {
        urls.push(("Convex dashboard".to_string(), cfg.dashboard_url()));
    }
    urls.push((
        "Video relay".to_string(),
        format!("http://{}:{}", cfg.host, cfg.ports.video),
    ));
    Some(urls)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_env(root: &Path, body: &str) {
        let sh = root.join("tools/selfhost");
        std::fs::create_dir_all(&sh).unwrap();
        std::fs::write(sh.join(".env"), body).unwrap();
    }

    #[test]
    fn reach_urls_spin_up_includes_dashboard_at_local_host() {
        let dir = tempfile::tempdir().unwrap();
        write_env(
            dir.path(),
            "CONVEX_CLOUD_ORIGIN=http://192.168.1.50:3210\n\
             NEXT_PUBLIC_CONVEX_URL=http://192.168.1.50:3210\n\
             CONVEX_INSTANCE_SECRET=x\nMQTT_PASSWORD=y\n",
        );
        let urls = reach_urls(dir.path()).unwrap();
        assert!(urls.iter().any(|(l, _)| l == "Convex dashboard"));
        assert!(urls
            .iter()
            .any(|(l, u)| l == "Mission Control" && u == "http://192.168.1.50:4000"));
    }

    #[test]
    fn reach_urls_managed_convex_omits_dashboard_and_keeps_local_host() {
        let dir = tempfile::tempdir().unwrap();
        // Managed Convex: the browser URL is the managed domain, but the local
        // host (from CONVEX_CLOUD_ORIGIN) still fronts the GCS + video.
        write_env(
            dir.path(),
            "CONVEX_CLOUD_ORIGIN=http://192.168.1.50:3210\n\
             NEXT_PUBLIC_CONVEX_URL=https://convex.example.com\n\
             CONVEX_INSTANCE_SECRET=x\nMQTT_PASSWORD=y\n",
        );
        let urls = reach_urls(dir.path()).unwrap();
        assert!(
            !urls.iter().any(|(l, _)| l == "Convex dashboard"),
            "a managed Convex has no local dashboard to link"
        );
        assert!(urls
            .iter()
            .any(|(l, u)| l == "Mission Control" && u.contains("192.168.1.50")));
        assert!(
            !urls.iter().any(|(_, u)| u.contains("convex.example.com")),
            "reach links must use the local host, not the managed Convex domain"
        );
    }
}
