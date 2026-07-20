//! The single shell-out primitive.
//!
//! Every external command the installer runs (apt/dpkg, modprobe/dkms,
//! systemctl, curl, python/pip, git, ip, hostnamectl, install) goes through
//! [`run`] so command execution is logged + classified in one place. The
//! installer is a sequential orchestrator, so this is deliberately synchronous
//! `std::process` — there is no concurrency to gain from async here, and a sync
//! primitive keeps the [`crate::graph::Step`] `run` bodies plain.
//!
//! Hang protection: commands that can block indefinitely on the network (curl)
//! pass their own bounding flags (`--max-time`, `--connect-timeout`); apt/dkms
//! are bounded in practice exactly as the predecessor bash installer left them.
//!
//! Long steps (apt, git clone, pip, the wfb-ng + DKMS builds) also have a
//! streaming variant, [`run_streamed`], which pipes the child's stdout+stderr
//! and hands each line to a callback as it arrives so the live UI can show real
//! activity instead of a bare spinner. The plain [`run`] stays for the many
//! short commands where all-at-once capture is simpler.

use std::collections::VecDeque;
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::mpsc;

/// Outcome of one external command. `code` is `None` when the process could not
/// be spawned at all (binary missing on PATH); `spawned` distinguishes that
/// from a non-zero exit.
#[derive(Debug, Clone)]
pub struct CmdResult {
    /// Process exit code, or `None` if the spawn itself failed.
    pub code: Option<i32>,
    /// Captured stdout (lossy UTF-8).
    pub stdout: String,
    /// Captured stderr (lossy UTF-8).
    pub stderr: String,
    /// True once the process was spawned (regardless of its exit code).
    pub spawned: bool,
}

impl CmdResult {
    /// True iff the process spawned and exited 0.
    pub fn success(&self) -> bool {
        self.code == Some(0)
    }
}

/// Run `program args...`, capturing stdout/stderr. Never panics: a spawn
/// failure (missing binary) yields a `CmdResult { code: None, spawned: false }`
/// rather than an error, so callers decide whether a missing tool is fatal.
pub fn run(program: &str, args: &[&str]) -> CmdResult {
    tracing::debug!(program, ?args, "exec");
    match Command::new(program).args(args).output() {
        Ok(out) => {
            let res = CmdResult {
                code: out.status.code(),
                stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
                stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
                spawned: true,
            };
            tracing::debug!(program, code = ?res.code, "exec done");
            res
        }
        Err(e) => {
            tracing::warn!(program, error = %e, "exec spawn failed");
            CmdResult {
                code: None,
                stdout: String::new(),
                stderr: e.to_string(),
                spawned: false,
            }
        }
    }
}

/// Convenience: run and report only whether it exited 0. Use for best-effort
/// commands where the output is not needed.
pub fn run_ok(program: &str, args: &[&str]) -> bool {
    run(program, args).success()
}

/// Run a command that MUST succeed; returns the captured result or an error
/// carrying the trimmed stderr. Use inside Required steps.
pub fn run_checked(program: &str, args: &[&str]) -> anyhow::Result<CmdResult> {
    let res = run(program, args);
    if res.success() {
        Ok(res)
    } else if !res.spawned {
        anyhow::bail!("`{program}` could not be spawned: {}", res.stderr.trim());
    } else {
        anyhow::bail!("`{program}` exited {:?}: {}", res.code, res.stderr.trim());
    }
}

/// Which stream a captured line came from (kept separate so an error message
/// carries the stderr tail, matching [`run`]'s split).
#[derive(Debug, Clone, Copy)]
enum StreamKind {
    Out,
    Err,
}

/// How many trailing lines of each stream we retain for the returned
/// `CmdResult` (enough for a failure message; the full record is in the
/// journal). Long builds emit thousands of lines — we never buffer them all.
const STREAM_TAIL_CAP: usize = 120;
/// Hard cap on a single captured line (a `\r`-only progress line, or a runaway
/// log line, must not blow up the channel or the frame).
const MAX_LINE_CHARS: usize = 500;

/// Read `reader` to EOF, splitting on BOTH `\n` and `\r` (git/curl/make emit
/// carriage-return progress with no newline), and forward each non-empty line
/// on `tx`. Runs on its own thread so stdout + stderr are drained concurrently
/// (a child that fills one pipe while we block on the other would deadlock).
fn pump<R: Read>(mut reader: R, kind: StreamKind, tx: mpsc::Sender<(StreamKind, String)>) {
    let mut buf = [0u8; 4096];
    let mut line: Vec<u8> = Vec::with_capacity(256);
    let emit = |line: &mut Vec<u8>| -> bool {
        if line.is_empty() {
            return true;
        }
        let s: String = String::from_utf8_lossy(line)
            .chars()
            .take(MAX_LINE_CHARS)
            .collect();
        line.clear();
        tx.send((kind, s)).is_ok()
    };
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                for &b in &buf[..n] {
                    if b == b'\n' || b == b'\r' {
                        if !emit(&mut line) {
                            return;
                        }
                    } else {
                        line.push(b);
                    }
                }
            }
            Err(_) => break,
        }
    }
    let _ = emit(&mut line);
}

/// Run `program args...`, streaming each stdout/stderr line to `on_line` as it
/// arrives. Returns the same [`CmdResult`] shape as [`run`], but `stdout` /
/// `stderr` carry only the trailing [`STREAM_TAIL_CAP`] lines (so an
/// `anyhow::bail!(…, res.stderr.trim())` caller still reports the real error).
/// `on_line` runs on the calling thread, so it can borrow non-`Send` state
/// (the progress sink) freely.
pub fn run_streamed<F: FnMut(&str)>(program: &str, args: &[&str], mut on_line: F) -> CmdResult {
    tracing::debug!(program, ?args, "exec-streamed");
    let mut child = match Command::new(program)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!(program, error = %e, "exec spawn failed");
            return CmdResult {
                code: None,
                stdout: String::new(),
                stderr: e.to_string(),
                spawned: false,
            };
        }
    };

    // `take` the pipes so the reader threads own them; both are `Send`.
    let stdout = child.stdout.take().expect("piped stdout present");
    let stderr = child.stderr.take().expect("piped stderr present");
    let (tx, rx) = mpsc::channel::<(StreamKind, String)>();
    let tx_err = tx.clone();
    let h_out = std::thread::spawn(move || pump(stdout, StreamKind::Out, tx));
    let h_err = std::thread::spawn(move || pump(stderr, StreamKind::Err, tx_err));

    // Both senders are owned by the threads; when they finish the channel
    // closes and this drain loop ends. All UI emission happens right here on
    // the caller thread.
    let mut out_tail: VecDeque<String> = VecDeque::with_capacity(STREAM_TAIL_CAP);
    let mut err_tail: VecDeque<String> = VecDeque::with_capacity(STREAM_TAIL_CAP);
    for (kind, line) in rx {
        on_line(&line);
        let tail = match kind {
            StreamKind::Out => &mut out_tail,
            StreamKind::Err => &mut err_tail,
        };
        if tail.len() == STREAM_TAIL_CAP {
            tail.pop_front();
        }
        tail.push_back(line);
    }
    let _ = h_out.join();
    let _ = h_err.join();

    let code = child.wait().ok().and_then(|s| s.code());
    tracing::debug!(program, code = ?code, "exec-streamed done");
    CmdResult {
        code,
        stdout: Vec::from(out_tail).join("\n"),
        stderr: Vec::from(err_tail).join("\n"),
        spawned: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_captures_stdout_of_true_echo() {
        // `echo` is on PATH on every CI runner + dev host.
        let r = run("echo", &["hello"]);
        assert!(r.success());
        assert_eq!(r.stdout.trim(), "hello");
    }

    #[test]
    fn run_reports_spawn_failure_without_panicking() {
        let r = run("definitely-not-a-real-binary-xyz", &["--nope"]);
        assert!(!r.spawned);
        assert_eq!(r.code, None);
        assert!(!r.success());
    }

    #[test]
    fn run_checked_errors_on_nonzero() {
        // `false` exits 1.
        let err = run_checked("false", &[]).unwrap_err();
        assert!(err.to_string().contains("exited"));
    }

    #[test]
    fn run_streamed_delivers_each_line_and_keeps_the_tail() {
        let mut lines = Vec::new();
        let r = run_streamed("sh", &["-c", "printf 'a\\nb\\nc\\n'"], |l| {
            lines.push(l.to_string())
        });
        assert!(r.success());
        assert_eq!(lines, vec!["a", "b", "c"]);
        assert_eq!(r.stdout, "a\nb\nc");
    }

    #[test]
    fn run_streamed_splits_carriage_returns() {
        // Progress output uses bare `\r` with no newline; each segment is a line.
        let mut lines = Vec::new();
        let r = run_streamed("sh", &["-c", "printf 'x\\ry\\rz'"], |l| {
            lines.push(l.to_string())
        });
        assert!(r.success());
        assert_eq!(lines, vec!["x", "y", "z"]);
    }

    #[test]
    fn run_streamed_captures_stderr_tail_for_errors() {
        let mut count = 0usize;
        let r = run_streamed("sh", &["-c", "echo boom 1>&2; exit 3"], |_| count += 1);
        assert!(!r.success());
        assert_eq!(r.code, Some(3));
        assert!(r.stderr.contains("boom"));
        assert_eq!(count, 1);
    }

    #[test]
    fn run_streamed_reports_spawn_failure() {
        let r = run_streamed("definitely-not-a-real-binary-xyz", &[], |_| {});
        assert!(!r.spawned);
        assert_eq!(r.code, None);
    }
}
