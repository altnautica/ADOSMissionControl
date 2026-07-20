//! The rich renderer: a live, pinned status block with logs scrolling above it.
//!
//! Implemented as a manual crossterm "sticky block": it only ever *writes* to
//! stderr (move-up + clear-down + reprint), so it never queries the cursor
//! position or enables raw mode — the parts that break when stdin is a pipe
//! under `curl … | sudo bash`. A render-only design also means no event loop and
//! no stdin at all. The spinner animates on a recv timeout so a long step (apt,
//! DKMS) still shows life.

use std::collections::VecDeque;
use std::io::{self, Write};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::Duration;

use ratatui::crossterm::{
    cursor,
    style::Print,
    terminal::{Clear, ClearType},
};

use crate::ui::events::{GroupMap, ProgressEvent, SummaryData};
use crate::ui::model::{fmt_dur, GStatus, Group, Model};
use crate::ui::summary;
use crate::ui::theme::Theme;

/// Spinner cadence + log-ring depth.
const TICK_MS: u64 = 120;
const LOG_RING_CAP: usize = 12;

/// Run the rich renderer to completion. Consumes events until `Finished`.
pub fn run(rx: Receiver<ProgressEvent>, theme: Theme, header: String, groups: GroupMap) {
    let stderr = io::stderr();
    let mut w = stderr.lock();
    let _ = cursor_hide(&mut w);
    let _ = writeln!(w, "{}", theme.accent(&header));
    let _ = w.flush();

    let mut model = Model::new(groups);
    let mut spinner = 0usize;
    let mut height = 0usize;
    let mut logs: VecDeque<String> = VecDeque::with_capacity(LOG_RING_CAP);
    let mut summary: Option<Box<SummaryData>> = None;

    draw_block(&mut w, &model, &theme, spinner, &mut height);

    loop {
        match rx.recv_timeout(Duration::from_millis(TICK_MS)) {
            Ok(ProgressEvent::StepStarted { id }) => {
                model.start(&id);
                draw_block(&mut w, &model, &theme, spinner, &mut height);
            }
            Ok(ProgressEvent::StepResult { id, outcome }) => {
                model.record(&id, &outcome);
                draw_block(&mut w, &model, &theme, spinner, &mut height);
            }
            Ok(ProgressEvent::SubProgress { id, done, total }) => {
                model.set_sub(&id, done, total);
                draw_block(&mut w, &model, &theme, spinner, &mut height);
            }
            Ok(ProgressEvent::Activity { message, .. }) => {
                push_log(&mut logs, message.clone());
                emit_log(&mut w, &message, &model, &theme, spinner, &mut height);
            }
            Ok(ProgressEvent::SubLog { line, .. }) => {
                push_log(&mut logs, line.clone());
                emit_log(&mut w, &line, &model, &theme, spinner, &mut height);
            }
            // The k-of-N `SubProgress` already drives this fallback tier's bar;
            // the byte-level detail is a full-screen-only refinement.
            Ok(ProgressEvent::ByteProgress { .. }) => {}
            Ok(ProgressEvent::Log { line, .. }) => {
                push_log(&mut logs, line.clone());
                emit_log(&mut w, &line, &model, &theme, spinner, &mut height);
            }
            Ok(ProgressEvent::Summary(s)) => summary = Some(s),
            Ok(ProgressEvent::Finished) => break,
            Err(RecvTimeoutError::Timeout) => {
                spinner = spinner.wrapping_add(1);
                draw_block(&mut w, &model, &theme, spinner, &mut height);
            }
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }

    erase_block(&mut w, &mut height);
    let _ = cursor_show(&mut w);
    if let Some(s) = summary {
        for line in summary::rich_lines(&s, &theme, &logs) {
            let _ = writeln!(w, "{line}");
        }
    }
    let _ = w.flush();
}

/// Box width: terminal columns, clamped to a tidy range.
fn box_width() -> usize {
    let cols = ratatui::crossterm::terminal::size()
        .map(|(c, _)| c as usize)
        .unwrap_or(80);
    cols.saturating_sub(2).clamp(40, 64)
}

/// Redraw the pinned block in place (move to its top, clear, reprint).
fn draw_block(
    w: &mut impl Write,
    model: &Model,
    theme: &Theme,
    spinner: usize,
    height: &mut usize,
) {
    let lines = block_lines(model, theme, spinner, box_width());
    rewind(w, *height);
    for l in &lines {
        let _ = ratatui::crossterm::queue!(w, Print(l), Print("\r\n"));
    }
    *height = lines.len();
    let _ = w.flush();
}

/// Scroll one log line into the permanent history above the block.
fn emit_log(
    w: &mut impl Write,
    line: &str,
    model: &Model,
    theme: &Theme,
    spinner: usize,
    height: &mut usize,
) {
    rewind(w, *height);
    let text = truncate(line, box_width().saturating_sub(2));
    let _ = ratatui::crossterm::queue!(w, Print(theme.dim(&format!("  {text}"))), Print("\r\n"));
    let lines = block_lines(model, theme, spinner, box_width());
    for l in &lines {
        let _ = ratatui::crossterm::queue!(w, Print(l), Print("\r\n"));
    }
    *height = lines.len();
    let _ = w.flush();
}

/// Erase the live block entirely (used before printing the final summary).
fn erase_block(w: &mut impl Write, height: &mut usize) {
    if *height > 0 {
        rewind(w, *height);
        *height = 0;
        let _ = w.flush();
    }
}

/// Move the cursor to the top of the current block and clear everything below.
fn rewind(w: &mut impl Write, height: usize) {
    if height > 0 {
        let _ = ratatui::crossterm::queue!(w, cursor::MoveToPreviousLine(height as u16));
    }
    let _ = ratatui::crossterm::queue!(w, Clear(ClearType::FromCursorDown));
}

fn cursor_hide(w: &mut impl Write) -> io::Result<()> {
    ratatui::crossterm::execute!(w, cursor::Hide)
}
fn cursor_show(w: &mut impl Write) -> io::Result<()> {
    ratatui::crossterm::execute!(w, cursor::Show)
}

fn push_log(logs: &mut VecDeque<String>, line: String) {
    if logs.len() == LOG_RING_CAP {
        logs.pop_front();
    }
    logs.push_back(line);
}

/// The full block: top border, one row per group, bottom border.
fn block_lines(model: &Model, theme: &Theme, spinner: usize, width: usize) -> Vec<String> {
    let bc = theme.box_chars();
    let content_w = width.saturating_sub(2);
    let mut out = Vec::with_capacity(model.groups.len() + 2);
    out.push(top_border(theme, content_w, model));
    for g in &model.groups {
        out.push(group_row(theme, bc.v, content_w, g, spinner));
    }
    out.push(bottom_border(theme, content_w));
    out
}

/// `╭─ ADOS Drone Agent · installing ──── step 4/10 ─╮`
fn top_border(theme: &Theme, content_w: usize, model: &Model) -> String {
    let bc = theme.box_chars();
    let title = "ADOS Drone Agent · installing";
    let counter = format!("step {}/{}", model.finalized(), model.total());
    let lead = format!("{} {} ", bc.h, title);
    let tail = format!(" {} {}", counter, bc.h);
    let dashes = content_w.saturating_sub(lead.chars().count() + tail.chars().count());
    let inner = format!("{}{}{}", lead, bc.h.repeat(dashes), tail);
    theme.accent(&format!("{}{}{}", bc.tl, inner, bc.tr))
}

fn bottom_border(theme: &Theme, content_w: usize) -> String {
    let bc = theme.box_chars();
    theme.accent(&format!("{}{}{}", bc.bl, bc.h.repeat(content_w), bc.br))
}

/// One group row: `│ ✓ Building radio stack            0:42 │`.
fn group_row(theme: &Theme, vbar: &str, content_w: usize, g: &Group, spinner: usize) -> String {
    let body_w = content_w.saturating_sub(2); // the 1-space pad on each side
    let glyph_plain = glyph_for(theme, g.status, spinner);
    let glyph_colored = color_glyph(theme, g.status, glyph_plain);

    let detail_plain = detail_for(theme, g);
    let detail_w = detail_plain.chars().count();
    // Reserve: glyph(1) + space(1) + at least one gap before the detail.
    let label_max = body_w.saturating_sub(2 + detail_w + 1);
    let label = truncate(g.label, label_max);
    let used = 2 + label.chars().count() + detail_w;
    let pad = body_w.saturating_sub(used);
    let detail_colored = color_detail(theme, g, &detail_plain);

    let body = format!("{glyph_colored} {label}{}{detail_colored}", " ".repeat(pad));
    let v = theme.accent(vbar);
    format!("{v} {body} {v}")
}

fn glyph_for(theme: &Theme, status: GStatus, spinner: usize) -> &'static str {
    match status {
        GStatus::Ok | GStatus::Skipped => theme.glyph_ok(),
        GStatus::Failed => theme.glyph_fail(),
        GStatus::Running => theme.spinner(spinner),
        GStatus::Pending => theme.glyph_pending(),
    }
}

fn color_glyph(theme: &Theme, status: GStatus, glyph: &str) -> String {
    match status {
        GStatus::Ok => theme.ok(glyph),
        GStatus::Failed => theme.fail(glyph),
        GStatus::Running => theme.accent(glyph),
        GStatus::Skipped | GStatus::Pending => theme.dim(glyph),
    }
}

/// The right-aligned detail (plain text; width is measured for padding).
fn detail_for(theme: &Theme, g: &Group) -> String {
    match g.status {
        GStatus::Ok | GStatus::Failed => g.elapsed.map(fmt_dur).unwrap_or_default(),
        GStatus::Skipped => "cached".to_string(),
        GStatus::Running => match g.sub {
            Some((done, total)) => progress_bar(theme, done, total),
            None => g.elapsed_now().map(fmt_dur).unwrap_or_default(),
        },
        GStatus::Pending => String::new(),
    }
}

fn color_detail(theme: &Theme, g: &Group, plain: &str) -> String {
    if g.status == GStatus::Running && g.sub.is_some() {
        theme.accent(plain)
    } else {
        theme.dim(plain)
    }
}

/// `▕██████░░▏ 63%` (or `[######..] 63%` in the ASCII tier).
fn progress_bar(theme: &Theme, done: u64, total: u64) -> String {
    const CELLS: u64 = 8;
    // checked_div yields None on a zero total (nothing known yet → empty bar).
    let frac = done
        .saturating_mul(CELLS)
        .checked_div(total)
        .unwrap_or(0)
        .min(CELLS);
    let pct = done
        .saturating_mul(100)
        .checked_div(total)
        .unwrap_or(0)
        .min(100);
    let (l, r, fill, empty) = if theme.ascii {
        ("[", "]", "#", ".")
    } else {
        ("▕", "▏", "█", "░")
    };
    format!(
        "{l}{}{}{r} {pct}%",
        fill.repeat(frac as usize),
        empty.repeat((CELLS - frac) as usize)
    )
}

/// Truncate to `max` display columns, appending an ellipsis when it would clip.
fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    if max == 0 {
        return String::new();
    }
    let take = max.saturating_sub(1);
    let mut out: String = s.chars().take(take).collect();
    out.push('…');
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph::StepOutcome;

    fn theme() -> Theme {
        Theme {
            ascii: false,
            tier: crate::ui::theme::ColorTier::None,
        }
    }

    #[test]
    fn block_lines_count_is_groups_plus_borders() {
        let m = Model::new(crate::ui::events::INSTALL_GROUPS);
        let lines = block_lines(&m, &theme(), 0, 58);
        assert_eq!(lines.len(), m.groups.len() + 2);
    }

    #[test]
    fn rows_fit_the_width_when_color_is_off() {
        // With color off there are no SGR escapes, so chars() == display width.
        let mut m = Model::new(crate::ui::events::INSTALL_GROUPS);
        m.record("deps", &StepOutcome::Ok);
        let width = 58;
        for line in block_lines(&m, &theme(), 0, width) {
            assert_eq!(
                line.chars().count(),
                width,
                "line not exactly width {width}: {line:?}"
            );
        }
    }

    #[test]
    fn progress_bar_clamps_and_formats() {
        let t = theme();
        assert!(progress_bar(&t, 0, 0).contains("0%"));
        assert!(progress_bar(&t, 5, 10).contains("50%"));
        let full = progress_bar(&t, 10, 10);
        assert!(full.contains("100%"));
    }

    #[test]
    fn truncate_adds_ellipsis() {
        assert_eq!(truncate("hello", 10), "hello");
        assert_eq!(truncate("hello world", 5), "hell…");
    }
}
