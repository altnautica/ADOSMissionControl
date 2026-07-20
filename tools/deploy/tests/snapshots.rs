//! Frame width-invariant snapshots for the deployer's screens.
//!
//! Every composed frame line must be exactly `cols` display columns wide across
//! terminal sizes, color tiers, and the ASCII glyph tier, so the charcoal
//! background paints edge to edge with no ragged rows. This is the same
//! invariant the vendored `wizard::frame` tests enforce, exercised here through
//! the public compositor with representative deployer content (menu + a wizard
//! review body). Phase 2 extends this with the pure per-stage bodies.

use ados_deploy::ui::theme::{ColorTier, Theme};
use ados_deploy::wizard::frame::{self, Chrome, Screen, TermSize};
use ados_deploy::wizard::render;

fn sizes() -> Vec<TermSize> {
    vec![
        TermSize {
            cols: 120,
            rows: 30,
        },
        TermSize {
            cols: 100,
            rows: 30,
        },
        TermSize { cols: 90, rows: 24 },
        TermSize { cols: 80, rows: 20 },
        TermSize { cols: 72, rows: 20 },
    ]
}

fn tiers() -> Vec<(ColorTier, bool)> {
    vec![
        (ColorTier::None, false),
        (ColorTier::Truecolor, false),
        (ColorTier::Basic, false),
        (ColorTier::None, true), // ASCII glyph tier
    ]
}

/// A representative menu body: a heading + selectable rows with hints, styled the
/// way the menu builds them.
fn menu_body(theme: &Theme) -> Vec<String> {
    let mut body = vec![theme.heading("What would you like to do?"), String::new()];
    for (label, hint) in [
        (
            "Deploy the stack",
            "self-host Convex + Mission Control + MQTT + video",
        ),
        ("Run web GCS", "start Mission Control in dev on :4000"),
        ("Quit", ""),
    ] {
        body.push(format!(" {} {}", theme.accent("❯"), theme.bold(label)));
        if !hint.is_empty() {
            body.push(format!("     {}", theme.dim(hint)));
        }
    }
    body
}

#[test]
fn menu_frame_lines_are_exactly_cols_wide() {
    for (tier, ascii) in tiers() {
        let theme = Theme { ascii, tier };
        for size in sizes() {
            let chrome = Chrome::default();
            let body = menu_body(&theme);
            let screen = Screen {
                section: "Altnautica ADOS",
                body: &body,
                footer: "↑ ↓ move · Enter to choose",
            };
            let grid = frame::compose(&theme, &chrome, &screen, size);
            for (i, line) in grid.iter().enumerate() {
                let w = render::visible_width(line);
                assert_eq!(
                    w, size.cols,
                    "row {i} width {w} != cols {} (tier {tier:?}, ascii {ascii}, size {}x{})",
                    size.cols, size.cols, size.rows
                );
            }
        }
    }
}

#[test]
fn slugify_hostname_trims_and_normalizes() {
    assert_eq!(render::slugify_hostname("My Drone 01"), "my-drone-01");
    assert_eq!(render::slugify_hostname("node-"), "node");
    assert_eq!(render::slugify_hostname("  @@a__b  "), "a-b");
}
