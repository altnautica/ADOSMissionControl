//! Pattern-A shell-out: leave the alternate screen, run an existing command with
//! the real terminal inherited (so its own output + prompts are visible), then
//! return to the menu.
//!
//! A foreground child that owns Ctrl-C — `npm run dev` (blocks until the operator
//! stops it), `docker compose logs -f`, an interactive `docker compose down` —
//! must receive SIGINT itself while the parent (this menu) ignores it, so Ctrl-C
//! stops the child and drops back to the menu instead of killing the whole tool.
//! On unix a [`SignalGuard`] SIG_IGNs SIGINT+SIGQUIT in the parent for the child's
//! lifetime and the child resets them to SIG_DFL via `pre_exec`.
//!
//! Known Windows limitation: a console `CTRL_C_EVENT` is delivered to every
//! process in the foreground group, so Ctrl-C during a shell-out ends the whole
//! tool rather than just the child. Isolating it needs a `SetConsoleCtrlHandler`
//! guard (a Windows-API dependency), deferred until the Windows path is
//! bench-validated. The deploy flow itself is unaffected — it is not a
//! shell-out and handles Ctrl-C in its own render loop.

use std::io::Write;
use std::path::Path;
use std::process::Command;

use crate::exec;
use crate::ui::theme::Theme;

/// Ignore SIGINT + SIGQUIT in the current (parent) process for the guard's
/// lifetime, restoring the previous dispositions on drop. Unix only.
#[cfg(unix)]
pub struct SignalGuard {
    int: libc::sighandler_t,
    quit: libc::sighandler_t,
}

#[cfg(unix)]
impl SignalGuard {
    /// Install SIG_IGN for SIGINT + SIGQUIT, saving the previous handlers.
    pub fn ignore() -> Self {
        unsafe {
            SignalGuard {
                int: libc::signal(libc::SIGINT, libc::SIG_IGN),
                quit: libc::signal(libc::SIGQUIT, libc::SIG_IGN),
            }
        }
    }
}

#[cfg(unix)]
impl Drop for SignalGuard {
    fn drop(&mut self) {
        unsafe {
            libc::signal(libc::SIGINT, self.int);
            libc::signal(libc::SIGQUIT, self.quit);
        }
    }
}

/// No-op guard on non-unix. On Windows a console Ctrl-C reaches every process in
/// the group; per-child isolation (a `SetConsoleCtrlHandler` guard) is deferred
/// until the Windows path is bench-validated (see the module docs).
#[cfg(not(unix))]
pub struct SignalGuard;

#[cfg(not(unix))]
impl SignalGuard {
    pub fn ignore() -> Self {
        SignalGuard
    }
}

/// The result of a foreground shell-out.
pub enum RunOutcome {
    /// Exited 0.
    Ok,
    /// Exited non-zero (or was signalled).
    NonZero(String),
    /// Could not be spawned (program not found, permission).
    Spawn(String),
}

/// Run `program args…` in `cwd` with the real terminal inherited. The caller
/// must already have left the alternate screen (dropped its `Tty`). Extra
/// environment variables are applied on top of the inherited environment.
pub fn run_foreground(
    program: &str,
    args: &[&str],
    cwd: &Path,
    envs: &[(&str, &str)],
) -> RunOutcome {
    // Node launchers (`npm`/`npx`) are `.cmd` shims on Windows that need the
    // `cmd /C` path; everything else spawns directly.
    let mut cmd = if exec::is_node_tool(program) {
        exec::node_command(program, args)
    } else {
        let mut c = Command::new(program);
        c.args(args);
        c
    };
    cmd.current_dir(cwd);
    for (k, v) in envs {
        cmd.env(k, v);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // The child resets SIGINT/SIGQUIT to the default so a Ctrl-C the parent
        // is ignoring still terminates the child.
        unsafe {
            cmd.pre_exec(|| {
                libc::signal(libc::SIGINT, libc::SIG_DFL);
                libc::signal(libc::SIGQUIT, libc::SIG_DFL);
                Ok(())
            });
        }
    }
    let _guard = SignalGuard::ignore();
    match cmd.status() {
        Ok(s) if s.success() => RunOutcome::Ok,
        Ok(s) => RunOutcome::NonZero(match s.code() {
            Some(c) => format!("exit {c}"),
            None => "terminated by signal".to_string(),
        }),
        Err(e) => RunOutcome::Spawn(e.to_string()),
    }
}

/// Print the Pattern-A command banner (accent wordmark + the literal command).
pub fn banner(theme: &Theme, title: &str, program: &str, args: &[&str]) {
    println!("\n{}  {}", theme.accent("▌ ADOS"), theme.heading(title));
    let cmd = if args.is_empty() {
        program.to_string()
    } else {
        format!("{program} {}", args.join(" "))
    };
    println!("{}\n", theme.dim(&format!("$ {cmd}")));
}

/// Report the outcome of a shell-out, then wait for Enter so the operator can
/// read it before the menu repaints.
pub fn report_and_pause(theme: &Theme, outcome: RunOutcome) {
    match outcome {
        RunOutcome::Ok => println!("\n{} {}", theme.ok(theme.glyph_ok()), theme.dim("done")),
        RunOutcome::NonZero(s) => {
            println!(
                "\n{} {}",
                theme.warn("!"),
                theme.dim(&format!("finished · {s}"))
            )
        }
        RunOutcome::Spawn(e) => println!("\n{} {}", theme.fail(theme.glyph_fail()), theme.warn(&e)),
    }
    pause_for_enter(theme);
}

/// Block until the operator presses Enter (line-buffered stdin; the alt screen
/// is not active during a shell-out).
pub fn pause_for_enter(theme: &Theme) {
    print!("\n{}", theme.dim("Press Enter to return to the menu… "));
    let _ = std::io::stdout().flush();
    let mut line = String::new();
    let _ = std::io::stdin().read_line(&mut line);
}
