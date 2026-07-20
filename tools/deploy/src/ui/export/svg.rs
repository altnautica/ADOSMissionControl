//! Render a styled `compose()` grid to a standalone SVG — crisp, scalable, and
//! theme-neutral, faithful because it consumes the live render's cells.

use super::ansi_cells::{parse_grid, Cell, CHARCOAL};

const CW: f32 = 8.4; // monospace char advance (px at 14px)
const LH: f32 = 18.0; // line height (px)
const PAD: f32 = 14.0; // outer padding (px)
const FS: f32 = 14.0; // font size (px)
const BASELINE: f32 = 13.5; // text baseline within a line
const FONT: &str = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

/// Render the grid to an SVG document string.
pub fn to_svg(lines: &[String]) -> String {
    let grid = parse_grid(lines);
    let cols = grid.iter().map(|r| r.len()).max().unwrap_or(0);
    let rows = grid.len();
    let w = PAD * 2.0 + cols as f32 * CW;
    let h = PAD * 2.0 + rows as f32 * LH;

    let mut s = String::new();
    s.push_str(&format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {w:.0} {h:.0}\" width=\"{w:.0}\" height=\"{h:.0}\" font-family=\"{FONT}\" font-size=\"{FS}\">\n"
    ));
    s.push_str(&format!(
        "<rect width=\"{w:.0}\" height=\"{h:.0}\" fill=\"{}\" rx=\"8\"/>\n",
        hex(CHARCOAL)
    ));

    // Background rects first (selection bars), then text on top.
    for (r, row) in grid.iter().enumerate() {
        let y = PAD + r as f32 * LH;
        emit_bg_runs(&mut s, row, y);
    }
    for (r, row) in grid.iter().enumerate() {
        let y = PAD + r as f32 * LH + BASELINE;
        emit_text_runs(&mut s, row, y);
    }
    s.push_str("</svg>\n");
    s
}

fn emit_bg_runs(s: &mut String, row: &[Cell], y: f32) {
    let mut c = 0;
    while c < row.len() {
        let bg = row[c].bg;
        if bg == CHARCOAL {
            c += 1;
            continue;
        }
        let start = c;
        while c < row.len() && row[c].bg == bg {
            c += 1;
        }
        let x = PAD + start as f32 * CW;
        let rw = (c - start) as f32 * CW;
        s.push_str(&format!(
            "<rect x=\"{x:.1}\" y=\"{y:.1}\" width=\"{rw:.1}\" height=\"{LH}\" fill=\"{}\"/>\n",
            hex(bg)
        ));
    }
}

fn emit_text_runs(s: &mut String, row: &[Cell], y: f32) {
    let mut c = 0;
    while c < row.len() {
        let start = c;
        let fg = row[c].fg;
        let bold = row[c].bold;
        let mut text = String::new();
        while c < row.len() && row[c].fg == fg && row[c].bold == bold {
            text.push(row[c].ch);
            c += 1;
        }
        if text.trim().is_empty() {
            continue;
        }
        let x = PAD + start as f32 * CW;
        let weight = if bold { " font-weight=\"700\"" } else { "" };
        s.push_str(&format!(
            "<text x=\"{x:.1}\" y=\"{y:.1}\" fill=\"{}\"{weight} xml:space=\"preserve\">{}</text>\n",
            hex(fg),
            xml_escape(&text)
        ));
    }
}

fn hex((r, g, b): (u8, u8, u8)) -> String {
    format!("#{r:02x}{g:02x}{b:02x}")
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn svg_has_svg_root_and_charcoal_bg() {
        let svg = to_svg(&["hello".to_string()]);
        assert!(svg.starts_with("<svg"));
        assert!(svg.contains(&hex(CHARCOAL)));
        assert!(svg.contains("hello"));
        assert!(svg.ends_with("</svg>\n"));
    }

    #[test]
    fn amber_run_emits_amber_fill() {
        let svg = to_svg(&["\x1b[38;2;235;193;87mAmber\x1b[39m".to_string()]);
        assert!(svg.contains("#ebc157"));
    }
}
