//! The full-screen install progress renderer.
//!
//! A split-view alternate-screen dashboard: the checklist of the ten display
//! groups on the left, and a live-detail pane on the right showing the running
//! step's activity headline, a download / sub-progress bar, and a scrolling tail
//! of its real subprocess output. It reuses the wizard's [`Tty`] (the `/dev/tty`
//! alternate-screen session that survives `curl … | sudo bash`) and the
//! ANSI-width helpers in [`crate::wizard::render`], so the compositor is pure and
//! width-exact and the same graceful-degradation rules apply (NO_COLOR, ASCII
//! glyphs, resize handling).
//!
//! The render thread OWNS the `Tty` and is its only writer; the install engine
//! and the tracing bridge are producers on the event channel, so no other thread
//! ever touches the terminal. [`compose`] is a pure function of the model +
//! terminal size (snapshot-tested like [`crate::wizard::frame::compose`]).

use std::collections::VecDeque;
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};

use crate::ui::activity;
use crate::ui::events::{GroupMap, ProgressEvent, SummaryData};
use crate::ui::model::{fmt_dur, GStatus, Group, Model};
use crate::ui::summary;
use crate::ui::theme::Theme;
use crate::ui::tty::{Input, KeyEvent, Tty};
use crate::wizard::frame::{self, TermSize};
use crate::wizard::render;

/// Spinner cadence.
const TICK_MS: u64 = 120;
/// Below this width the split collapses to a single column.
const SPLIT_MIN_COLS: usize = 90;
/// Live-detail log-tail ring depth (kept small; only the tail is shown).
const LOG_CAP: usize = 64;
/// Journal ring depth retained for the failure panel.
const JOURNAL_CAP: usize = 12;

/// Everything the compositor needs for one frame.
struct View<'a> {
    title: &'a str,
    footer: &'a str,
    model: &'a Model,
    active: Option<usize>,
    logs: &'a VecDeque<String>,
    spinner: usize,
    elapsed: Option<Duration>,
}

/// Mutable render state, driven by the event stream.
struct State {
    model: Model,
    /// The group whose detail pane is shown (the running step).
    active: Option<usize>,
    /// The running step's raw output tail.
    logs: VecDeque<String>,
    /// Forwarded tracing lines, retained for the failure panel only.
    journal: VecDeque<String>,
    /// When the first step started (drives the total-elapsed clock).
    started: Option<Instant>,
    summary: Option<Box<SummaryData>>,
    finished: bool,
}

impl State {
    fn new(groups: GroupMap) -> Self {
        State {
            model: Model::new(groups),
            active: None,
            logs: VecDeque::with_capacity(LOG_CAP),
            journal: VecDeque::with_capacity(JOURNAL_CAP),
            started: None,
            summary: None,
            finished: false,
        }
    }

    /// Switch the detail pane to `group`, clearing the previous step's log tail.
    fn focus(&mut self, group: Option<usize>) {
        if group.is_some() && group != self.active {
            self.active = group;
            self.logs.clear();
        }
    }

    fn apply(&mut self, ev: ProgressEvent) {
        match ev {
            ProgressEvent::StepStarted { id } => {
                if self.started.is_none() {
                    self.started = Some(Instant::now());
                }
                self.focus(self.model.group_index(&id));
                self.model.start(&id);
            }
            ProgressEvent::StepResult { id, outcome } => {
                self.model.record(&id, &outcome);
            }
            ProgressEvent::SubProgress { id, done, total } => {
                self.model.set_sub(&id, done, total);
            }
            ProgressEvent::Activity { id, message } => {
                self.model.set_activity(&id, message);
            }
            ProgressEvent::SubLog { id, line } => {
                self.focus(self.model.group_index(&id));
                push(&mut self.logs, line, LOG_CAP);
            }
            ProgressEvent::ByteProgress {
                id,
                done,
                total,
                label,
            } => {
                self.model.set_bytes(&id, done, total, label);
            }
            ProgressEvent::Log { line, .. } => {
                push(&mut self.journal, line, JOURNAL_CAP);
            }
            ProgressEvent::Summary(s) => self.summary = Some(s),
            ProgressEvent::Finished => self.finished = true,
        }
    }
}

/// Run the full-screen renderer to completion, then leave the alternate screen
/// and print the summary card on the primary screen.
pub fn run(
    mut tty: Tty,
    rx: Receiver<ProgressEvent>,
    theme: Theme,
    header: String,
    groups: GroupMap,
    footer: &'static str,
    interactive: bool,
) {
    let title = title_from_header(&header);
    let mut st = State::new(groups);
    let mut spinner = 0usize;
    let mut interrupted = false;

    tty.force_clear_next();
    // The run is write-only, so let Ctrl-C raise SIGINT (the wizard ran with it
    // off); the handler sets a flag we observe below and exit cleanly.
    tty.enable_signals();
    paint(&mut tty, &theme, &title, footer, &st, spinner);

    while !st.finished {
        match rx.recv_timeout(Duration::from_millis(TICK_MS)) {
            Ok(ev) => {
                st.apply(ev);
                // Drain-coalesce: apply everything queued, then paint one frame
                // (decouples the frame rate from a flood of streamed log lines).
                while let Ok(ev) = rx.try_recv() {
                    st.apply(ev);
                }
            }
            Err(RecvTimeoutError::Timeout) => spinner = spinner.wrapping_add(1),
            Err(RecvTimeoutError::Disconnected) => break,
        }
        if crate::ui::tty::take_interrupt() {
            interrupted = true;
            break;
        }
        paint(&mut tty, &theme, &title, footer, &st, spinner);
    }

    // On an interactive success, show the closing summary full-screen inside the
    // alt screen and wait for the operator to dismiss it, before leaving.
    if interactive && !interrupted {
        if let Some(s) = st.summary.as_deref() {
            if s.status != "failed" {
                present_completion(&mut tty, &theme, s, &st.journal);
            }
        }
    }

    // Leave the alt screen + restore the terminal (RAII), then print the summary
    // on the primary buffer where the pre-install output lived, so the reach URLs
    // persist in scrollback after the shell returns.
    drop(tty);
    if interrupted {
        eprintln!("\nInstall interrupted.");
        std::process::exit(130);
    }
    if let Some(s) = st.summary {
        for line in summary::rich_lines(&s, &theme, &st.journal) {
            eprintln!("{line}");
        }
    }
}

/// Paint the closing summary as a full-screen frame (centered on the charcoal
/// background) on the still-open alt screen.
fn paint_completion(tty: &mut Tty, theme: &Theme, s: &SummaryData, journal: &VecDeque<String>) {
    let size = tty.size();
    let grid = summary::fullscreen_grid(s, theme, journal, size.cols, size.rows);
    tty.present(&grid, theme);
}

/// Show the closing summary full-screen and block until the operator dismisses
/// it (Enter / any key / Ctrl-C), repainting on a resize. A generous auto-dismiss
/// deadline means an unattended-but-interactive session still returns to a shell.
fn present_completion(tty: &mut Tty, theme: &Theme, s: &SummaryData, journal: &VecDeque<String>) {
    const AUTO_DISMISS: Duration = Duration::from_secs(120);
    let deadline = Instant::now() + AUTO_DISMISS;
    // Drop any keystrokes typed during the install so the card holds until a
    // fresh keypress instead of a buffered byte dismissing it instantly.
    tty.flush_input();
    paint_completion(tty, theme, s, journal);
    loop {
        match tty.read_input(200) {
            Input::Key(KeyEvent::Resize) => paint_completion(tty, theme, s, journal),
            Input::Key(_) => break,
            Input::Tick => {
                if crate::ui::tty::take_interrupt() || Instant::now() >= deadline {
                    break;
                }
            }
        }
    }
}

/// The banner text: the header minus any trailing ellipsis/dots.
fn title_from_header(header: &str) -> String {
    header.trim_end_matches(['.', '…', ' ']).to_string()
}

fn push(ring: &mut VecDeque<String>, line: String, cap: usize) {
    if ring.len() == cap {
        ring.pop_front();
    }
    ring.push_back(line);
}

fn paint(tty: &mut Tty, theme: &Theme, title: &str, footer: &str, st: &State, spinner: usize) {
    let view = View {
        title,
        footer,
        model: &st.model,
        active: st.active,
        logs: &st.logs,
        spinner,
        elapsed: st.started.map(|s| s.elapsed()),
    };
    let grid = compose(theme, &view, tty.size());
    tty.present(&grid, theme);
}

/// Compose the whole screen as `size.rows` full-width lines. Pure.
fn compose(theme: &Theme, v: &View, size: TermSize) -> Vec<String> {
    let cols = size.cols.max(1);
    let rows = size.rows.max(1);
    if cols < frame::MIN_COLS || rows < frame::MIN_ROWS {
        return too_small(theme, cols, rows);
    }

    let mut grid = vec![" ".repeat(cols); rows];
    grid[0] = header_line(theme, v.title, v.elapsed, cols);
    grid[1] = render::fit_to(&theme.dim(&theme.box_chars().h.repeat(cols)), cols);
    let footer_row = rows - 1;
    grid[footer_row] = footer_line(theme, v.footer, cols);

    let body_top = 2;
    let body_count = footer_row.saturating_sub(body_top);

    if cols >= SPLIT_MIN_COLS {
        let left_w = (cols * 42 / 100).clamp(28, 44).min(cols.saturating_sub(24));
        let sep_w = 3; // " │ "
        let right_w = cols - left_w - sep_w;
        let left = checklist_cells(theme, v.model, v.spinner, left_w, body_count);
        let right = detail_cells(theme, v, right_w, body_count);
        let vbar = theme.dim(theme.box_chars().v);
        for i in 0..body_count {
            let lc = left.get(i).cloned().unwrap_or_else(|| " ".repeat(left_w));
            let rc = right.get(i).cloned().unwrap_or_else(|| " ".repeat(right_w));
            grid[body_top + i] = render::fit_to(&format!("{lc} {vbar} {rc}"), cols);
        }
    } else {
        // Narrow tier: checklist stacked, then the active headline + bar under it.
        let mut body = checklist_cells(theme, v.model, v.spinner, cols, body_count);
        if let Some(idx) = v.active {
            let g = &v.model.groups[idx];
            let mut extra: Vec<String> = Vec::new();
            extra.push(" ".repeat(cols));
            if let Some(a) = &g.activity {
                extra.push(render::fit_to(&theme.accent(&format!(" → {a}")), cols));
            }
            extra.push(bar_line(theme, g, cols));
            // Overwrite the tail rows with the detail lines.
            for (k, line) in extra.into_iter().enumerate() {
                let slot = body_count.saturating_sub(3) + k;
                if slot < body.len() {
                    body[slot] = line;
                }
            }
        }
        for (i, line) in body.into_iter().enumerate().take(body_count) {
            grid[body_top + i] = line;
        }
    }
    grid
}

/// `▌ ADOS  ·  Installing …            04:12`
fn header_line(theme: &Theme, title: &str, elapsed: Option<Duration>, cols: usize) -> String {
    let left = format!(
        "{} {}  {}  {}",
        theme.accent(render::wordmark(theme)),
        theme.heading("ADOS"),
        theme.dim(render::dot(theme)),
        theme.accent(title),
    );
    let right = elapsed
        .map(|d| theme.dim(&fmt_clock(d)))
        .unwrap_or_default();
    let lw = render::visible_width(&left);
    let rw = render::visible_width(&right);
    if lw + rw + 1 >= cols {
        return render::fit_to(&left, cols);
    }
    render::fit_to(
        &format!("{left}{}{right}", " ".repeat(cols - lw - rw)),
        cols,
    )
}

fn footer_line(theme: &Theme, footer: &str, cols: usize) -> String {
    render::center(&theme.dim(footer), cols)
}

/// The ten checklist rows, each fit to `width`, padded to `height`.
fn checklist_cells(
    theme: &Theme,
    model: &Model,
    spinner: usize,
    width: usize,
    height: usize,
) -> Vec<String> {
    let mut cells: Vec<String> = model
        .groups
        .iter()
        .map(|g| checklist_row(theme, g, spinner, width))
        .collect();
    while cells.len() < height {
        cells.push(" ".repeat(width));
    }
    cells.truncate(height);
    cells
}

/// One checklist row: `✓ Building radio stack      28.8s` fit to `width`.
fn checklist_row(theme: &Theme, g: &Group, spinner: usize, width: usize) -> String {
    let glyph = glyph_colored(theme, g, spinner);
    let detail = detail_token(g);
    let detail_w = render::visible_width(&detail);
    let label_max = width.saturating_sub(2 + detail_w + 1);
    let label = render::truncate(g.label, label_max);
    let used = 2 + render::visible_width(&label) + detail_w;
    let pad = width.saturating_sub(used);
    let label_styled = match g.status {
        GStatus::Running => theme.heading(&label),
        GStatus::Pending | GStatus::Skipped => theme.dim(&label),
        _ => label.clone(),
    };
    let detail_styled = if g.status == GStatus::Running && g.sub.is_some() {
        theme.accent(&detail)
    } else {
        theme.dim(&detail)
    };
    render::fit_to(
        &format!("{glyph} {label_styled}{}{detail_styled}", " ".repeat(pad)),
        width,
    )
}

fn glyph_colored(theme: &Theme, g: &Group, spinner: usize) -> String {
    match g.status {
        GStatus::Ok => theme.ok(theme.glyph_ok()),
        GStatus::Skipped => theme.dim(theme.glyph_ok()),
        GStatus::Failed => theme.fail(theme.glyph_fail()),
        GStatus::Running => theme.accent(theme.spinner(spinner)),
        GStatus::Pending => theme.dim(theme.glyph_pending()),
    }
}

/// The right-aligned checklist token (plain text; caller measures for padding).
fn detail_token(g: &Group) -> String {
    match g.status {
        GStatus::Ok | GStatus::Failed => g.elapsed.map(fmt_dur).unwrap_or_default(),
        GStatus::Skipped => "cached".to_string(),
        GStatus::Running => match g.sub {
            Some((done, total)) => short_bar(done, total),
            None => g.elapsed_now().map(fmt_dur).unwrap_or_default(),
        },
        GStatus::Pending => String::new(),
    }
}

/// The live-detail pane: title, activity headline, a bar, then the log tail.
fn detail_cells(theme: &Theme, v: &View, width: usize, height: usize) -> Vec<String> {
    let mut lines: Vec<String> = Vec::with_capacity(height);
    match v.active {
        Some(idx) => {
            let g = &v.model.groups[idx];
            let sp = theme.accent(theme.spinner(v.spinner));
            lines.push(render::fit_to(
                &format!("{sp} {}", theme.heading(g.label)),
                width,
            ));
            lines.push(match &g.activity {
                Some(a) => render::fit_to(&theme.accent(&format!("→ {a}")), width),
                None => " ".repeat(width),
            });
            lines.push(bar_line(theme, g, width));
            lines.push(render::fit_to(&theme.dim("live"), width));
            // Fill the rest with the tail of the raw output, most recent last.
            let room = height.saturating_sub(lines.len());
            let skip = v.logs.len().saturating_sub(room);
            for raw in v.logs.iter().skip(skip) {
                let text = render::truncate(&render::strip_ansi(raw), width.saturating_sub(2));
                lines.push(render::fit_to(&theme.dim(&format!("  {text}")), width));
            }
        }
        None => lines.push(render::fit_to(&theme.dim("preparing…"), width)),
    }
    while lines.len() < height {
        lines.push(" ".repeat(width));
    }
    lines.truncate(height);
    lines
}

/// The detail pane's progress bar line: byte progress for a download, else the
/// sub-progress bar, else blank.
fn bar_line(theme: &Theme, g: &Group, width: usize) -> String {
    if let Some((done, total, label)) = &g.bytes {
        let size = if *total > 0 {
            format!(
                "{} / {}",
                activity::fmt_bytes(*done),
                activity::fmt_bytes(*total)
            )
        } else {
            activity::fmt_bytes(*done)
        };
        let count = g
            .sub
            .map(|(d, t)| format!("  {}", theme.dim(&format!("({d}/{t})"))))
            .unwrap_or_default();
        let bar = theme.accent(&wide_bar(theme, *done, (*total).max(1)));
        return render::fit_to(
            &format!("{bar} {} {}{count}", theme.heading(label), theme.dim(&size)),
            width,
        );
    }
    if let Some((done, total)) = g.sub {
        return render::fit_to(&theme.accent(&wide_bar(theme, done, total)), width);
    }
    " ".repeat(width)
}

/// A compact 8-cell bar for the checklist token: `▕████░░░░▏ 50%`.
fn short_bar(done: u64, total: u64) -> String {
    bar_glyphs(done, total, 8, "▕", "▏", "█", "░")
}

/// A wide 16-cell bar for the detail pane.
fn wide_bar(theme: &Theme, done: u64, total: u64) -> String {
    if theme.ascii {
        bar_glyphs(done, total, 16, "[", "]", "#", ".")
    } else {
        bar_glyphs(done, total, 16, "▕", "▏", "█", "░")
    }
}

fn bar_glyphs(
    done: u64,
    total: u64,
    cells: u64,
    l: &str,
    r: &str,
    fill: &str,
    empty: &str,
) -> String {
    let frac = done
        .saturating_mul(cells)
        .checked_div(total)
        .unwrap_or(0)
        .min(cells);
    let pct = done
        .saturating_mul(100)
        .checked_div(total)
        .unwrap_or(0)
        .min(100);
    format!(
        "{l}{}{}{r} {pct}%",
        fill.repeat(frac as usize),
        empty.repeat((cells - frac) as usize)
    )
}

/// A total-elapsed `M:SS` clock.
fn fmt_clock(d: Duration) -> String {
    let s = d.as_secs();
    format!("{}:{:02}", s / 60, s % 60)
}

/// The below-minimum-size resize prompt.
fn too_small(theme: &Theme, cols: usize, rows: usize) -> Vec<String> {
    let mut grid = vec![" ".repeat(cols); rows];
    let msg = format!(
        "Terminal too small. Please resize to at least {} x {}.",
        frame::MIN_COLS,
        frame::MIN_ROWS
    );
    grid[rows / 2] = render::center(&theme.warn(&msg), cols);
    grid
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph::StepOutcome;
    use crate::ui::events::{group_index_for_step, INSTALL_GROUPS};
    use crate::ui::theme::ColorTier;

    fn plain() -> Theme {
        Theme {
            ascii: false,
            tier: ColorTier::None,
        }
    }

    fn view<'a>(m: &'a Model, logs: &'a VecDeque<String>, active: Option<usize>) -> View<'a> {
        View {
            title: "Installing · ADOS Drone Agent (drone)",
            footer: "First install can take a few minutes. Safe to leave running.",
            model: m,
            active,
            logs,
            spinner: 0,
            elapsed: Some(Duration::from_secs(252)),
        }
    }

    #[test]
    fn every_line_is_exactly_cols_wide_across_sizes_and_tiers() {
        let mut m = Model::new(INSTALL_GROUPS);
        m.record("deps", &StepOutcome::Ok);
        m.set_bytes(
            "fetch_binaries",
            4_404_019,
            8_388_608,
            "ados-control".into(),
        );
        m.set_activity("fetch_binaries", "installing ados-control".into());
        let mut logs = VecDeque::new();
        logs.push_back("✓ ados-supervisor 6.1 MB".to_string());
        logs.push_back("verifying ados-control sha256".to_string());
        let active = group_index_for_step(INSTALL_GROUPS, "fetch_binaries");

        for tier in [ColorTier::None, ColorTier::Truecolor, ColorTier::Basic] {
            for ascii in [false, true] {
                let theme = Theme { ascii, tier };
                for (cols, rows) in [(120usize, 30usize), (90, 24), (80, 20), (72, 20)] {
                    let v = view(&m, &logs, active);
                    let grid = compose(&theme, &v, TermSize { cols, rows });
                    assert_eq!(grid.len(), rows);
                    for (i, line) in grid.iter().enumerate() {
                        assert_eq!(
                            render::visible_width(line),
                            cols,
                            "tier {tier:?} ascii {ascii} {cols}x{rows} row {i} width"
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn below_floor_shows_resize_message() {
        let m = Model::new(INSTALL_GROUPS);
        let logs = VecDeque::new();
        let v = view(&m, &logs, None);
        let grid = compose(&plain(), &v, TermSize { cols: 70, rows: 18 });
        assert!(grid.join("\n").contains("Terminal too small"));
    }

    #[test]
    fn split_shows_checklist_and_detail() {
        let mut m = Model::new(INSTALL_GROUPS);
        m.set_activity("fetch_binaries", "installing ados-control".into());
        let logs = VecDeque::new();
        let v = view(
            &m,
            &logs,
            group_index_for_step(INSTALL_GROUPS, "fetch_binaries"),
        );
        let joined = compose(
            &plain(),
            &v,
            TermSize {
                cols: 110,
                rows: 28,
            },
        )
        .join("\n");
        assert!(joined.contains("ADOS"), "header");
        assert!(joined.contains("Downloading components"), "checklist label");
        assert!(
            joined.contains("installing ados-control"),
            "activity headline"
        );
        assert!(joined.contains("4:12"), "total elapsed clock");
    }

    #[test]
    fn fmt_clock_is_mm_ss() {
        assert_eq!(fmt_clock(Duration::from_secs(5)), "0:05");
        assert_eq!(fmt_clock(Duration::from_secs(252)), "4:12");
    }
}
