//! Parse a styled `compose()` grid line into a matrix of colored cells.
//!
//! The theme emits truecolor SGR: `\x1b[38;2;r;g;bm` (fg) / `\x1b[48;2;r;g;bm`
//! (bg, the selection bar) / `\x1b[1m`..`\x1b[22m` (bold) / `\x1b[39m` (fg reset).
//! A `compose()` line carries those over an implicit charcoal background (added
//! once by `frame::to_ansi` for the terminal). The exporter re-materializes that
//! background per cell so the SVG/HTML asset is a faithful, standalone render.

/// The charcoal screen background (the theme's `CHARCOAL`).
pub const CHARCOAL: (u8, u8, u8) = (31, 31, 31);
/// The default foreground for un-styled text (a light gray).
pub const DEFAULT_FG: (u8, u8, u8) = (210, 210, 210);

/// One rendered cell.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Cell {
    pub ch: char,
    pub fg: (u8, u8, u8),
    pub bg: (u8, u8, u8),
    pub bold: bool,
}

/// Parse one styled line into cells (visible chars only; escapes update state).
pub fn parse_line(line: &str) -> Vec<Cell> {
    let mut cells = Vec::new();
    let mut fg = DEFAULT_FG;
    let mut bg = CHARCOAL;
    let mut bold = false;
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
            }
            let mut params = String::new();
            for pc in chars.by_ref() {
                if pc.is_ascii_alphabetic() {
                    break; // terminator (typically 'm')
                }
                params.push(pc);
            }
            apply_sgr(&params, &mut fg, &mut bg, &mut bold);
        } else {
            cells.push(Cell {
                ch: c,
                fg,
                bg,
                bold,
            });
        }
    }
    cells
}

/// Parse a whole grid.
pub fn parse_grid(lines: &[String]) -> Vec<Vec<Cell>> {
    lines.iter().map(|l| parse_line(l)).collect()
}

fn apply_sgr(params: &str, fg: &mut (u8, u8, u8), bg: &mut (u8, u8, u8), bold: &mut bool) {
    let parts: Vec<&str> = params.split(';').collect();
    let mut i = 0;
    while i < parts.len() {
        match parts[i] {
            "0" | "" => {
                *fg = DEFAULT_FG;
                *bg = CHARCOAL;
                *bold = false;
            }
            "1" => *bold = true,
            "22" => *bold = false,
            "39" => *fg = DEFAULT_FG,
            "49" => *bg = CHARCOAL,
            "38" if parts.get(i + 1) == Some(&"2") => {
                if let Some(rgb) = rgb_at(&parts, i + 2) {
                    *fg = rgb;
                }
                i += 4;
            }
            "48" if parts.get(i + 1) == Some(&"2") => {
                if let Some(rgb) = rgb_at(&parts, i + 2) {
                    *bg = rgb;
                }
                i += 4;
            }
            _ => {}
        }
        i += 1;
    }
}

fn rgb_at(parts: &[&str], i: usize) -> Option<(u8, u8, u8)> {
    let r = parts.get(i)?.parse().ok()?;
    let g = parts.get(i + 1)?.parse().ok()?;
    let b = parts.get(i + 2)?.parse().ok()?;
    Some((r, g, b))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_text_is_default_fg_on_charcoal() {
        let cells = parse_line("Hi");
        assert_eq!(cells.len(), 2);
        assert_eq!(cells[0].ch, 'H');
        assert_eq!(cells[0].fg, DEFAULT_FG);
        assert_eq!(cells[0].bg, CHARCOAL);
        assert!(!cells[0].bold);
    }

    #[test]
    fn amber_fg_then_reset() {
        let cells = parse_line("\x1b[38;2;235;193;87mA\x1b[39mB");
        assert_eq!(cells[0].fg, (235, 193, 87));
        assert_eq!(cells[1].fg, DEFAULT_FG);
    }

    #[test]
    fn selection_bar_bg_and_dark_fg() {
        // Amber bg + dark fg + charcoal restore, as `selection_bar` emits.
        let cells =
            parse_line("\x1b[48;2;235;193;87m\x1b[38;2;26;26;26mX\x1b[48;2;31;31;31m\x1b[39mY");
        assert_eq!(cells[0].bg, (235, 193, 87));
        assert_eq!(cells[0].fg, (26, 26, 26));
        assert_eq!(cells[1].bg, CHARCOAL);
    }

    #[test]
    fn bold_toggles() {
        let cells = parse_line("\x1b[1mA\x1b[22mB");
        assert!(cells[0].bold);
        assert!(!cells[1].bold);
    }
}
