//! The closing screen: success card + first-run guide, or failure panel.
//!
//! Plain renderers print [`plain_lines`] verbatim. The rich renderer wraps the
//! same information in a styled box (see `rich.rs`), so the *content* is
//! identical whether or not the terminal supports color.

use std::collections::VecDeque;

use crate::ui::events::SummaryData;
use crate::ui::theme::Theme;

/// The curated next-step commands shown after a successful install, each with a
/// short plain-language description. Product-facing copy only — no internal
/// tags. Ordered from "learn everything" to "remove". Kept in sync with the CLI's
/// own `ados help` overview (`src/ados/cli/help.py`); both the Linux summary
/// (plain + rich) and the macOS summary render this one list.
pub const NEXT_STEPS: &[(&str, &str)] = &[
    ("ados help", "see all commands"),
    ("ados", "live status dashboard"),
    ("ados status", "status at a glance"),
    ("ados pair", "connect to Mission Control"),
    ("ados update", "update the agent"),
    ("ados logs", "view agent logs"),
    ("ados uninstall", "remove the agent"),
];

/// The local-mode caveat + docs pointer shown in the Notes section.
const NOTE_LOCAL_MODE: &str = "Running in LOCAL mode. Pair over the LAN, no cloud needed.";
const NOTE_DOCS: &str = "Docs: docs.altnautica.com";
/// Reachability guidance: the LAN IP is the most reliable reach and works from
/// the hosted GCS; the `.local` (mDNS) name resolves only from a desktop app.
const NOTE_DIRECT_IP: &str = "Direct IP is most reliable; it works from the hosted GCS too.";
const NOTE_MDNS: &str = "The .local (mDNS) name needs a desktop app on the LAN.";

/// The reach URLs for the console, most-resolvable first: the `<host>.local`
/// mDNS name, then one `http://<ip>:8080` per discovered LAN address. A bare
/// `localhost` is never emitted — it is useless to an operator on another box.
fn console_urls(s: &SummaryData) -> Vec<String> {
    let mut urls = Vec::new();
    if let Some(host) = mdns_host(&s.hostname) {
        urls.push(format!("http://{host}:8080"));
    }
    for ip in &s.lan_ips {
        urls.push(format!("http://{ip}:8080"));
    }
    urls
}

/// The `<host>.local` mDNS form for the reach block, or `None` when the
/// hostname is unusable (empty, `localhost`, or a raw loopback address). A
/// hostname that already carries a dot is treated as a full DNS name and used
/// verbatim. Mirrors the server-side `_best_lan_host` preference.
fn mdns_host(hostname: &str) -> Option<String> {
    let name = hostname.trim().trim_end_matches('.');
    if name.is_empty() || name == "localhost" || name.starts_with("127.") {
        return None;
    }
    if name.contains('.') {
        Some(name.to_string())
    } else {
        Some(format!("{name}.local"))
    }
}

/// The headline for the summary, e.g. `ADOS Drone Agent 0.51.4 installed`.
pub fn headline(s: &SummaryData) -> String {
    match s.status.as_str() {
        "failed" => "ADOS Drone Agent install failed".to_string(),
        "degraded" => format!("ADOS Drone Agent {} installed with warnings", s.version),
        _ => format!("ADOS Drone Agent {} installed", s.version),
    }
}

/// Plain, escape-free summary lines (machine-grep-friendly). Used by the plain
/// and quiet renderers, and as the fallback content of the rich card.
pub fn plain_lines(s: &SummaryData) -> Vec<String> {
    let mut out = Vec::new();
    out.push(headline(s));

    if s.status == "failed" {
        if !s.required_failures.is_empty() {
            out.push(format!("  failed step: {}", s.required_failures.join(", ")));
        }
        out.push("  full log:    journalctl -t ados-installer".to_string());
        out.push("  retry:       re-run the install one-liner".to_string());
        return out;
    }

    out.push(format!("  profile: {}    board: {}", s.profile, s.board));
    out.push(format!(
        "  device:  {}    {}",
        s.device_id,
        if s.paired { "paired" } else { "not paired" }
    ));
    if s.status == "degraded" && !s.failed_steps.is_empty() {
        out.push(format!("  warnings: {}", s.failed_steps.join(", ")));
    }

    out.push(String::new());
    out.push("Open the console:".to_string());
    for url in console_urls(s) {
        out.push(format!("  {url}"));
    }

    out.push(String::new());
    out.push("Next steps:".to_string());
    let cmd_w = next_step_cmd_width();
    for &(cmd, desc) in NEXT_STEPS {
        out.push(format!("  {cmd:<cmd_w$}   {desc}"));
    }

    out.push(String::new());
    out.push(NOTE_LOCAL_MODE.to_string());
    out.push(NOTE_DIRECT_IP.to_string());
    out.push(NOTE_MDNS.to_string());
    out.push(NOTE_DOCS.to_string());
    out
}

/// The command-column width used to align the next-step descriptions (the
/// longest command name).
fn next_step_cmd_width() -> usize {
    NEXT_STEPS
        .iter()
        .map(|(cmd, _)| cmd.chars().count())
        .max()
        .unwrap_or(0)
}

/// Which border color a frame uses.
enum Border {
    Ok,
    Fail,
}

/// Rich (framed, colored) closing screen for the rich renderer. `logs` is the
/// recent log ring, surfaced in the failure panel. The information matches
/// [`plain_lines`]; only the styling differs.
pub fn rich_lines(s: &SummaryData, theme: &Theme, logs: &VecDeque<String>) -> Vec<String> {
    let width = frame_width();
    if s.status == "failed" {
        failure_panel(s, theme, logs, width)
    } else {
        success_card(s, theme, width)
    }
}

/// The closing card centered full-screen on a `cols × rows` charcoal field,
/// with a dismiss hint below it. The full-screen renderer draws this inside the
/// alternate screen (the plain and rich renderers print [`rich_lines`] /
/// [`plain_lines`] inline instead). Every returned line is exactly `cols`
/// visible columns so the caller's background paint fills the whole screen.
pub fn fullscreen_grid(
    s: &SummaryData,
    theme: &Theme,
    journal: &VecDeque<String>,
    cols: usize,
    rows: usize,
) -> Vec<String> {
    let card = rich_lines(s, theme, journal);
    let hint = theme.dim("Press Enter to finish");

    // The centered block is the card, a blank spacer, and the hint line.
    let card_w = card.iter().map(|l| visible_width(l)).max().unwrap_or(0);
    let block_h = card.len() + 2;
    let top = rows.saturating_sub(block_h) / 2;
    let card_left = cols.saturating_sub(card_w) / 2;
    let hint_left = cols.saturating_sub(visible_width(&hint)) / 2;

    let mut grid = vec![" ".repeat(cols); rows];
    for (i, line) in card.iter().enumerate() {
        place(&mut grid, top + i, card_left, line, cols);
    }
    place(&mut grid, top + card.len() + 1, hint_left, &hint, cols);
    grid
}

/// Write `line` into `grid[row]`, left-padded by `left` and fitted to `cols`
/// visible columns. A row past the grid is a no-op (the card is clipped, not a
/// panic, on a short terminal).
fn place(grid: &mut [String], row: usize, left: usize, line: &str, cols: usize) {
    if let Some(slot) = grid.get_mut(row) {
        *slot = fit_to(&format!("{}{}", " ".repeat(left), line), cols);
    }
}

fn success_card(s: &SummaryData, theme: &Theme, width: usize) -> Vec<String> {
    let installed = if s.status == "degraded" {
        "installed with warnings"
    } else {
        "installed"
    };
    let title = format!("{} ADOS Drone Agent {installed}", theme.glyph_ok());

    let mut body = Vec::new();
    // Dim meta lines: version + profile, then board + device + pairing.
    body.push(theme.dim(&format!("v{} · profile: {}", s.version, s.profile)));
    body.push(theme.dim(&format!(
        "board: {} · device: {} · {}",
        s.board,
        s.device_id,
        if s.paired { "paired" } else { "not paired" }
    )));
    if s.status == "degraded" && !s.failed_steps.is_empty() {
        body.push(theme.warn(&format!("warnings: {}", s.failed_steps.join(", "))));
    }

    // Reach block: mDNS `.local` host first, then one LAN IP per line.
    body.push(String::new());
    body.push(section(theme, "Open the console"));
    for url in console_urls(s) {
        body.push(format!("{}  {}", theme.accent(arrow(theme)), url));
    }

    // Curated primitive commands: command in accent, description dimmed.
    body.push(String::new());
    body.push(section(theme, "Next steps"));
    let cmd_w = next_step_cmd_width();
    for &(cmd, desc) in NEXT_STEPS {
        let padded = format!("{cmd:<cmd_w$}");
        body.push(format!("  {}  {}", theme.accent(&padded), theme.dim(desc)));
    }

    // Notes: local-mode caveat + docs pointer.
    body.push(String::new());
    body.push(section(theme, "Notes"));
    body.push(theme.dim(NOTE_LOCAL_MODE));
    body.push(theme.dim(NOTE_DIRECT_IP));
    body.push(theme.dim(NOTE_MDNS));
    body.push(theme.dim(NOTE_DOCS));

    frame(theme, Border::Ok, &title, &body, width)
}

/// An accent section marker + bold label: `▌ Open the console`. This minimal
/// `▌` word-mark is the only logo in the card — no block ASCII art.
fn section(theme: &Theme, label: &str) -> String {
    format!("{} {}", theme.accent(marker(theme)), theme.bold(label))
}

/// The section marker glyph (`▌`), with an ASCII fallback.
fn marker(theme: &Theme) -> &'static str {
    if theme.ascii {
        "#"
    } else {
        "▌"
    }
}

/// The reach arrow glyph (`➜`), with an ASCII fallback.
fn arrow(theme: &Theme) -> &'static str {
    if theme.ascii {
        "->"
    } else {
        "➜"
    }
}

fn failure_panel(
    s: &SummaryData,
    theme: &Theme,
    logs: &VecDeque<String>,
    width: usize,
) -> Vec<String> {
    let title = format!("{} {}", theme.glyph_fail(), headline(s));
    let mut body = Vec::new();
    if !s.required_failures.is_empty() {
        body.push(format!("failed step: {}", s.required_failures.join(", ")));
    }
    if !logs.is_empty() {
        body.push(String::new());
        body.push("recent log".to_string());
        let tail: Vec<&String> = logs.iter().rev().take(8).collect();
        for l in tail.into_iter().rev() {
            body.push(format!("  {l}"));
        }
    }
    body.push(String::new());
    body.push("full log: journalctl -t ados-installer".to_string());
    body.push("retry:    re-run the install one-liner".to_string());
    frame(theme, Border::Fail, &title, &body, width)
}

/// Wrap plain `body` lines in a colored rounded box with a titled top border.
fn frame(theme: &Theme, border: Border, title: &str, body: &[String], width: usize) -> Vec<String> {
    let bc = theme.box_chars();
    let content_w = width.saturating_sub(2);
    let body_w = content_w.saturating_sub(2);

    let lead = format!("{} {} ", bc.h, truncate(title, content_w.saturating_sub(4)));
    let dashes = content_w.saturating_sub(lead.chars().count() + 1);
    let top = format!("{}{}{}{}", bc.tl, lead, bc.h.repeat(dashes), bc.tr);

    let mut out = Vec::with_capacity(body.len() + 2);
    out.push(paint_border(theme, &border, &top));
    let v = paint_border(theme, &border, bc.v);
    for line in body {
        out.push(format!("{v} {} {v}", fit_to(line, body_w)));
    }
    out.push(paint_border(
        theme,
        &border,
        &format!("{}{}{}", bc.bl, bc.h.repeat(content_w), bc.br),
    ));
    out
}

fn paint_border(theme: &Theme, border: &Border, s: &str) -> String {
    match border {
        Border::Ok => theme.ok(s),
        Border::Fail => theme.fail(s),
    }
}

/// Card width: terminal columns clamped to a tidy range.
fn frame_width() -> usize {
    ratatui::crossterm::terminal::size()
        .map(|(c, _)| c as usize)
        .unwrap_or(80)
        .saturating_sub(2)
        .clamp(40, 64)
}

/// Truncate to `max` columns with an ellipsis when clipped.
fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    if max == 0 {
        return String::new();
    }
    let mut out: String = s.chars().take(max - 1).collect();
    out.push('…');
    out
}

/// Truncate then right-pad to exactly `w` columns (plain text).
fn pad_to(s: &str, w: usize) -> String {
    let t = truncate(s, w);
    let pad = w.saturating_sub(t.chars().count());
    format!("{t}{}", " ".repeat(pad))
}

/// Right-pad `s` to `w` *visible* columns, ignoring embedded ANSI SGR escapes
/// so a colored body line still aligns to the box border. A line whose visible
/// content overflows `w` is stripped of styling and hard-truncated so the right
/// border never drifts.
fn fit_to(s: &str, w: usize) -> String {
    let vis = visible_width(s);
    if vis <= w {
        format!("{s}{}", " ".repeat(w - vis))
    } else {
        pad_to(&strip_ansi(s), w)
    }
}

/// The number of display columns `s` occupies, skipping ANSI SGR escape
/// sequences (`\x1b[...m`, as emitted by the color helpers).
fn visible_width(s: &str) -> usize {
    let mut width = 0;
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            // Consume the CSI parameters up to (and including) the terminator.
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
fn strip_ansi(s: &str) -> String {
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

    fn sample(status: &str) -> SummaryData {
        SummaryData {
            status: status.to_string(),
            version: "0.51.4".to_string(),
            profile: "drone".to_string(),
            board: "Raspberry Pi 4 Model B".to_string(),
            device_id: "17bf646b".to_string(),
            hostname: "skynode".to_string(),
            setup_url: "http://skynode.local:8080/setup".to_string(),
            lan_ips: vec!["192.168.1.42".to_string()],
            paired: true,
            failed_steps: vec![],
            required_failures: vec![],
        }
    }

    #[test]
    fn ok_summary_leads_with_mdns_and_lan_ip_and_new_steps() {
        let lines = plain_lines(&sample("ok"));
        assert!(lines[0].contains("0.51.4 installed"));
        // Reach block carries the `.local` mDNS host AND the LAN IP so the
        // console is reachable even when mDNS does not resolve.
        assert!(lines.iter().any(|l| l.contains("Open the console:")));
        assert!(lines
            .iter()
            .any(|l| l.contains("http://skynode.local:8080")));
        assert!(lines.iter().any(|l| l.contains("http://192.168.1.42:8080")));
        // The `.local` host comes before the LAN IP in the reach block.
        let mdns_at = lines.iter().position(|l| l.contains("skynode.local:8080"));
        let ip_at = lines.iter().position(|l| l.contains("192.168.1.42:8080"));
        assert!(mdns_at < ip_at, "mDNS host must lead the reach block");
        // The curated next-step commands, including `ados help`, `ados update`,
        // and `ados logs`.
        assert!(lines.iter().any(|l| l.contains("ados help")));
        assert!(lines.iter().any(|l| l.contains("ados update")));
        assert!(lines.iter().any(|l| l.contains("ados logs")));
        assert!(lines.iter().any(|l| l.contains("ados uninstall")));
        // No bare localhost reach line, and journalctl is off the success path.
        assert!(!lines.iter().any(|l| l.contains("localhost")));
        assert!(!lines.iter().any(|l| l.contains("journalctl")));
    }

    #[test]
    fn rich_card_reach_block_has_mdns_and_lan_ip_but_never_localhost() {
        let theme = Theme {
            ascii: false,
            tier: crate::ui::theme::ColorTier::None,
        };
        let logs = VecDeque::new();
        let joined = rich_lines(&sample("ok"), &theme, &logs).join("\n");
        assert!(joined.contains("skynode.local:8080"));
        assert!(joined.contains("192.168.1.42:8080"));
        assert!(joined.contains("ados help"));
        assert!(!joined.contains("localhost"));
    }

    #[test]
    fn fullscreen_grid_centers_the_card_full_screen() {
        let theme = Theme {
            ascii: false,
            tier: crate::ui::theme::ColorTier::None,
        };
        let journal = VecDeque::new();
        let grid = fullscreen_grid(&sample("ok"), &theme, &journal, 100, 30);
        // Exactly one full-width line per row so the background fills the screen.
        assert_eq!(grid.len(), 30);
        assert!(grid.iter().all(|l| visible_width(l) == 100));
        // Carries the card content + the dismiss hint.
        let joined = grid.join("\n");
        assert!(joined.contains("ADOS Drone Agent"));
        assert!(joined.contains("skynode.local:8080"));
        assert!(joined.contains("Press Enter to finish"));
    }

    #[test]
    fn mdns_host_skips_unusable_hostnames() {
        assert_eq!(mdns_host("skynode"), Some("skynode.local".to_string()));
        assert_eq!(mdns_host("box.lan"), Some("box.lan".to_string()));
        assert_eq!(mdns_host("localhost"), None);
        assert_eq!(mdns_host("127.0.0.1"), None);
        assert_eq!(mdns_host("  "), None);
    }

    #[test]
    fn console_urls_drops_the_mdns_line_when_only_ips_resolve() {
        let mut s = sample("ok");
        s.hostname = "localhost".to_string();
        let urls = console_urls(&s);
        assert_eq!(urls, vec!["http://192.168.1.42:8080".to_string()]);
    }

    #[test]
    fn visible_width_ignores_ansi_escapes() {
        // A colored string measures by its visible glyphs, not its escape bytes.
        let colored = "\u{1b}[36m➜\u{1b}[39m";
        assert_eq!(visible_width(colored), 1);
        assert_eq!(strip_ansi(colored), "➜");
        assert_eq!(visible_width("plain"), 5);
    }

    #[test]
    fn failed_summary_points_at_the_log_and_failed_step() {
        let mut s = sample("failed");
        s.required_failures = vec!["systemd".to_string()];
        s.failed_steps = vec!["systemd".to_string()];
        let lines = plain_lines(&s);
        assert!(lines[0].contains("failed"));
        assert!(lines.iter().any(|l| l.contains("systemd")));
        assert!(lines
            .iter()
            .any(|l| l.contains("journalctl -t ados-installer")));
    }
}
