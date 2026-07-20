//! The full-screen frame compositor for the onboarding wizard.
//!
//! Every screen is drawn as a three-zone layout centered on the terminal: a
//! header (a block-letter ADOS wordmark with a muted tagline), a progress rail
//! (filled and empty dots with a `Step N of M` label), the vertically-centered
//! body panel, and a footer key-hint bar. [`compose`] builds the whole screen
//! as a grid of `rows` full-width lines. It is a pure function of the terminal
//! size, the chrome, and the screen content, so it is snapshot-tested on any
//! host without a real terminal; [`to_ansi`] then turns a grid into the single
//! ANSI buffer that [`crate::ui::tty::Tty`] writes to `/dev/tty`.

use crate::ui::theme::Theme;
use crate::wizard::render::{self, center};

/// The smallest terminal the full-screen UI draws in. Below this it shows a
/// single centered "resize" message instead.
pub const MIN_COLS: usize = 72;
pub const MIN_ROWS: usize = 20;

/// The largest panel width, so the card stays a readable column on a wide
/// terminal instead of stretching edge to edge.
const MAX_PANEL: usize = 72;

/// The block-letter `ADOS` wordmark, three rows, fifteen columns each. Every
/// glyph is a single display column so the width math stays exact.
const BANNER: [&str; 3] = ["█▀█ █▀▄ █▀█ █▀▀", "█▀█ █░█ █░█ ▀▀█", "▀░▀ ▀▀░ ▀▀▀ ▀▀▀"];

/// The terminal size the frame is composed for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TermSize {
    pub cols: usize,
    pub rows: usize,
}

/// The persistent chrome around a screen: which step of how many, and its name
/// for the progress rail. `total == 0` hides the rail (the welcome screen).
#[derive(Debug, Clone, Default)]
pub struct Chrome {
    pub step: usize,
    pub total: usize,
    pub label: String,
}

/// The content of one screen: the corner-label section, the body lines (already
/// styled by the widget), and the footer key-hint text.
pub struct Screen<'a> {
    pub section: &'a str,
    pub body: &'a [String],
    pub footer: &'a str,
}

/// The outer panel width for a terminal of `cols` columns: capped so it stays a
/// readable column, floored by the leftover after the centering gutter.
pub fn panel_width(cols: usize) -> usize {
    cols.saturating_sub(4).min(MAX_PANEL)
}

/// Compose the whole screen as `size.rows` full-width lines. Below the minimum
/// size it returns the centered "resize" screen instead.
pub fn compose(theme: &Theme, chrome: &Chrome, screen: &Screen, size: TermSize) -> Vec<String> {
    let cols = size.cols.max(1);
    let rows = size.rows.max(1);
    if cols < MIN_COLS || rows < MIN_ROWS {
        return too_small(theme, size);
    }

    let blank = " ".repeat(cols);
    let mut grid = vec![blank; rows];

    // Header zone, pinned to the top.
    let header = header_block(theme, cols);
    let mut y = 0usize;
    for line in header {
        if y < rows {
            grid[y] = line;
        }
        y += 1;
    }
    y += 1; // one blank line under the header

    // Progress rail.
    if chrome.total > 0 && y < rows {
        grid[y] = rail_line(theme, chrome, cols);
        y += 1;
    }

    // Footer key-hint bar, pinned to the bottom row.
    let footer_row = rows - 1;
    grid[footer_row] = footer_line(theme, screen.footer, cols);

    // The body panel, centered in the space between the rail and the footer.
    let panel_w = panel_width(cols);
    let panel = render::panel(theme, screen.section, screen.body, panel_w);
    let panel_h = panel.len();
    let region_top = (y + 1).min(footer_row);
    let region_bot = footer_row.saturating_sub(2);
    let region_h = region_bot.saturating_sub(region_top) + 1;
    let start = region_top + region_h.saturating_sub(panel_h) / 2;
    let left = (cols - panel_w) / 2;
    for (i, cl) in panel.iter().enumerate() {
        let r = start + i;
        if r < footer_row && r < rows {
            grid[r] = compose_panel_line(cl, left, panel_w, cols);
        }
    }
    grid
}

/// Turn a composed grid into the single ANSI buffer written in one syscall.
/// `cleared` erases the screen first (first paint or after a resize); otherwise
/// each cell is simply overwritten in place, avoiding the clear-flicker of an
/// idle repaint. The charcoal background is set first so cleared and padded
/// cells are charcoal on the painting tiers.
pub fn to_ansi(grid: &[String], cleared: bool, theme: &Theme) -> String {
    let mut out = String::new();
    out.push_str(&theme.background_prefix());
    if cleared {
        out.push_str("\x1b[2J");
    }
    for (i, line) in grid.iter().enumerate() {
        out.push_str(&format!("\x1b[{};1H", i + 1));
        out.push_str(line);
    }
    out
}

/// A panel line placed at its centered column: left gutter, the line (its
/// visible width equals `panel_w`), then the right gutter to fill `cols`.
fn compose_panel_line(line: &str, left: usize, panel_w: usize, cols: usize) -> String {
    let right = cols.saturating_sub(left + panel_w);
    format!("{}{line}{}", " ".repeat(left), " ".repeat(right))
}

/// The header rows: the block wordmark plus a muted tagline on wide color
/// terminals, or a compact single-line wordmark on narrow / 16-color / plain
/// terminals.
fn header_block(theme: &Theme, cols: usize) -> Vec<String> {
    let big = !theme.ascii && cols >= 80 && theme.paints_background();
    if big {
        let mut out = Vec::with_capacity(BANNER.len() + 2);
        out.push(" ".repeat(cols)); // top margin
        for (i, row) in BANNER.iter().enumerate() {
            out.push(center(&theme.amber_gradient(i, row), cols));
        }
        out.push(center(&theme.dim("Onboarding your device"), cols));
        out
    } else {
        let mark = format!(
            "{} {} {} {}",
            theme.accent(render::wordmark(theme)),
            theme.heading("ADOS"),
            theme.dim(render::dot(theme)),
            theme.dim("Onboarding"),
        );
        vec![" ".repeat(cols), center(&mark, cols)]
    }
}

/// The progress rail: `● ● ○ ○ ○ ○   Step 2 of 6 · Hardware`, centered.
fn rail_line(theme: &Theme, chrome: &Chrome, cols: usize) -> String {
    let filled = chrome.step.min(chrome.total);
    let mut dots = String::new();
    for i in 1..=chrome.total {
        if i > 1 {
            dots.push(' ');
        }
        if i <= filled {
            dots.push_str(&theme.accent(theme.dot_filled()));
        } else {
            dots.push_str(&theme.dim(theme.dot_empty()));
        }
    }
    let text = theme.dim(&format!(
        "Step {} of {} {} {}",
        chrome.step,
        chrome.total,
        render::dot(theme),
        chrome.label
    ));
    center(&format!("{dots}   {text}"), cols)
}

/// The footer key-hint bar, muted and centered. An empty hint is a blank row.
fn footer_line(theme: &Theme, footer: &str, cols: usize) -> String {
    if footer.is_empty() {
        " ".repeat(cols)
    } else {
        center(&theme.dim(footer), cols)
    }
}

/// The screen shown when the terminal is below the minimum size: a single
/// centered message on the middle row.
fn too_small(theme: &Theme, size: TermSize) -> Vec<String> {
    let cols = size.cols.max(1);
    let rows = size.rows.max(1);
    let mut grid = vec![" ".repeat(cols); rows];
    let msg = format!("Terminal too small. Please resize to at least {MIN_COLS} x {MIN_ROWS}.");
    let mid = rows / 2;
    grid[mid] = center(&theme.warn(&msg), cols);
    grid
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ui::theme::ColorTier;

    fn plain() -> Theme {
        Theme {
            ascii: false,
            tier: ColorTier::None,
        }
    }

    fn chrome() -> Chrome {
        Chrome {
            step: 2,
            total: 6,
            label: "Hardware".into(),
        }
    }

    fn body() -> Vec<String> {
        vec![
            "What is this device?".into(),
            String::new(),
            " ❯ This flies (Drone)".into(),
        ]
    }

    #[test]
    fn every_line_is_exactly_cols_wide_with_color_off() {
        let b = body();
        let screen = Screen {
            section: "setup",
            body: &b,
            footer: "Enter to choose",
        };
        let size = TermSize {
            cols: 100,
            rows: 30,
        };
        let grid = compose(&plain(), &chrome(), &screen, size);
        assert_eq!(grid.len(), 30, "one line per row");
        for (i, line) in grid.iter().enumerate() {
            assert_eq!(
                line.chars().count(),
                100,
                "row {i} not exactly 100 cols: {line:?}"
            );
        }
    }

    #[test]
    fn header_rail_footer_and_body_are_present() {
        let b = body();
        let screen = Screen {
            section: "setup",
            body: &b,
            footer: "Enter to choose",
        };
        let grid = compose(
            &plain(),
            &chrome(),
            &screen,
            TermSize {
                cols: 100,
                rows: 30,
            },
        );
        let joined = grid.join("\n");
        assert!(joined.contains("ADOS"), "header wordmark missing");
        assert!(joined.contains("Step 2 of 6"), "progress rail missing");
        assert!(joined.contains("Hardware"), "rail label missing");
        assert!(joined.contains("What is this device?"), "body missing");
        assert!(grid.last().unwrap().contains("Enter to choose"), "footer");
    }

    #[test]
    fn the_body_panel_is_horizontally_centered() {
        // The corner-label border row carries "ADOS · setup"; find it and check
        // it has a left gutter (leading spaces) and a matching right gutter.
        let b = body();
        let screen = Screen {
            section: "setup",
            body: &b,
            footer: "Enter",
        };
        let grid = compose(
            &plain(),
            &chrome(),
            &screen,
            TermSize {
                cols: 100,
                rows: 30,
            },
        );
        let border = grid
            .iter()
            .find(|l| l.contains("ADOS · setup"))
            .expect("panel top border not found");
        let lead = border.len() - border.trim_start().len();
        let trail = border.len() - border.trim_end().len();
        assert!(lead > 0, "panel not indented from the left edge");
        // Centered: left and right gutters differ by at most one column.
        assert!(
            lead.abs_diff(trail) <= 1,
            "panel not centered: lead {lead} trail {trail}"
        );
    }

    #[test]
    fn floor_size_composes_the_full_ui() {
        let b = body();
        let screen = Screen {
            section: "setup",
            body: &b,
            footer: "Enter",
        };
        let grid = compose(
            &plain(),
            &chrome(),
            &screen,
            TermSize {
                cols: MIN_COLS,
                rows: MIN_ROWS,
            },
        );
        assert_eq!(grid.len(), MIN_ROWS);
        let joined = grid.join("\n");
        assert!(
            joined.contains("What is this device?"),
            "body clipped at floor"
        );
        for line in &grid {
            assert_eq!(line.chars().count(), MIN_COLS);
        }
    }

    #[test]
    fn below_floor_shows_the_resize_message() {
        let b = body();
        let screen = Screen {
            section: "setup",
            body: &b,
            footer: "Enter",
        };
        let grid = compose(
            &plain(),
            &chrome(),
            &screen,
            TermSize { cols: 70, rows: 18 },
        );
        assert_eq!(grid.len(), 18);
        let joined = grid.join("\n");
        assert!(
            joined.contains("Terminal too small"),
            "resize message missing"
        );
        assert!(joined.contains("72 x 20"), "floor size not named");
        assert!(
            !joined.contains("What is this device?"),
            "body drawn while too small"
        );
    }

    #[test]
    fn welcome_has_no_rail_when_total_is_zero() {
        let b = body();
        let screen = Screen {
            section: "setup",
            body: &b,
            footer: "Enter",
        };
        let grid = compose(
            &plain(),
            &Chrome::default(),
            &screen,
            TermSize {
                cols: 100,
                rows: 30,
            },
        );
        assert!(
            !grid.join("\n").contains("Step "),
            "rail shown with no steps"
        );
    }

    #[test]
    fn amber_selection_bar_shows_on_a_truecolor_frame() {
        let theme = Theme {
            ascii: false,
            tier: ColorTier::Truecolor,
        };
        // A body whose selected row is a full-width amber bar.
        let inner = render::panel_body_width(panel_width(100));
        let selected = theme.selection_bar("● This flies (Drone)", inner);
        let b = vec![
            theme.heading("What is this device?"),
            String::new(),
            selected,
        ];
        let screen = Screen {
            section: "setup",
            body: &b,
            footer: "Enter to choose",
        };
        let grid = compose(
            &theme,
            &chrome(),
            &screen,
            TermSize {
                cols: 100,
                rows: 30,
            },
        );
        let joined = grid.join("\n");
        assert!(
            joined.contains("\x1b[48;2;235;193;87m"),
            "amber selection bar not present in frame"
        );
        // The block wordmark is drawn with the amber gradient on a wide truecolor
        // terminal.
        assert!(
            joined.contains('█'),
            "block wordmark missing on wide truecolor"
        );
    }

    #[test]
    fn to_ansi_positions_lines_and_sets_background_on_truecolor() {
        let theme = Theme {
            ascii: false,
            tier: ColorTier::Truecolor,
        };
        let grid = vec!["one".to_string(), "two".to_string()];
        let out = to_ansi(&grid, true, &theme);
        assert!(
            out.starts_with("\x1b[48;2;31;31;31m"),
            "charcoal bg prefix missing"
        );
        assert!(out.contains("\x1b[2J"), "clear missing when cleared");
        assert!(out.contains("\x1b[1;1Hone"), "row 1 not positioned");
        assert!(out.contains("\x1b[2;1Htwo"), "row 2 not positioned");
        // A non-clearing repaint omits the erase.
        let repaint = to_ansi(&grid, false, &theme);
        assert!(!repaint.contains("\x1b[2J"), "erase on an in-place repaint");
    }
}
