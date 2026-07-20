//! The installer's live progress UI.
//!
//! The install engine emits [`ProgressEvent`]s through a [`ProgressSink`] (cheap
//! to clone, a no-op when no renderer is attached). A renderer thread consumes
//! them and either draws a live dashboard (rich) or prints clean line
//! transitions (plain). The durable per-process log keeps flowing to the journal
//! independently; this UI is purely additive operator feedback.
//!
//! Mode is chosen from **stderr** (where the UI renders) plus the environment,
//! so it behaves correctly under `curl … | sudo bash` (stdin is a pipe, but
//! stderr is the operator's terminal) and degrades to plain text in CI / piped
//! / `TERM=dumb` contexts.

pub mod activity;
pub mod events;
pub mod fullscreen;
pub mod model;
pub mod plain;
pub mod rich;
pub mod summary;
pub mod theme;
pub mod tty;

use std::io::{IsTerminal, Write};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::OnceLock;
use std::thread::JoinHandle;

use tracing::field::{Field, Visit};
use tracing::{Event, Subscriber};
use tracing_subscriber::layer::{Context, Layer};

use crate::graph::StepOutcome;
pub use events::{
    GroupMap, ProgressEvent, SummaryData, INSTALL_FOOTER, INSTALL_GROUPS, UNINSTALL_FOOTER,
    UNINSTALL_GROUPS,
};
pub use theme::Theme;
use tty::Tty;

/// Set once a log-forwarding renderer (rich) is running. The tracing
/// [`ChannelLayer`] forwards log lines here; until it is set, forwarding is a
/// no-op and logs go only to the journal.
static LOG_TX: OnceLock<Sender<ProgressEvent>> = OnceLock::new();

/// Which renderer to drive, decided once at startup.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RenderMode {
    /// Full-screen split dashboard over `/dev/tty` (a controlling terminal is
    /// reachable — the primary interactive path, incl. under `curl | sudo bash`).
    Fullscreen,
    /// Inline sticky-block dashboard on stderr (stderr is a terminal but no
    /// `/dev/tty` is openable — the fallback that keeps the box UX).
    Rich,
    /// Clean escape-free line transitions (non-tty / CI / `--plain`).
    Plain,
    /// Only the final summary (and errors); `--quiet`.
    Quiet,
    /// No UI; machine output on stdout. `--json`.
    Json,
}

/// Decide the render mode from the flags + environment. Gates on **stderr**
/// because that is where the UI draws.
pub fn detect_mode(args: &crate::cli::Args) -> RenderMode {
    if args.json {
        return RenderMode::Json;
    }
    if args.quiet {
        return RenderMode::Quiet;
    }
    let is_tty = std::io::stderr().is_terminal();
    let ci = std::env::var_os("CI").is_some();
    let dumb = std::env::var("TERM").map(|t| t == "dumb").unwrap_or(false);
    if args.plain || !is_tty || ci || dumb {
        return RenderMode::Plain;
    }
    RenderMode::Rich
}

/// Resolve the live render mode + terminal, upgrading `Rich` to `Fullscreen`
/// when a controlling terminal is reachable. `carried` is the wizard's still-open
/// `Tty` (the wizard→install handoff keeps one alt-screen session); when it is
/// `None` but the base mode is `Rich`, a fresh `/dev/tty` is opened (the wizard
/// was skipped by a flag but a terminal exists). Plain / Quiet / Json drop any
/// carried `Tty` (leaving the alt screen) and keep the base line/quiet renderer.
pub fn resolve_live_mode(base: RenderMode, carried: Option<Tty>) -> (RenderMode, Option<Tty>) {
    match base {
        RenderMode::Rich => {
            if let Some(t) = carried {
                (RenderMode::Fullscreen, Some(t))
            } else if let Ok(Some(t)) = Tty::open() {
                (RenderMode::Fullscreen, Some(t))
            } else {
                (RenderMode::Rich, None)
            }
        }
        other => {
            drop(carried);
            (other, None)
        }
    }
}

/// A cheap, clonable handle the install engine emits events through. A sink with
/// no channel (the default, or `--json`) silently drops events.
#[derive(Debug, Clone, Default)]
pub struct ProgressSink {
    tx: Option<Sender<ProgressEvent>>,
}

impl ProgressSink {
    fn send(&self, ev: ProgressEvent) {
        if let Some(tx) = &self.tx {
            let _ = tx.send(ev);
        }
    }

    /// A step's `run()` is about to execute.
    pub fn step_started(&self, id: &str) {
        self.send(ProgressEvent::StepStarted { id: id.to_string() });
    }

    /// A step finished (ran or skipped) with this outcome.
    pub fn step_result(&self, id: &str, outcome: &StepOutcome) {
        self.send(ProgressEvent::StepResult {
            id: id.to_string(),
            outcome: outcome.clone(),
        });
    }

    /// Incremental sub-progress for a step that reports a fraction.
    pub fn sub_progress(&self, id: &str, done: u64, total: u64) {
        self.send(ProgressEvent::SubProgress {
            id: id.to_string(),
            done,
            total,
        });
    }

    /// Set the curated headline for the running step's live-detail pane.
    pub fn activity(&self, id: &str, message: String) {
        self.send(ProgressEvent::Activity {
            id: id.to_string(),
            message,
        });
    }

    /// Emit one raw subprocess line into the running step's log tail.
    pub fn sub_log(&self, id: &str, line: &str) {
        self.send(ProgressEvent::SubLog {
            id: id.to_string(),
            line: line.to_string(),
        });
    }

    /// Byte-level download progress for the running step's current file.
    pub fn byte_progress(&self, id: &str, done: u64, total: u64, label: &str) {
        self.send(ProgressEvent::ByteProgress {
            id: id.to_string(),
            done,
            total,
            label: label.to_string(),
        });
    }

    /// The terminal summary (success card / failure panel).
    pub fn summary(&self, s: SummaryData) {
        self.send(ProgressEvent::Summary(Box::new(s)));
    }

    /// Stop the renderer and restore the terminal.
    pub fn finish(&self) {
        self.send(ProgressEvent::Finished);
    }
}

/// Owns the renderer thread; [`RenderHandle::finish`] joins it (call after
/// sending [`ProgressSink::summary`] + [`ProgressSink::finish`]).
pub struct RenderHandle {
    join: Option<JoinHandle<()>>,
}

impl RenderHandle {
    fn none() -> Self {
        RenderHandle { join: None }
    }

    /// Wait for the renderer to draw the final summary and restore the terminal.
    pub fn finish(self) {
        if let Some(j) = self.join {
            let _ = j.join();
        }
    }
}

/// Create the progress sink + spawn the renderer thread for `mode`. `header` is
/// the one-line banner the renderer prints first. `tty` is the controlling
/// terminal for `Fullscreen` (from [`resolve_live_mode`]); the other modes ignore
/// it (it is dropped, leaving the alt screen if one was carried).
pub fn start(
    mode: RenderMode,
    header: String,
    theme: Theme,
    tty: Option<Tty>,
    groups: GroupMap,
    footer: &'static str,
    interactive: bool,
) -> (ProgressSink, RenderHandle) {
    if mode == RenderMode::Json {
        return (ProgressSink::default(), RenderHandle::none());
    }
    let (tx, rx) = mpsc::channel::<ProgressEvent>();
    let sink = ProgressSink {
        tx: Some(tx.clone()),
    };
    let join = match mode {
        RenderMode::Fullscreen => {
            // The `Tty`'s own panic-reset hook (installed by `Tty::open`) leaves
            // the alt screen + un-raws on a panic, so no stderr cursor hook here.
            let _ = LOG_TX.set(tx);
            let tty = tty.expect("Fullscreen render mode requires a Tty");
            std::thread::Builder::new()
                .name("ados-installer-ui".to_string())
                .spawn(move || fullscreen::run(tty, rx, theme, header, groups, footer, interactive))
                .ok()
        }
        RenderMode::Rich => {
            // The renderer hides the cursor; a panic (release builds abort) must
            // still restore it, so install the hook before drawing.
            install_panic_hook();
            // Forward log lines into the live block (rich renderer only).
            let _ = LOG_TX.set(tx);
            std::thread::Builder::new()
                .name("ados-installer-ui".to_string())
                .spawn(move || rich::run(rx, theme, header, groups))
                .ok()
        }
        RenderMode::Quiet => spawn_plain(rx, true, header, groups),
        // Plain (and any future fallback) → the escape-free line renderer.
        _ => spawn_plain(rx, false, header, groups),
    };
    (sink, RenderHandle { join })
}

/// Spawn the plain renderer thread.
fn spawn_plain(
    rx: Receiver<ProgressEvent>,
    quiet: bool,
    header: String,
    groups: GroupMap,
) -> Option<JoinHandle<()>> {
    std::thread::Builder::new()
        .name("ados-installer-ui".to_string())
        .spawn(move || plain::run(rx, quiet, header, groups))
        .ok()
}

/// Restore the cursor on panic. Release builds abort on panic, so the hook is
/// the only chance to undo `cursor::Hide`. Installed at most once.
fn install_panic_hook() {
    static ONCE: OnceLock<()> = OnceLock::new();
    if ONCE.set(()).is_err() {
        return;
    }
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let mut err = std::io::stderr();
        let _ = ratatui::crossterm::execute!(err, ratatui::crossterm::cursor::Show);
        let _ = writeln!(err);
        prev(info);
    }));
}

/// A tracing layer that forwards each log line to the renderer (when a
/// log-forwarding renderer is attached). Added alongside the journald layer so
/// the journal keeps the full record regardless.
pub struct ChannelLayer;

#[derive(Default)]
struct MsgVisitor {
    message: Option<String>,
}

impl Visit for MsgVisitor {
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        if field.name() == "message" {
            self.message = Some(format!("{value:?}"));
        }
    }
}

impl<S: Subscriber> Layer<S> for ChannelLayer {
    fn on_event(&self, event: &Event<'_>, _ctx: Context<'_, S>) {
        let Some(tx) = LOG_TX.get() else {
            return;
        };
        let mut v = MsgVisitor::default();
        event.record(&mut v);
        if let Some(msg) = v.message {
            let _ = tx.send(ProgressEvent::Log {
                level: *event.metadata().level(),
                line: msg,
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::Args;

    #[test]
    fn json_and_quiet_flags_win() {
        let mut a = Args {
            json: true,
            ..Args::default()
        };
        assert_eq!(detect_mode(&a), RenderMode::Json);
        a.json = false;
        a.quiet = true;
        assert_eq!(detect_mode(&a), RenderMode::Quiet);
    }

    #[test]
    fn plain_flag_forces_plain() {
        let a = Args {
            plain: true,
            ..Args::default()
        };
        assert_eq!(detect_mode(&a), RenderMode::Plain);
    }

    #[test]
    fn noop_sink_does_not_panic() {
        let sink = ProgressSink::default();
        sink.step_started("deps");
        sink.step_result("deps", &StepOutcome::Ok);
        sink.finish();
    }
}
