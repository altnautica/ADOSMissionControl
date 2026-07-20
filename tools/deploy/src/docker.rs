//! The docker / process layer: compose-command detection, streaming runners
//! (with a working directory + scoped environment), and localhost health polls.

use std::net::{TcpStream, ToSocketAddrs};
use std::path::Path;
use std::process::Command;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use crate::exec::{self, CmdResult};

/// The compose file, relative to the repo root (commands run with cwd = root).
pub const COMPOSE_REL: &str = "tools/selfhost/docker-compose.yml";

/// The port-remap override, relative to the repo root. Written only when ports
/// are customized; layered in via a second `-f` when it exists.
pub const OVERRIDE_REL: &str = "tools/selfhost/docker-compose.override.yml";

/// `(program, base args)` for compose — Docker Compose v2 (`docker compose`)
/// preferred, falling back to the v1 standalone `docker-compose`. Detected once.
fn compose_base() -> &'static (String, Vec<String>) {
    static C: OnceLock<(String, Vec<String>)> = OnceLock::new();
    C.get_or_init(|| {
        if exec::run_ok("docker", &["compose", "version"]) {
            ("docker".to_string(), vec!["compose".to_string()])
        } else {
            ("docker-compose".to_string(), vec![])
        }
    })
}

/// The `docker` CLI is present.
pub fn docker_present() -> bool {
    exec::run_ok("docker", &["--version"])
}

/// The Docker daemon is reachable (distinguishes "installed" from "not running").
pub fn is_docker_running() -> bool {
    exec::run_ok("docker", &["info", "--format", "{{.ServerVersion}}"])
}

/// Build a compose `Command` (`docker compose -f <file> [-f <override>] <extra…>`,
/// cwd = root). The port-remap override is layered in with a second `-f` whenever
/// it exists on disk, so a custom-port deploy actually binds the chosen ports
/// (without it, compose reads only the base file and ignores the remaps).
pub fn compose_command(repo_root: &Path, extra: &[&str]) -> Command {
    let (prog, base) = compose_base();
    let mut cmd = Command::new(prog);
    cmd.args(base).arg("-f").arg(COMPOSE_REL);
    if repo_root.join(OVERRIDE_REL).exists() {
        cmd.arg("-f").arg(OVERRIDE_REL);
    }
    cmd.args(extra);
    cmd.current_dir(repo_root);
    cmd
}

/// Run a compose subcommand, streaming each line to `on_line`.
pub fn compose_streamed<F: FnMut(&str)>(repo_root: &Path, extra: &[&str], on_line: F) -> CmdResult {
    exec::run_streamed_cmd(compose_command(repo_root, extra), on_line)
}

/// Run a compose subcommand, capturing the output (no live display).
pub fn compose_capture(repo_root: &Path, extra: &[&str]) -> CmdResult {
    exec::run_streamed_cmd(compose_command(repo_root, extra), |_| {})
}

/// Run `program args…` with `cwd` + extra env vars, streaming lines to `on_line`.
pub fn streamed_in<F: FnMut(&str)>(
    program: &str,
    args: &[&str],
    cwd: &Path,
    envs: &[(&str, &str)],
    on_line: F,
) -> CmdResult {
    let mut cmd = Command::new(program);
    cmd.args(args).current_dir(cwd);
    for (k, v) in envs {
        cmd.env(k, v);
    }
    exec::run_streamed_cmd(cmd, on_line)
}

/// Build a `Command` targeting a SELF-HOSTED Convex backend via the current CLI
/// convention (env-var targeting) with a CLEAN env: the two self-hosted vars are
/// set and the cloud vars (`CONVEX_URL` / `CONVEX_DEPLOY_KEY`) are removed, or the
/// CLI refuses a cloud+self-hosted mix.
pub fn convex_command(
    program: &str,
    args: &[&str],
    cwd: &Path,
    self_hosted_url: &str,
    admin_key: &str,
) -> Command {
    // `node_command` resolves the `.cmd` shim on Windows (`npx` won't spawn via a
    // bare `Command::new`); on unix it is a plain `Command::new(program)`.
    let mut cmd = exec::node_command(program, args);
    cmd.current_dir(cwd);
    cmd.env_remove("CONVEX_URL");
    cmd.env_remove("CONVEX_DEPLOY_KEY");
    cmd.env("CONVEX_SELF_HOSTED_URL", self_hosted_url);
    cmd.env("CONVEX_SELF_HOSTED_ADMIN_KEY", admin_key);
    cmd
}

/// Whether an HTTP GET of `url` reaches a live server. A 2xx/3xx is up; a 4xx/5xx
/// is ALSO up — the server answered, it just returned a non-2xx (a self-hosted
/// Convex replies 404/426 to a bare GET, the video relay 404s `/`). Only a
/// transport error (connection refused / timeout / DNS) counts as down.
pub fn http_ok(url: &str) -> bool {
    match ureq::get(url).timeout(Duration::from_secs(3)).call() {
        Ok(_) => true,
        Err(ureq::Error::Status(_, _)) => true,
        Err(ureq::Error::Transport(_)) => false,
    }
}

/// Poll `url` until it answers OK or `timeout` elapses, ticking every 2s. Returns
/// whether it became reachable. `on_tick(elapsed_secs)` drives a progress label.
pub fn wait_http_ok<F: FnMut(u64)>(url: &str, timeout: Duration, mut on_tick: F) -> bool {
    let deadline = Instant::now() + timeout;
    let mut secs = 0u64;
    loop {
        if http_ok(url) {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_secs(2));
        secs += 2;
        on_tick(secs);
    }
}

/// Whether a TCP connection to `host:port` succeeds within `timeout`.
pub fn tcp_open(host: &str, port: u16, timeout: Duration) -> bool {
    let addr = format!("{host}:{port}");
    match addr.to_socket_addrs() {
        Ok(mut addrs) => addrs.any(|a| TcpStream::connect_timeout(&a, timeout).is_ok()),
        Err(_) => false,
    }
}

/// Poll a TCP port until it accepts a connection or `timeout` elapses, ticking
/// every 2s. Returns whether it opened. Used by the verify step to give a
/// just-started broker a moment to bind before judging it down.
pub fn wait_tcp_open(host: &str, port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if tcp_open(host, port, Duration::from_secs(2)) {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_secs(2));
    }
}
