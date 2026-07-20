//! Color + glyph theme for the terminal UI, with capability tiers.
//!
//! The palette is amber-on-charcoal: a charcoal background, near-white
//! headings, muted gray body text, and a single amber accent for what is
//! selected or acted on. Destructive is a salmon red, success a soft green.
//!
//! Color is emitted at the tier the terminal can show: truecolor (24-bit RGB),
//! a 256-color fallback (nearest xterm index), a basic 16-color fallback, or
//! plain text when there is no color at all. Every styled span resets only the
//! foreground (`ESC[39m`) or the bold attribute (`ESC[22m`), never the whole
//! SGR state, so the charcoal background painted once per frame is preserved
//! across padding and borders. Only the selection bar changes the background,
//! and it restores the charcoal base itself.
//!
//! Glyphs (marks, spinner, box drawing) are keyed on an ASCII tier for
//! `--ascii`, non-UTF-8 locales, and basic terminals. Width math elsewhere
//! counts `chars()`, so every glyph here is one display column.

/// An RGB color for the truecolor tier.
type Rgb = (u8, u8, u8);

// --- palette ---------------------------------------------------------------

/// Charcoal screen background.
const CHARCOAL: Rgb = (31, 31, 31);
const CHARCOAL_256: u8 = 234;
/// Amber accent (selected / acted-on).
const AMBER: Rgb = (235, 193, 87);
const AMBER_256: u8 = 179;
/// Lighter and deeper amber for the wordmark's vertical gradient.
const AMBER_LIGHT: Rgb = (242, 214, 138);
const AMBER_DEEP: Rgb = (201, 155, 62);
/// Near-white heading text.
const HEADING: Rgb = (233, 233, 233);
const HEADING_256: u8 = 254;
/// Muted gray body / description text.
const MUTED: Rgb = (138, 138, 138);
const MUTED_256: u8 = 245;
/// Destructive salmon red.
const DANGER: Rgb = (224, 108, 90);
const DANGER_256: u8 = 209;
/// Success green.
const SUCCESS: Rgb = (121, 200, 121);
const SUCCESS_256: u8 = 114;
/// Warning yellow.
const WARNING: Rgb = (227, 199, 102);
const WARNING_256: u8 = 179;
/// Dark text drawn on top of the amber selection bar.
const ON_AMBER: Rgb = (26, 26, 26);
const ON_AMBER_256: u8 = 235;

/// The braille spinner frames (the modern gold standard).
const SPIN_UNICODE: &[&str] = &["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
/// ASCII spinner fallback.
const SPIN_ASCII: &[&str] = &["-", "\\", "|", "/"];

/// How much color the terminal can render.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ColorTier {
    /// 24-bit RGB (`COLORTERM=truecolor`).
    Truecolor,
    /// 256-color indexed (`TERM=*-256color`).
    Ansi256,
    /// Basic 16-color (bold + named foreground).
    Basic,
    /// No color: `NO_COLOR`, `--no-color`, `TERM=dumb`, or not a terminal.
    None,
}

/// Box-drawing glyphs (rounded) and their ASCII fallbacks.
pub struct BoxChars {
    pub tl: &'static str,
    pub tr: &'static str,
    pub bl: &'static str,
    pub br: &'static str,
    pub h: &'static str,
    pub v: &'static str,
}

/// Resolved color + glyph capability for this run.
#[derive(Debug, Clone, Copy)]
pub struct Theme {
    /// Use the ASCII glyph tier (no Unicode box/spinner/marks).
    pub ascii: bool,
    /// The color depth to emit at.
    pub tier: ColorTier,
}

impl Theme {
    /// Resolve from the flags + environment. `NO_COLOR` (any value) or
    /// `--no-color` disables color; `--ascii` or a non-UTF-8 locale selects the
    /// ASCII glyph tier. The color depth comes from `COLORTERM` + `TERM`.
    pub fn detect(no_color_flag: bool, ascii_flag: bool) -> Theme {
        let no_color = std::env::var_os("NO_COLOR").is_some() || no_color_flag;
        Theme {
            ascii: ascii_flag || !locale_is_utf8(),
            tier: detect_tier(no_color),
        }
    }

    /// Whether the tier paints a real background (truecolor / 256). Basic and
    /// plain tiers use the terminal's own background.
    pub fn paints_background(&self) -> bool {
        matches!(self.tier, ColorTier::Truecolor | ColorTier::Ansi256)
    }

    /// The escape that sets the charcoal background for a frame, or empty when
    /// the tier does not paint a background.
    pub fn background_prefix(&self) -> String {
        match self.tier {
            ColorTier::Truecolor => bg_rgb(CHARCOAL),
            ColorTier::Ansi256 => format!("\x1b[48;5;{CHARCOAL_256}m"),
            _ => String::new(),
        }
    }

    // --- foreground color helpers (foreground-only reset) ------------------

    fn fg(&self, rgb: Rgb, idx: u8, basic: u8, s: &str) -> String {
        match self.tier {
            ColorTier::Truecolor => format!("\x1b[38;2;{};{};{}m{s}\x1b[39m", rgb.0, rgb.1, rgb.2),
            ColorTier::Ansi256 => format!("\x1b[38;5;{idx}m{s}\x1b[39m"),
            ColorTier::Basic => format!("\x1b[{basic}m{s}\x1b[39m"),
            ColorTier::None => s.to_string(),
        }
    }

    pub fn ok(&self, s: &str) -> String {
        self.fg(SUCCESS, SUCCESS_256, 32, s)
    }
    pub fn fail(&self, s: &str) -> String {
        self.fg(DANGER, DANGER_256, 31, s)
    }
    pub fn accent(&self, s: &str) -> String {
        self.fg(AMBER, AMBER_256, 33, s)
    }
    pub fn warn(&self, s: &str) -> String {
        self.fg(WARNING, WARNING_256, 33, s)
    }
    pub fn dim(&self, s: &str) -> String {
        self.fg(MUTED, MUTED_256, 90, s)
    }
    pub fn heading(&self, s: &str) -> String {
        self.bold(&self.fg(HEADING, HEADING_256, 97, s))
    }
    pub fn bold(&self, s: &str) -> String {
        if self.tier == ColorTier::None {
            s.to_string()
        } else {
            format!("\x1b[1m{s}\x1b[22m")
        }
    }

    /// Color one row of the block wordmark with an amber shade, lighter at the
    /// top and deeper at the bottom (a subtle vertical gradient). The 256 and
    /// basic tiers use the single amber accent; plain is untouched.
    pub fn amber_gradient(&self, row: usize, s: &str) -> String {
        match self.tier {
            ColorTier::Truecolor => {
                let rgb = match row {
                    0 => AMBER_LIGHT,
                    1 => AMBER,
                    _ => AMBER_DEEP,
                };
                self.bold(&format!(
                    "\x1b[38;2;{};{};{}m{s}\x1b[39m",
                    rgb.0, rgb.1, rgb.2
                ))
            }
            _ => self.bold(&self.accent(s)),
        }
    }

    /// A full-width solid amber selection bar with dark text, `width` display
    /// columns wide. In the basic and plain tiers there is no background to
    /// draw, so the row degrades to an accented marker plus a bold label (the
    /// caller pads it to width). `content` is plain text (no embedded escapes).
    pub fn selection_bar(&self, content: &str, width: usize) -> String {
        let body = pad_or_clip(content, width);
        match self.tier {
            ColorTier::Truecolor => format!(
                "{}{}{body}{}",
                bg_rgb(AMBER),
                fg_rgb(ON_AMBER),
                self.restore_base()
            ),
            ColorTier::Ansi256 => format!(
                "\x1b[48;5;{AMBER_256}m\x1b[38;5;{ON_AMBER_256}m{body}{}",
                self.restore_base()
            ),
            // No background tier: keep the label readable without a bar.
            ColorTier::Basic => self.bold(&self.accent(content)),
            ColorTier::None => content.to_string(),
        }
    }

    /// The escape that restores the base background + default foreground after a
    /// span that changed the background (the selection bar). Truecolor and 256
    /// tiers restore charcoal; other tiers only reset the foreground.
    fn restore_base(&self) -> String {
        match self.tier {
            ColorTier::Truecolor => format!("{}\x1b[39m", bg_rgb(CHARCOAL)),
            ColorTier::Ansi256 => format!("\x1b[48;5;{CHARCOAL_256}m\x1b[39m"),
            _ => "\x1b[39m".to_string(),
        }
    }

    // --- glyphs ------------------------------------------------------------

    /// The current spinner frame glyph.
    pub fn spinner(&self, frame: usize) -> &'static str {
        if self.ascii {
            SPIN_ASCII[frame % SPIN_ASCII.len()]
        } else {
            SPIN_UNICODE[frame % SPIN_UNICODE.len()]
        }
    }
    pub fn glyph_ok(&self) -> &'static str {
        if self.ascii {
            "+"
        } else {
            "✓"
        }
    }
    pub fn glyph_fail(&self) -> &'static str {
        if self.ascii {
            "x"
        } else {
            "✗"
        }
    }
    pub fn glyph_pending(&self) -> &'static str {
        if self.ascii {
            "."
        } else {
            "•"
        }
    }
    /// A filled radio / progress dot.
    pub fn dot_filled(&self) -> &'static str {
        if self.ascii {
            "#"
        } else {
            "●"
        }
    }
    /// An empty radio / progress dot.
    pub fn dot_empty(&self) -> &'static str {
        if self.ascii {
            "."
        } else {
            "○"
        }
    }
    /// A filled checkbox mark (checklist on).
    pub fn box_checked(&self) -> &'static str {
        if self.ascii {
            "#"
        } else {
            "■"
        }
    }
    /// An empty checkbox mark (checklist off).
    pub fn box_unchecked(&self) -> &'static str {
        if self.ascii {
            "."
        } else {
            "□"
        }
    }

    /// The box-drawing set (rounded Unicode, or ASCII).
    pub fn box_chars(&self) -> BoxChars {
        if self.ascii {
            BoxChars {
                tl: "+",
                tr: "+",
                bl: "+",
                br: "+",
                h: "-",
                v: "|",
            }
        } else {
            BoxChars {
                tl: "╭",
                tr: "╮",
                bl: "╰",
                br: "╯",
                h: "─",
                v: "│",
            }
        }
    }
}

/// A truecolor foreground set.
fn fg_rgb(rgb: Rgb) -> String {
    format!("\x1b[38;2;{};{};{}m", rgb.0, rgb.1, rgb.2)
}

/// A truecolor background set.
fn bg_rgb(rgb: Rgb) -> String {
    format!("\x1b[48;2;{};{};{}m", rgb.0, rgb.1, rgb.2)
}

/// Pad `content` to `width` display columns with spaces, or clip it (with an
/// ellipsis) when it overflows. `content` must be plain text.
fn pad_or_clip(content: &str, width: usize) -> String {
    let n = content.chars().count();
    if n == width {
        content.to_string()
    } else if n < width {
        format!("{content}{}", " ".repeat(width - n))
    } else if width == 0 {
        String::new()
    } else {
        let mut out: String = content.chars().take(width.saturating_sub(1)).collect();
        out.push('…');
        out
    }
}

/// Resolve the color depth from the environment. `NO_COLOR` / `--no-color` and
/// `TERM=dumb` force the plain tier; `COLORTERM=truecolor|24bit` selects
/// truecolor; a `*-256color` `TERM` selects 256; anything else is basic.
fn detect_tier(no_color: bool) -> ColorTier {
    if no_color {
        return ColorTier::None;
    }
    let term = std::env::var("TERM").unwrap_or_default();
    if term == "dumb" {
        return ColorTier::None;
    }
    let colorterm = std::env::var("COLORTERM")
        .unwrap_or_default()
        .to_lowercase();
    if colorterm.contains("truecolor") || colorterm.contains("24bit") {
        return ColorTier::Truecolor;
    }
    if term.contains("256color") {
        return ColorTier::Ansi256;
    }
    ColorTier::Basic
}

/// True when the locale env vars indicate UTF-8 (or are unset — the modern
/// default). A `C`/`POSIX` locale selects the ASCII tier.
fn locale_is_utf8() -> bool {
    // POSIX precedence: LC_ALL wins, then LC_CTYPE, then LANG. The first set,
    // non-empty value decides; nothing set → assume a modern UTF-8 terminal.
    for key in ["LC_ALL", "LC_CTYPE", "LANG"] {
        if let Ok(v) = std::env::var(key) {
            if v.is_empty() {
                continue;
            }
            let v = v.to_ascii_lowercase();
            return v.contains("utf-8") || v.contains("utf8");
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plain() -> Theme {
        Theme {
            ascii: false,
            tier: ColorTier::None,
        }
    }

    #[test]
    fn no_color_tier_emits_plain_text() {
        let t = plain();
        assert_eq!(t.ok("✓"), "✓");
        assert_eq!(t.dim("x"), "x");
        assert_eq!(t.accent("a"), "a");
        assert_eq!(t.bold("b"), "b");
        assert_eq!(t.heading("h"), "h");
        assert_eq!(t.selection_bar("row", 3), "row");
    }

    #[test]
    fn truecolor_amber_accent_uses_rgb_sgr() {
        let t = Theme {
            ascii: false,
            tier: ColorTier::Truecolor,
        };
        let a = t.accent("x");
        assert!(
            a.contains("\x1b[38;2;235;193;87m"),
            "amber rgb missing: {a:?}"
        );
        assert!(a.ends_with("\x1b[39m"), "fg not reset: {a:?}");
        // Never a full reset that would clear the charcoal background.
        assert!(!a.contains("\x1b[0m"), "must not full-reset: {a:?}");
    }

    #[test]
    fn selection_bar_is_full_width_amber_with_dark_text() {
        let t = Theme {
            ascii: false,
            tier: ColorTier::Truecolor,
        };
        let bar = t.selection_bar("● Drone", 20);
        // Amber background + dark foreground, and the visible content padded.
        assert!(
            bar.contains("\x1b[48;2;235;193;87m"),
            "amber bg missing: {bar:?}"
        );
        assert!(
            bar.contains("\x1b[38;2;26;26;26m"),
            "dark fg missing: {bar:?}"
        );
        // Restores the charcoal base so the row after it is not amber.
        assert!(
            bar.contains("\x1b[48;2;31;31;31m"),
            "charcoal restore missing: {bar:?}"
        );
        assert_eq!(super::pad_or_clip("● Drone", 20).chars().count(), 20);
    }

    #[test]
    fn background_prefix_only_on_painting_tiers() {
        let tc = Theme {
            ascii: false,
            tier: ColorTier::Truecolor,
        };
        assert_eq!(tc.background_prefix(), "\x1b[48;2;31;31;31m");
        assert!(tc.paints_background());
        let basic = Theme {
            ascii: false,
            tier: ColorTier::Basic,
        };
        assert!(basic.background_prefix().is_empty());
        assert!(!basic.paints_background());
        assert!(plain().background_prefix().is_empty());
    }

    #[test]
    fn ascii_tier_uses_ascii_glyphs() {
        let t = Theme {
            ascii: true,
            tier: ColorTier::None,
        };
        assert_eq!(t.glyph_ok(), "+");
        assert_eq!(t.glyph_fail(), "x");
        assert_eq!(t.spinner(0), "-");
        assert_eq!(t.box_chars().h, "-");
        assert_eq!(t.dot_filled(), "#");
        assert_eq!(t.box_checked(), "#");
    }

    #[test]
    fn unicode_glyphs_are_single_column() {
        let t = plain();
        for g in [
            t.glyph_ok(),
            t.glyph_fail(),
            t.glyph_pending(),
            t.spinner(2),
            t.dot_filled(),
            t.dot_empty(),
            t.box_checked(),
            t.box_unchecked(),
        ] {
            assert_eq!(g.chars().count(), 1, "glyph {g:?} must be one column");
        }
    }
}
