//! The top-level menu — the first screen, in the installer's house style.
//!
//! Immediately-useful actions (run the web GCS, demo, build/run the desktop app,
//! a system check, the drone-agent install one-liner) shell out via Pattern A
//! (leave the alt screen, run the real command, return). "Deploy the stack"
//! routes to the guided deploy flow. The menu is data-driven so later phases add
//! rows (Manage services, Edit configuration, Show reach links) with no reshape.

use std::path::Path;

use crate::cli::Args;
use crate::deploy;
use crate::shell;
use crate::ui::tty::Tty;
use crate::ui::Theme;
use crate::wizard::widgets::{select_list, Choice, Flow};

/// A top-level action.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Action {
    Deploy,
    WebGcs,
    Demo,
    DesktopBuild,
    DesktopDev,
    SystemCheck,
    InstallAgent,
    Quit,
}

/// The menu rows, in display order. `(label, hint, action)`.
const ITEMS: &[(&str, &str, Action)] = &[
    (
        "Deploy the stack",
        "self-host Convex + Mission Control + MQTT + video",
        Action::Deploy,
    ),
    (
        "Run web GCS",
        "start Mission Control in dev on :4000",
        Action::WebGcs,
    ),
    (
        "Run demo mode",
        "Mission Control with a simulated fleet",
        Action::Demo,
    ),
    (
        "Build desktop app",
        "package the Electron app for macOS / Windows / Linux",
        Action::DesktopBuild,
    ),
    (
        "Run dev desktop app",
        "the Electron app in dev mode",
        Action::DesktopDev,
    ),
    (
        "System check",
        "Docker, Node, and toolchain prerequisites",
        Action::SystemCheck,
    ),
    (
        "Install ADOS on a drone/SBC",
        "the one-line drone/ground agent installer",
        Action::InstallAgent,
    ),
    ("Quit", "", Action::Quit),
];

/// Run the interactive menu loop until the operator quits. On a non-terminal
/// (CI / piped) the menu is unavailable; the caller should use an action arg.
pub fn run(theme: &Theme, repo_root: &Path, args: &Args) -> anyhow::Result<()> {
    if !Tty::is_available() {
        println!(
            "{}",
            theme.dim(
                "No interactive terminal. Try `ados-deploy deploy` or `ados-deploy deploy --plan`."
            )
        );
        return Ok(());
    }
    let mut default = 0usize;
    loop {
        let choices: Vec<Choice> = ITEMS
            .iter()
            .map(|(label, hint, _)| {
                Choice::new(
                    label,
                    label,
                    if hint.is_empty() { None } else { Some(hint) },
                )
            })
            .collect();

        let picked = {
            let mut tty = match Tty::open()? {
                Some(t) => t,
                None => return Ok(()),
            };
            tty.set_chrome(0, 0, "");
            match select_list(
                &mut tty,
                theme,
                "Altnautica ADOS",
                "What would you like to do?",
                &choices,
                default,
            ) {
                Flow::Value(i) => i,
                Flow::Back | Flow::Abort => return Ok(()),
            }
            // `tty` drops here → leaves the alt screen before any shell-out.
        };
        default = picked;

        match ITEMS[picked].2 {
            Action::Quit => return Ok(()),
            Action::Deploy => deploy::run_wizard(theme, repo_root, args)?,
            Action::WebGcs => npm_action(theme, repo_root, "Run web GCS (dev)", "dev"),
            Action::Demo => npm_action(theme, repo_root, "Run demo mode", "demo"),
            Action::DesktopDev => {
                npm_action(theme, repo_root, "Run dev desktop app", "desktop:dev")
            }
            Action::DesktopBuild => desktop_build(theme, repo_root),
            Action::SystemCheck => system_check(theme),
            Action::InstallAgent => install_agent_oneliner(theme),
        }
    }
}

/// Shell out to `npm run <script>` in the repo root (Pattern A).
fn npm_action(theme: &Theme, repo_root: &Path, title: &str, script: &str) {
    shell::banner(theme, title, "npm", &["run", script]);
    println!(
        "{}\n",
        theme.dim("Press Ctrl-C in the server to stop it and return to the menu.")
    );
    let outcome = shell::run_foreground("npm", &["run", script], repo_root, &[]);
    shell::report_and_pause(theme, outcome);
}

/// Sub-select the desktop build target (host OS default) then build it.
fn desktop_build(theme: &Theme, repo_root: &Path) {
    let host_default = match std::env::consts::OS {
        "windows" => 1,
        "linux" => 2,
        _ => 0,
    };
    let targets = [
        ("macOS (.dmg)", "desktop:build:mac"),
        ("Windows (.exe)", "desktop:build:win"),
        ("Linux (.AppImage)", "desktop:build:linux"),
    ];
    let picked = {
        let mut tty = match Tty::open() {
            Ok(Some(t)) => t,
            _ => return,
        };
        tty.set_chrome(0, 0, "");
        let choices: Vec<Choice> = targets
            .iter()
            .map(|(label, _)| Choice::new(label, label, None))
            .collect();
        match select_list(
            &mut tty,
            theme,
            "Build desktop app",
            "Which platform do you want to build for?",
            &choices,
            host_default,
        ) {
            Flow::Value(i) => Some(i),
            Flow::Back | Flow::Abort => None,
        }
    };
    let Some(i) = picked else { return };
    let script = targets[i].1;
    shell::banner(
        theme,
        &format!("Build desktop app · {}", targets[i].0),
        "npm",
        &["run", script],
    );
    println!(
        "{}\n",
        theme.dim("Installers are written to release/. First build downloads Electron and can take a few minutes.")
    );
    let outcome = shell::run_foreground("npm", &["run", script], repo_root, &[]);
    shell::report_and_pause(theme, outcome);
}

/// Probe the prerequisite toolchain and report each with an ok/fail glyph.
fn system_check(theme: &Theme) {
    println!(
        "\n{}  {}",
        theme.accent("▌ ADOS"),
        theme.heading("System check")
    );
    println!();
    let checks: &[(&str, &str, &[&str])] = &[
        ("Docker", "docker", &["--version"]),
        ("Docker Compose", "docker", &["compose", "version"]),
        (
            "Docker daemon",
            "docker",
            &["info", "--format", "{{.ServerVersion}}"],
        ),
        ("Node.js", "node", &["--version"]),
        ("npm", "npm", &["--version"]),
        ("git", "git", &["--version"]),
    ];
    for (label, program, args) in checks {
        match probe(program, args) {
            Some(v) => println!(
                "  {} {:<16} {}",
                theme.ok(theme.glyph_ok()),
                label,
                theme.dim(&v)
            ),
            None => println!(
                "  {} {:<16} {}",
                theme.fail(theme.glyph_fail()),
                label,
                theme.warn("not available")
            ),
        }
    }
    println!(
        "\n{}",
        theme.dim("Docker (with the daemon running) + Node 20+ are required to deploy the stack.")
    );
    shell::pause_for_enter(theme);
}

/// Run `program args…`, returning the first non-empty stdout line on success.
fn probe(program: &str, args: &[&str]) -> Option<String> {
    let out = std::process::Command::new(program)
        .args(args)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout);
    s.lines()
        .find(|l| !l.trim().is_empty())
        .map(|l| l.trim().to_string())
}

/// Print the one-line drone/ground agent installer (the agent has its own
/// installer; the deployer only points at it).
fn install_agent_oneliner(theme: &Theme) {
    println!(
        "\n{}  {}",
        theme.accent("▌ ADOS"),
        theme.heading("Install the ADOS agent on a drone or SBC")
    );
    println!(
        "\n{}",
        theme.dim(
            "Run this on the freshly-flashed board (it self-detects the hardware and profile):"
        )
    );
    println!(
        "\n  {}",
        theme.accent("curl -sSL https://raw.githubusercontent.com/altnautica/ADOSDroneAgent/main/scripts/install.sh | sudo bash")
    );
    println!(
        "\n{}",
        theme.dim("The board then pairs to this Mission Control over the LAN (local-first).")
    );
    shell::pause_for_enter(theme);
}
