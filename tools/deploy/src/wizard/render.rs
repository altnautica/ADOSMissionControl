//! The card panel + ANSI-width helpers for the onboarding wizard.
//!
//! A wizard screen's body is drawn inside a rounded [`panel`] with a corner
//! label on the top edge (`ADOS · setup`). The panel's body lines carry their
//! own color from [`crate::ui::theme`]; the framing here is ANSI-width-aware so
//! a colored body line still aligns to the right border. The header wordmark,
//! progress rail, and footer key-hint live in [`crate::wizard::frame`], which
//! centers the panel on the full screen.

use crate::ui::theme::Theme;

/// The accent cursor gutter shown on the highlighted row.
pub fn cursor_glyph(theme: &Theme) -> &'static str {
    if theme.ascii {
        ">"
    } else {
        "❯"
    }
}

/// The `▌` word-mark used in the compact header, with an ASCII fallback.
pub fn wordmark(theme: &Theme) -> &'static str {
    if theme.ascii {
        "#"
    } else {
        "▌"
    }
}

/// The `·` dot separator used in labels + hint text, with an ASCII fallback.
pub fn dot(theme: &Theme) -> &'static str {
    if theme.ascii {
        "-"
    } else {
        "·"
    }
}

/// Build a rounded panel: an accent top border carrying the corner label
/// (`╭─ ADOS · setup ─────╮`), the body lines, and a plain accent bottom
/// border. `width` is the panel's outer column count; every returned line is
/// exactly `width` display columns wide. The key-hint bar lives in the footer
/// zone, not on the bottom border.
pub fn panel(theme: &Theme, label: &str, body: &[String], width: usize) -> Vec<String> {
    let bc = theme.box_chars();
    let content_w = width.saturating_sub(2);
    let body_w = content_w.saturating_sub(2);

    let corner = format!("ADOS {} {label}", dot(theme));
    let mut out = Vec::with_capacity(body.len() + 2);
    out.push(theme.accent(&titled_border(bc.tl, bc.tr, bc.h, &corner, content_w)));
    let v = theme.accent(bc.v);
    for line in body {
        out.push(format!("{v} {} {v}", fit_to(line, body_w)));
    }
    out.push(theme.accent(&plain_border(bc.bl, bc.br, bc.h, content_w)));
    out
}

/// The inner text width a [`panel`] of outer `width` gives its body lines
/// (outer minus two borders minus the two padding spaces).
pub fn panel_body_width(width: usize) -> usize {
    width.saturating_sub(4)
}

/// Build one titled border line: `╭─ <title> ────────╮`. `content_w` is the
/// interior column count (panel width minus the two corner glyphs), so the
/// returned line is exactly `content_w + 2` columns, matching the body rows.
fn titled_border(left: &str, right: &str, h: &str, title: &str, content_w: usize) -> String {
    let lead = format!("{} {} ", h, truncate(title, content_w.saturating_sub(4)));
    let dashes = content_w.saturating_sub(lead.chars().count());
    format!("{left}{lead}{}{right}", h.repeat(dashes))
}

/// Build one plain border line: `╰──────────╯`, exactly `content_w + 2` columns.
fn plain_border(left: &str, right: &str, h: &str, content_w: usize) -> String {
    format!("{left}{}{right}", h.repeat(content_w))
}

/// Truncate to `max` display columns, appending an ellipsis when it would clip.
pub fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    if max == 0 {
        return String::new();
    }
    let mut out: String = s.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

/// Right-pad `s` to `w` *visible* columns, ignoring embedded ANSI SGR escapes so
/// a colored body line still aligns to the box border. A line whose visible
/// content overflows `w` is stripped of styling and hard-truncated.
pub fn fit_to(s: &str, w: usize) -> String {
    let vis = visible_width(s);
    if vis <= w {
        format!("{s}{}", " ".repeat(w - vis))
    } else {
        let plain = truncate(&strip_ansi(s), w);
        let pad = w.saturating_sub(plain.chars().count());
        format!("{plain}{}", " ".repeat(pad))
    }
}

/// Center `s` in `w` visible columns, padding both sides with spaces. Overflow
/// is stripped of styling and hard-truncated to `w`.
pub fn center(s: &str, w: usize) -> String {
    let vis = visible_width(s);
    if vis >= w {
        return fit_to(s, w);
    }
    let total = w - vis;
    let left = total / 2;
    let right = total - left;
    format!("{}{s}{}", " ".repeat(left), " ".repeat(right))
}

/// The number of display columns `s` occupies, skipping ANSI SGR escapes.
pub fn visible_width(s: &str) -> usize {
    let mut width = 0;
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            for nc in chars.by_ref() {
                if nc == 'm' {
                    break;
                }
            }
        } else {
            width += 1;
        }
    }
    width
}

/// Drop ANSI SGR escape sequences, leaving the visible text.
pub fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            for nc in chars.by_ref() {
                if nc == 'm' {
                    break;
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ui::theme::ColorTier;

    fn theme() -> Theme {
        Theme {
            ascii: false,
            tier: ColorTier::None,
        }
    }

    #[test]
    fn panel_rows_are_exactly_the_width_with_color_off() {
        let t = theme();
        let body = vec!["hello".to_string(), "world".to_string()];
        let width = 50;
        for line in panel(&t, "setup", &body, width) {
            assert_eq!(
                line.chars().count(),
                width,
                "panel line not exactly {width} cols: {line:?}"
            );
        }
    }

    #[test]
    fn panel_carries_the_corner_label() {
        let t = theme();
        let lines = panel(&t, "setup", &["body".to_string()], 50);
        assert!(lines.first().unwrap().contains("ADOS"));
        assert!(lines.first().unwrap().contains("setup"));
        // The bottom border is plain (no key-hint on it).
        assert!(!lines.last().unwrap().contains("Enter"));
    }

    #[test]
    fn panel_body_width_is_outer_minus_four() {
        assert_eq!(panel_body_width(50), 46);
        assert_eq!(panel_body_width(3), 0);
    }

    #[test]
    fn center_pads_both_sides_by_visible_width() {
        assert_eq!(center("ab", 6), "  ab  ");
        // A colored 2-column span centers by its visible width.
        let colored = "\x1b[36m x\x1b[39m"; // visible " x" = 2 cols
        assert_eq!(visible_width(&center(colored, 8)), 8);
    }

    #[test]
    fn fit_to_pads_visible_width_ignoring_ansi() {
        let colored = "\x1b[36m x\x1b[39m"; // visible " x" = 2 cols
        let out = fit_to(colored, 6);
        assert_eq!(visible_width(&out), 6);
    }

    #[test]
    fn truncate_adds_ellipsis() {
        assert_eq!(truncate("hello", 10), "hello");
        assert_eq!(truncate("hello world", 5), "hell…");
    }

    #[test]
    fn visible_width_and_strip_ignore_escapes() {
        let colored = "\x1b[36m❯\x1b[39m";
        assert_eq!(visible_width(colored), 1);
        assert_eq!(strip_ansi(colored), "❯");
    }
}
