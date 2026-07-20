//! Reusable interactive widgets for the onboarding wizard.
//!
//! Each widget builds a body (a `Vec<String>` of pre-styled lines) plus a
//! footer key-hint and hands them to [`crate::ui::tty::Tty::render`], which
//! centers the body in a panel on the full screen with the header, progress
//! rail, and footer around it. The pure movement and edit logic is factored out
//! so it is unit-tested without a terminal; the widget functions themselves are
//! thin build + read loops. A terminal resize returns [`KeyEvent::Resize`],
//! which the loops ignore and so repaint at the new size.

use crate::ui::theme::Theme;
use crate::ui::tty::{Input, KeyEvent, Tty};
use crate::wizard::render::{self, cursor_glyph, dot};

/// The outcome of one widget: a value, a request to go back a step, or an abort
/// (Ctrl-C / terminal closed) that unwinds the whole wizard.
pub enum Flow<T> {
    Value(T),
    Back,
    Abort,
}

/// A single-select option row.
pub struct Choice {
    pub id: String,
    pub label: String,
    pub hint: Option<String>,
}

impl Choice {
    pub fn new(id: &str, label: &str, hint: Option<&str>) -> Choice {
        Choice {
            id: id.to_string(),
            label: label.to_string(),
            hint: hint.map(str::to_string),
        }
    }
}

/// A multi-select checklist row.
#[derive(Clone)]
pub struct CheckItem {
    pub id: String,
    pub label: String,
    pub benefit: String,
    pub checked: bool,
    pub locked: bool,
}

/// A Wi-Fi network row.
#[derive(Clone)]
pub struct WifiRow {
    pub ssid: String,
    pub signal: u8,
    pub secured: bool,
    pub in_use: bool,
}

/// What the operator picked in the Wi-Fi list.
pub enum WifiPick {
    Network { ssid: String, secured: bool },
    Hidden,
    Rescan,
}

/// An acknowledgement screen's action.
pub enum Ack {
    Continue,
    Rescan,
}

/// The per-item state of a live status board row.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ItemState {
    Queued,
    Active,
    Ok,
    Failed,
}

/// One row on the live status board.
pub struct BoardItem {
    pub label: String,
    pub state: ItemState,
    pub detail: Option<String>,
}

/// The result of a spinner-animated background task.
pub enum Spin<T> {
    Done(T),
    Aborted,
}

// ── pure movement + edit logic (unit-tested) ─────────────────────────────

/// Move a cursor up one row (saturating at the top).
pub fn nav_up(pos: usize) -> usize {
    pos.saturating_sub(1)
}

/// Move a cursor down one row (clamped to the last index).
pub fn nav_down(pos: usize, len: usize) -> usize {
    if len == 0 {
        0
    } else {
        (pos + 1).min(len - 1)
    }
}

/// Toggle a checklist item unless it is locked. Returns whether it changed.
pub fn toggle_check(items: &mut [CheckItem], idx: usize) -> bool {
    match items.get_mut(idx) {
        Some(item) if !item.locked => {
            item.checked = !item.checked;
            true
        }
        _ => false,
    }
}

/// Delete the last char of the edit buffer.
pub fn backspace(raw: &mut String) {
    raw.pop();
}

/// Insert-rule for a device name: lowercase `[a-z0-9]` pass through; any other
/// character collapses to a single `-`, never leading and never doubled. This
/// makes an invalid hostname impossible to type, so the raw field and the live
/// `<name>.local` preview can never disagree.
pub fn insert_hostname_char(raw: &mut String, ch: char) {
    let c = ch.to_ascii_lowercase();
    if c.is_ascii_lowercase() || c.is_ascii_digit() {
        raw.push(c);
    } else if !raw.is_empty() && !raw.ends_with('-') {
        raw.push('-');
    }
}

/// Insert-rule for a pairing code: uppercase `[A-Z0-9-]` only; everything else
/// is dropped so the code stays in its canonical shape as it is typed.
pub fn insert_pair_char(raw: &mut String, ch: char) {
    let c = ch.to_ascii_uppercase();
    if c.is_ascii_uppercase() || c.is_ascii_digit() || c == '-' {
        raw.push(c);
    }
}

/// Insert-rule for a Wi-Fi network name: any visible character passes through
/// (an SSID may contain almost anything); control characters are dropped.
pub fn insert_ssid_char(raw: &mut String, ch: char) {
    if !ch.is_control() {
        raw.push(ch);
    }
}

/// Insert-rule for a 2-letter region code: uppercase letters only, capped at
/// two, so the field can only ever hold a well-formed ISO country code.
pub fn insert_region_char(raw: &mut String, ch: char) {
    if raw.chars().count() >= 2 {
        return;
    }
    if ch.is_ascii_alphabetic() {
        raw.push(ch.to_ascii_uppercase());
    }
}

// ── interactive widgets ──────────────────────────────────────────────────

/// A dim, ASCII-safe key hint joined by dot separators (the footer bar text).
fn hint(theme: &Theme, parts: &[&str]) -> String {
    parts.join(&format!(" {} ", dot(theme)))
}

fn arrows_move(theme: &Theme) -> String {
    if theme.ascii {
        "Up/Down move".to_string()
    } else {
        "↑ ↓ move".to_string()
    }
}

fn left_right(theme: &Theme) -> String {
    if theme.ascii {
        "Left/Right choose".to_string()
    } else {
        "← → choose".to_string()
    }
}

/// One selectable choice row. The selected row is a full-width solid-amber bar
/// with dark text and a filled dot; an unselected row is default text with an
/// empty dot. `inner` is the panel's inner text width.
fn choice_row(theme: &Theme, label: &str, selected: bool, inner: usize) -> String {
    if selected {
        theme.selection_bar(&format!(" {} {label}", theme.dot_filled()), inner)
    } else {
        format!(" {} {label}", theme.dim(theme.dot_empty()))
    }
}

/// Two-choice confirm with a pre-highlighted default. Left/Right/Tab move,
/// Enter accepts. Returns `true` for the first (yes) option.
#[allow(clippy::too_many_arguments)]
pub fn confirm_card(
    tty: &mut Tty,
    theme: &Theme,
    section: &str,
    question: &str,
    detail: &[String],
    yes_label: &str,
    no_label: &str,
    default_yes: bool,
) -> Flow<bool> {
    let mut yes = default_yes;
    loop {
        let mut body = Vec::new();
        for d in detail {
            body.push(theme.dim(d));
        }
        if !detail.is_empty() {
            body.push(String::new());
        }
        body.push(theme.heading(question));
        body.push(String::new());
        body.push(options_row(theme, yes_label, no_label, yes));
        tty.render(
            theme,
            section,
            &body,
            &hint(theme, &[&left_right(theme), "Enter to confirm"]),
        );
        match tty.read_key() {
            Ok(KeyEvent::Left) | Ok(KeyEvent::Right) | Ok(KeyEvent::Tab) => yes = !yes,
            Ok(KeyEvent::Enter) => return Flow::Value(yes),
            Ok(KeyEvent::Esc) => return Flow::Back,
            Ok(KeyEvent::CtrlC) => return Flow::Abort,
            _ => {}
        }
    }
}

/// Render the two side-by-side confirm options with the selected one accented.
fn options_row(theme: &Theme, yes_label: &str, no_label: &str, yes: bool) -> String {
    let (y, n) = if yes {
        (
            format!(
                "{} {}",
                theme.accent(cursor_glyph(theme)),
                theme.bold(yes_label)
            ),
            format!("  {}", theme.dim(no_label)),
        )
    } else {
        (
            format!("  {}", theme.dim(yes_label)),
            format!(
                "{} {}",
                theme.accent(cursor_glyph(theme)),
                theme.bold(no_label)
            ),
        )
    };
    format!("  {y}      {n}")
}

/// One-of-N list. Up/Down move, Enter selects, Esc goes back.
pub fn select_list(
    tty: &mut Tty,
    theme: &Theme,
    section: &str,
    prompt: &str,
    choices: &[Choice],
    default_idx: usize,
) -> Flow<usize> {
    let mut cursor = default_idx.min(choices.len().saturating_sub(1));
    loop {
        let inner = tty.body_width();
        let mut body = vec![theme.heading(prompt), String::new()];
        for (i, c) in choices.iter().enumerate() {
            let sel = i == cursor;
            body.push(choice_row(theme, &c.label, sel, inner));
            if let Some(h) = &c.hint {
                body.push(format!("     {}", theme.dim(h)));
            }
        }
        tty.render(
            theme,
            section,
            &body,
            &hint(theme, &[&arrows_move(theme), "Enter to choose"]),
        );
        match tty.read_key() {
            Ok(KeyEvent::Up) => cursor = nav_up(cursor),
            Ok(KeyEvent::Down) => cursor = nav_down(cursor, choices.len()),
            Ok(KeyEvent::Enter) => return Flow::Value(cursor),
            Ok(KeyEvent::Esc) => return Flow::Back,
            Ok(KeyEvent::CtrlC) => return Flow::Abort,
            _ => {}
        }
    }
}

/// One-of-N with a leading read-only summary block: a heading, the summary
/// lines (each already styled), then the selectable choices. Used by the review
/// screen so the operator sees every answer above the finish/change actions.
pub fn summary_select(
    tty: &mut Tty,
    theme: &Theme,
    section: &str,
    header: &str,
    summary: &[String],
    choices: &[Choice],
    default_idx: usize,
) -> Flow<usize> {
    let mut cursor = default_idx.min(choices.len().saturating_sub(1));
    loop {
        let inner = tty.body_width();
        let mut body = vec![theme.heading(header), String::new()];
        body.extend(summary.iter().cloned());
        body.push(String::new());
        for (i, c) in choices.iter().enumerate() {
            let sel = i == cursor;
            body.push(choice_row(theme, &c.label, sel, inner));
            if let Some(h) = &c.hint {
                body.push(format!("     {}", theme.dim(h)));
            }
        }
        tty.render(
            theme,
            section,
            &body,
            &hint(theme, &[&arrows_move(theme), "Enter to choose"]),
        );
        match tty.read_key() {
            Ok(KeyEvent::Up) => cursor = nav_up(cursor),
            Ok(KeyEvent::Down) => cursor = nav_down(cursor, choices.len()),
            Ok(KeyEvent::Enter) => return Flow::Value(cursor),
            Ok(KeyEvent::Esc) => return Flow::Back,
            Ok(KeyEvent::CtrlC) => return Flow::Abort,
            _ => {}
        }
    }
}

/// Multi-of-N. Up/Down move, Space toggles, Enter confirms. Recommended rows
/// arrive checked so an Enter-through installs them. A checked box is a filled
/// amber square; the cursor row is accented.
pub fn checklist(
    tty: &mut Tty,
    theme: &Theme,
    section: &str,
    prompt: &str,
    mut items: Vec<CheckItem>,
) -> Flow<Vec<CheckItem>> {
    let mut cursor = 0usize;
    loop {
        let mut body = vec![theme.heading(prompt), String::new()];
        for (i, item) in items.iter().enumerate() {
            let sel = i == cursor;
            let checkbox = if item.locked {
                // A locked capability is not a choice: show a fixed filled dot,
                // never a checkbox, so it does not read as a toggleable option.
                theme.accent(theme.dot_filled())
            } else if item.checked {
                theme.accent(theme.box_checked())
            } else {
                theme.dim(theme.box_unchecked())
            };
            let mut label = if item.checked {
                theme.heading(&item.label)
            } else if sel {
                theme.bold(&item.label)
            } else {
                item.label.clone()
            };
            if item.locked {
                label = format!("{label} {}", theme.dim("· needed for this profile"));
            }
            body.push(format!(" {} {checkbox} {label}", gutter(theme, sel)));
            body.push(format!("       {}", theme.dim(&item.benefit)));
        }
        tty.render(
            theme,
            section,
            &body,
            &hint(
                theme,
                &[&arrows_move(theme), "Space toggle", "Enter continue"],
            ),
        );
        match tty.read_key() {
            Ok(KeyEvent::Up) => cursor = nav_up(cursor),
            Ok(KeyEvent::Down) => cursor = nav_down(cursor, items.len()),
            Ok(KeyEvent::Space) => {
                toggle_check(&mut items, cursor);
            }
            Ok(KeyEvent::Enter) => return Flow::Value(items),
            Ok(KeyEvent::Esc) => return Flow::Back,
            Ok(KeyEvent::CtrlC) => return Flow::Abort,
            _ => {}
        }
    }
}

/// Gutter for the cursor row (accent arrow) or a plain row (two spaces).
fn gutter(theme: &Theme, selected: bool) -> String {
    if selected {
        theme.accent(cursor_glyph(theme))
    } else {
        " ".to_string()
    }
}

/// Live-sanitized single-line input. `sanitize` filters every keystroke so an
/// invalid value cannot be typed; `derive` renders a live preview line (e.g.
/// `<name>.local`); `validate` gates Enter (returns `Some(reason)` to refuse).
#[allow(clippy::too_many_arguments)]
pub fn text_input<S, D, V>(
    tty: &mut Tty,
    theme: &Theme,
    section: &str,
    prompt: &str,
    initial: &str,
    preview_label: &str,
    sanitize: S,
    derive: D,
    validate: V,
) -> Flow<String>
where
    S: Fn(&mut String, char),
    D: Fn(&str) -> Option<String>,
    V: Fn(&str) -> Option<String>,
{
    let mut raw = initial.to_string();
    let mut error: Option<String> = None;
    loop {
        let cursor_bar = if theme.ascii { "_" } else { "▏" };
        let mut body = vec![
            theme.heading(prompt),
            String::new(),
            format!(
                " {} {}{}",
                theme.accent(cursor_glyph(theme)),
                theme.bold(&raw),
                theme.accent(cursor_bar)
            ),
            String::new(),
        ];
        if let Some(derived) = derive(&raw) {
            body.push(format!(
                "   {}  {}",
                theme.dim(preview_label),
                theme.accent(&derived)
            ));
        }
        if let Some(e) = &error {
            body.push(theme.warn(e));
        }
        tty.render(
            theme,
            section,
            &body,
            &hint(theme, &["type a value", "Enter to confirm"]),
        );
        match tty.read_key() {
            Ok(KeyEvent::Char(c)) => {
                sanitize(&mut raw, c);
                error = None;
            }
            Ok(KeyEvent::Space) => {
                sanitize(&mut raw, ' ');
                error = None;
            }
            Ok(KeyEvent::Backspace) => {
                backspace(&mut raw);
                error = None;
            }
            Ok(KeyEvent::Enter) => match validate(&raw) {
                None => return Flow::Value(raw),
                Some(reason) => error = Some(reason),
            },
            Ok(KeyEvent::Esc) => return Flow::Back,
            Ok(KeyEvent::CtrlC) => return Flow::Abort,
            _ => {}
        }
    }
}

/// Masked passphrase input. Tab toggles reveal, Enter confirms once `min_len` is
/// met. Spaces are literal (passphrases may contain them).
pub fn password_input(
    tty: &mut Tty,
    theme: &Theme,
    section: &str,
    prompt: &str,
    min_len: usize,
) -> Flow<String> {
    let mut raw = String::new();
    let mut reveal = false;
    loop {
        let shown = if reveal {
            raw.clone()
        } else {
            let mask = if theme.ascii { "*" } else { "•" };
            mask.repeat(raw.chars().count())
        };
        let cursor_bar = if theme.ascii { "_" } else { "▏" };
        let toggle = if reveal {
            "(Tab to hide)"
        } else {
            "(Tab to show)"
        };
        let body = vec![
            theme.heading(prompt),
            String::new(),
            format!(
                " {} {}{}   {}",
                theme.accent(cursor_glyph(theme)),
                theme.bold(&shown),
                theme.accent(cursor_bar),
                theme.dim(toggle)
            ),
        ];
        tty.render(
            theme,
            section,
            &body,
            &hint(theme, &["type the password", "Enter to connect"]),
        );
        match tty.read_key() {
            Ok(KeyEvent::Char(c)) => raw.push(c),
            Ok(KeyEvent::Space) => raw.push(' '),
            Ok(KeyEvent::Backspace) => {
                raw.pop();
            }
            Ok(KeyEvent::Tab) => reveal = !reveal,
            Ok(KeyEvent::Enter) => {
                if raw.chars().count() >= min_len {
                    return Flow::Value(raw);
                }
            }
            Ok(KeyEvent::Esc) => return Flow::Back,
            Ok(KeyEvent::CtrlC) => return Flow::Abort,
            _ => {}
        }
    }
}

/// Scanned Wi-Fi networks, strongest first, plus a "hidden network" row. Up/Down
/// move, Enter picks, `r` rescans.
pub fn wifi_picker(tty: &mut Tty, theme: &Theme, rows: &[WifiRow]) -> Flow<WifiPick> {
    // The list is the networks plus a trailing "hidden network" entry.
    let total = rows.len() + 1;
    let mut cursor = 0usize;
    loop {
        let mut body = vec![theme.heading("Choose a Wi-Fi network"), String::new()];
        for (i, row) in rows.iter().enumerate() {
            let sel = i == cursor;
            // Pad the name to a fixed column so the signal bars and the
            // security / current markers line up down the list. All markers are
            // plain, single-column text so the box-width math stays exact (a
            // wide emoji would push the right border out of alignment).
            let name_plain = render::truncate(&row.ssid, 20);
            let name_padded = format!("{name_plain:<20}");
            let name = if sel {
                theme.bold(&name_padded)
            } else {
                name_padded
            };
            let bars = theme.accent(&signal_bars(row.signal, theme.ascii));
            let sec = theme.dim(&format!(
                "{:<6}",
                if row.secured { "locked" } else { "open" }
            ));
            let cur = if row.in_use {
                theme.accent("current")
            } else {
                "       ".to_string()
            };
            body.push(format!(
                " {} {name}  {bars}  {sec} {cur}",
                gutter(theme, sel)
            ));
        }
        let hidden_sel = cursor == rows.len();
        let hidden_label = "Enter a hidden network…";
        let hidden = if hidden_sel {
            theme.bold(hidden_label)
        } else {
            theme.dim(hidden_label)
        };
        body.push(format!(" {} {hidden}", gutter(theme, hidden_sel)));
        tty.render(
            theme,
            "Wi-Fi",
            &body,
            &hint(theme, &[&arrows_move(theme), "Enter select", "r rescan"]),
        );
        match tty.read_key() {
            Ok(KeyEvent::Up) => cursor = nav_up(cursor),
            Ok(KeyEvent::Down) => cursor = nav_down(cursor, total),
            Ok(KeyEvent::Char('r')) | Ok(KeyEvent::Char('R')) => {
                return Flow::Value(WifiPick::Rescan)
            }
            Ok(KeyEvent::Enter) => {
                if cursor < rows.len() {
                    let row = &rows[cursor];
                    return Flow::Value(WifiPick::Network {
                        ssid: row.ssid.clone(),
                        secured: row.secured,
                    });
                }
                return Flow::Value(WifiPick::Hidden);
            }
            Ok(KeyEvent::Esc) => return Flow::Back,
            Ok(KeyEvent::CtrlC) => return Flow::Abort,
            _ => {}
        }
    }
}

/// A 4-cell signal bar for a 0..100 signal, filled by quartile.
pub fn signal_bars(signal: u8, ascii: bool) -> String {
    let filled = (usize::from(signal) * 4 / 100).clamp(1, 4);
    let (full, empty) = if ascii { ('#', '.') } else { ('▇', '▁') };
    let mut s = String::new();
    for i in 0..4 {
        s.push(if i < filled { full } else { empty });
    }
    s
}

/// An informational acknowledgement card (green ticks, optional rescan). Enter
/// continues, `r` rescans, Esc goes back.
pub fn ack_card(
    tty: &mut Tty,
    theme: &Theme,
    section: &str,
    prompt: &str,
    body_lines: &[String],
    allow_rescan: bool,
) -> Flow<Ack> {
    let hint_parts: Vec<&str> = if allow_rescan {
        vec!["Enter continue", "r rescan"]
    } else {
        vec!["Enter continue"]
    };
    loop {
        let mut body = vec![theme.heading(prompt), String::new()];
        body.extend(body_lines.iter().cloned());
        tty.render(theme, section, &body, &hint(theme, &hint_parts));
        match tty.read_key() {
            Ok(KeyEvent::Enter) => return Flow::Value(Ack::Continue),
            Ok(KeyEvent::Char('r')) | Ok(KeyEvent::Char('R')) if allow_rescan => {
                return Flow::Value(Ack::Rescan)
            }
            Ok(KeyEvent::Esc) => return Flow::Back,
            Ok(KeyEvent::CtrlC) => return Flow::Abort,
            _ => {}
        }
    }
}

/// A single-key welcome splash (no progress rail). Any key or Enter proceeds;
/// Ctrl-C aborts.
pub fn welcome(tty: &mut Tty, theme: &Theme, body_lines: &[String]) -> Flow<()> {
    loop {
        tty.render(
            theme,
            "welcome",
            body_lines,
            &hint(theme, &["Enter to begin", "Ctrl-C to cancel"]),
        );
        match tty.read_key() {
            Ok(KeyEvent::CtrlC) => return Flow::Abort,
            Ok(KeyEvent::Resize) | Ok(KeyEvent::Unknown) => {}
            Ok(_) => return Flow::Value(()),
            Err(_) => return Flow::Abort,
        }
    }
}

/// Build the live status board body for the current item states (`spin` selects
/// the spinner frame on the active row).
pub fn board_body(theme: &Theme, items: &[BoardItem], spin: usize) -> Vec<String> {
    let mut body = Vec::new();
    for item in items {
        let (glyph, label) = match item.state {
            ItemState::Ok => (theme.ok(theme.glyph_ok()), item.label.clone()),
            ItemState::Failed => (theme.fail(theme.glyph_fail()), theme.fail(&item.label)),
            ItemState::Active => (theme.accent(theme.spinner(spin)), theme.bold(&item.label)),
            ItemState::Queued => (theme.dim(theme.glyph_pending()), theme.dim(&item.label)),
        };
        let detail = item
            .detail
            .as_ref()
            .map(|d| format!("  {}", theme.dim(d)))
            .unwrap_or_default();
        body.push(format!(" {glyph} {label}{detail}"));
    }
    body
}

/// Paint one frame of a live status board on the tty.
pub fn paint_board(tty: &mut Tty, theme: &Theme, section: &str, items: &[BoardItem], spin: usize) {
    let body = board_body(theme, items, spin);
    tty.render(theme, section, &body, "");
}

/// Run `worker` on a background thread while animating the board's active row,
/// returning the worker's result. Ctrl-C aborts (after the worker finishes). A
/// resize repaints. This is what makes the braille spinner actually animate
/// while a blocking probe (a Wi-Fi scan, a network join) runs.
pub fn run_with_spinner<T, F>(
    tty: &mut Tty,
    theme: &Theme,
    section: &str,
    items: &[BoardItem],
    worker: F,
) -> Spin<T>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    let handle = std::thread::spawn(worker);
    let mut spin = 0usize;
    loop {
        paint_board(tty, theme, section, items, spin);
        if handle.is_finished() {
            return match handle.join() {
                Ok(v) => Spin::Done(v),
                Err(_) => Spin::Aborted,
            };
        }
        match tty.read_input(90) {
            Input::Key(KeyEvent::CtrlC) => {
                let _ = handle.join();
                return Spin::Aborted;
            }
            Input::Key(KeyEvent::Resize) => {}
            Input::Tick | Input::Key(_) => spin = spin.wrapping_add(1),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ui::theme::ColorTier;

    #[test]
    fn cursor_nav_clamps_at_both_ends() {
        assert_eq!(nav_up(0), 0);
        assert_eq!(nav_up(3), 2);
        assert_eq!(nav_down(0, 3), 1);
        assert_eq!(nav_down(2, 3), 2); // clamps at last index
        assert_eq!(nav_down(0, 0), 0); // empty list
    }

    fn items() -> Vec<CheckItem> {
        vec![
            CheckItem {
                id: "radio".into(),
                label: "Radio".into(),
                benefit: "far".into(),
                checked: true,
                locked: false,
            },
            CheckItem {
                id: "cam".into(),
                label: "Camera".into(),
                benefit: "see".into(),
                checked: false,
                locked: true,
            },
        ]
    }

    #[test]
    fn toggle_flips_unlocked_and_refuses_locked() {
        let mut it = items();
        assert!(toggle_check(&mut it, 0));
        assert!(!it[0].checked);
        // A locked row cannot be toggled.
        assert!(!toggle_check(&mut it, 1));
        assert!(!it[1].checked);
        // Out of range is a no-op.
        assert!(!toggle_check(&mut it, 9));
    }

    #[test]
    fn hostname_sanitizer_makes_invalid_impossible() {
        let mut raw = String::new();
        for c in "My Drone 01".chars() {
            insert_hostname_char(&mut raw, c);
        }
        // Uppercase lowercases; spaces collapse to single dashes; no leading dash.
        assert_eq!(raw, "my-drone-01");
        // A leading disallowed char never produces a leading dash.
        let mut lead = String::new();
        insert_hostname_char(&mut lead, ' ');
        insert_hostname_char(&mut lead, '@');
        assert_eq!(lead, "");
        // Consecutive disallowed chars never double the dash.
        let mut runs = String::new();
        for c in "a  b".chars() {
            insert_hostname_char(&mut runs, c);
        }
        assert_eq!(runs, "a-b");
        // A trailing separator leaves a single transient dash (never doubled);
        // the downstream slugify trims it before the hostname is set.
        let mut trail = String::new();
        for c in "node ".chars() {
            insert_hostname_char(&mut trail, c);
        }
        assert_eq!(trail, "node-");
        assert_eq!(render::slugify_hostname(&trail), "node");
    }

    #[test]
    fn pair_sanitizer_uppercases_and_drops_junk() {
        let mut raw = String::new();
        for c in "ab9-x z!".chars() {
            insert_pair_char(&mut raw, c);
        }
        // Uppercased, keeps digits + dash, drops the space and the bang.
        assert_eq!(raw, "AB9-XZ");
    }

    #[test]
    fn backspace_trims_the_tail() {
        let mut raw = "abc".to_string();
        backspace(&mut raw);
        assert_eq!(raw, "ab");
        backspace(&mut raw);
        backspace(&mut raw);
        backspace(&mut raw); // over-delete is safe
        assert_eq!(raw, "");
    }

    #[test]
    fn signal_bars_fill_by_quartile_and_never_empty() {
        assert_eq!(signal_bars(0, true), "#...");
        assert_eq!(signal_bars(100, true), "####");
        assert_eq!(signal_bars(50, true), "##..");
        // Unicode tier renders exactly four cells.
        assert_eq!(signal_bars(75, false).chars().count(), 4);
    }

    #[test]
    fn board_body_renders_each_state() {
        let theme = Theme {
            ascii: true,
            tier: ColorTier::None,
        };
        let items = vec![
            BoardItem {
                label: "Connected".into(),
                state: ItemState::Ok,
                detail: None,
            },
            BoardItem {
                label: "Checking".into(),
                state: ItemState::Active,
                detail: Some("gateway".into()),
            },
            BoardItem {
                label: "Failed".into(),
                state: ItemState::Failed,
                detail: None,
            },
            BoardItem {
                label: "Saving".into(),
                state: ItemState::Queued,
                detail: None,
            },
        ];
        let body = board_body(&theme, &items, 0);
        assert_eq!(body.len(), items.len());
        let joined = body.join("\n");
        assert!(joined.contains("Connected"));
        assert!(joined.contains("gateway"));
    }

    #[test]
    fn choice_row_selected_is_a_full_width_amber_bar() {
        let theme = Theme {
            ascii: false,
            tier: ColorTier::Truecolor,
        };
        let bar = choice_row(&theme, "This flies (Drone)", true, 40);
        assert!(
            bar.contains("\x1b[48;2;235;193;87m"),
            "selected row not an amber bar"
        );
        assert!(bar.contains('●'), "selected row missing the filled dot");
        let plain_row = choice_row(&theme, "This flies (Drone)", false, 40);
        assert!(
            !plain_row.contains("\x1b[48;2;235;193;87m"),
            "unselected row barred"
        );
        assert!(
            plain_row.contains('○'),
            "unselected row missing the empty dot"
        );
    }

    #[test]
    fn render_helpers_are_reachable() {
        // Touch the re-export so the module link is exercised.
        assert_eq!(render::truncate("abcdef", 4), "abc…");
    }
}
