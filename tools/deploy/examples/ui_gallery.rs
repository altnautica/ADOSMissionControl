//! Render the deployer's canonical screens to committed SVG + HTML assets, plus
//! an animated demo, for the docs / website / deployment guide.
//!
//! Every frame comes from the REAL `frame::compose` / `fullscreen::sample_grid`
//! output at the Truecolor tier, so the asset is pixel-faithful to the live UI.
//! All placeholders are generic (mycompany-fleet, 192.168.1.50, fleet.example.com)
//! — never real infrastructure.
//!
//! Run:  cargo run --example ui_gallery   (writes tools/deploy/assets/gallery/)

use ados_deploy::graph::StepOutcome;
use ados_deploy::ui::events::{ProgressEvent, DEPLOY_FOOTER, DEPLOY_GROUPS};
use ados_deploy::ui::export;
use ados_deploy::ui::fullscreen;
use ados_deploy::ui::theme::{ColorTier, Theme};
use ados_deploy::wizard::frame::{self, Chrome, Screen, TermSize};
use ados_deploy::wizard::render;

fn theme() -> Theme {
    Theme {
        ascii: false,
        tier: ColorTier::Truecolor,
    }
}

fn size() -> TermSize {
    TermSize { cols: 96, rows: 30 }
}

fn main() {
    let out = "assets/gallery";
    std::fs::create_dir_all(out).expect("create gallery dir");
    let th = theme();

    write_frame(out, "menu", &menu_grid(&th, size()));
    write_frame(out, "wizard-services", &services_grid(&th, size()));
    write_frame(out, "wizard-review", &review_grid(&th, size()));
    write_frame(out, "success", &success_grid(&th, size()));

    let dsize = TermSize { cols: 96, rows: 26 };
    write_frame(out, "deploy", &deploy_grid(&th, dsize, 6));

    // Animated demo: a sequence of split-view frames as the deploy progresses.
    let frames: Vec<Vec<String>> = (0..deploy_stops().len())
        .map(|n| deploy_grid(&th, dsize, n))
        .collect();
    std::fs::write(
        format!("{out}/demo.html"),
        export::to_player(&frames, "Deploy the ADOS stack", 950),
    )
    .expect("write demo");

    println!("wrote gallery ({} frames + demo) to {out}/", 5);
}

/// Write a frame as `<name>.svg` + `<name>.html`.
fn write_frame(dir: &str, name: &str, grid: &[String]) {
    std::fs::write(format!("{dir}/{name}.svg"), export::to_svg(grid)).expect("write svg");
    std::fs::write(
        format!("{dir}/{name}.html"),
        export::to_document(grid, &format!("ADOS deploy — {name}")),
    )
    .expect("write html");
}

fn inner(cols: usize) -> usize {
    render::panel_body_width(frame::panel_width(cols))
}

/// A one-of-N list body mirroring `select_list` (selected row = amber bar).
fn list_body(
    th: &Theme,
    prompt: &str,
    rows: &[(&str, &str)],
    selected: usize,
    w: usize,
) -> Vec<String> {
    let mut body = vec![th.heading(prompt), String::new()];
    for (i, (label, hint)) in rows.iter().enumerate() {
        if i == selected {
            body.push(th.selection_bar(&format!("{} {}", th.dot_filled(), label), w));
        } else {
            body.push(format!("  {} {}", th.dim(th.dot_empty()), label));
        }
        if !hint.is_empty() {
            body.push(format!("     {}", th.dim(hint)));
        }
    }
    body
}

fn compose(
    th: &Theme,
    chrome: &Chrome,
    section: &str,
    body: &[String],
    footer: &str,
    sz: TermSize,
) -> Vec<String> {
    let screen = Screen {
        section,
        body,
        footer,
    };
    frame::compose(th, chrome, &screen, sz)
}

fn menu_grid(th: &Theme, sz: TermSize) -> Vec<String> {
    let rows = [
        (
            "Deploy the stack",
            "self-host Convex + Mission Control + MQTT + video",
        ),
        (
            "Manage running stack",
            "status, logs, restart, upgrade, teardown",
        ),
        ("Run web GCS", "start Mission Control in dev on :4000"),
        ("Run demo mode", "Mission Control with a simulated fleet"),
        (
            "Build desktop app",
            "package the Electron app for macOS / Windows / Linux",
        ),
        ("Run dev desktop app", "the Electron app in dev mode"),
        ("System check", "Docker, Node, and toolchain prerequisites"),
        ("Quit", ""),
    ];
    let body = list_body(th, "What would you like to do?", &rows, 0, inner(sz.cols));
    compose(
        th,
        &Chrome::default(),
        "Altnautica ADOS",
        &body,
        "↑ ↓ move · Enter to choose",
        sz,
    )
}

fn services_grid(th: &Theme, sz: TermSize) -> Vec<String> {
    let items = [
        (
            "Convex backend",
            "auth, fleet, missions, cloud relay",
            true,
            false,
        ),
        (
            "Mission Control (web GCS)",
            "the ground control station in the browser",
            true,
            true,
        ),
        (
            "MQTT relay",
            "live telemetry to the browser over the cloud",
            true,
            false,
        ),
        ("Video relay", "drone video in the browser", true, false),
    ];
    let mut body = vec![
        th.heading("Which services should run locally? (uncheck to use your own)"),
        String::new(),
    ];
    for (i, (label, benefit, checked, locked)) in items.iter().enumerate() {
        let cursor = if i == 0 {
            th.accent("❯")
        } else {
            " ".to_string()
        };
        let boxc = if *locked {
            th.accent(th.dot_filled())
        } else if *checked {
            th.accent(th.box_checked())
        } else {
            th.dim(th.box_unchecked())
        };
        let lbl = if *checked {
            th.heading(label)
        } else {
            label.to_string()
        };
        let suffix = if *locked {
            format!(" {}", th.dim("· needed for this profile"))
        } else {
            String::new()
        };
        body.push(format!(" {cursor} {boxc} {lbl}{suffix}"));
        body.push(format!("       {}", th.dim(benefit)));
    }
    let chrome = Chrome {
        step: 2,
        total: 6,
        label: "Services".to_string(),
    };
    compose(
        th,
        &chrome,
        "Services",
        &body,
        "↑ ↓ move · Space toggle · Enter continue",
        sz,
    )
}

fn review_grid(th: &Theme, sz: TermSize) -> Vec<String> {
    let kv = |k: &str, v: &str| format!("  {}  {}", th.dim(&format!("{k:<14}")), v);
    let mut body = vec![th.heading("Ready to deploy"), String::new()];
    for line in [
        kv("Address", "192.168.1.50"),
        kv("Scope", "all-in-one"),
        kv("Convex", "spin up locally"),
        kv("Mission Ctrl", "spin up locally"),
        kv("MQTT", "spin up locally"),
        kv("Video", "spin up locally"),
        kv("Ports", "defaults"),
        kv("Access", "HTTP on the LAN"),
    ] {
        body.push(line);
    }
    body.push(String::new());
    let w = inner(sz.cols);
    body.push(th.selection_bar(&format!("{} Deploy now", th.dot_filled()), w));
    body.push(format!("  {} Change an answer", th.dim(th.dot_empty())));
    body.push(format!("  {} Cancel", th.dim(th.dot_empty())));
    let chrome = Chrome {
        step: 6,
        total: 6,
        label: "Review".to_string(),
    };
    compose(
        th,
        &chrome,
        "Review",
        &body,
        "↑ ↓ move · Enter to choose",
        sz,
    )
}

fn success_grid(th: &Theme, sz: TermSize) -> Vec<String> {
    let row = |label: &str, url: &str| {
        format!(
            "  {} {:<18} {}",
            th.ok(th.dot_filled()),
            th.bold(label),
            th.accent(url)
        )
    };
    let body = vec![
        format!(
            "{}  {}",
            th.ok(th.glyph_ok()),
            th.heading("Your ADOS stack is live")
        ),
        String::new(),
        th.heading("Open Mission Control"),
        row("Mission Control", "http://192.168.1.50:4000"),
        row("Convex dashboard", "http://192.168.1.50:6791"),
        row("Video relay", "http://192.168.1.50:3001"),
        format!(
            "  {} {:<18} {}",
            th.ok(th.dot_filled()),
            th.bold("MQTT broker"),
            th.dim("192.168.1.50:9001")
        ),
        String::new(),
        th.dim("Direct IP is the most reliable reach. Pair a drone by hostname/IP."),
    ];
    compose(
        th,
        &Chrome::default(),
        "Deployed",
        &body,
        "Press Enter to finish",
        sz,
    )
}

/// The progressive event stops the deploy demo animates through.
fn deploy_stops() -> Vec<Vec<ProgressEvent>> {
    let done = |id: &str| {
        vec![
            ProgressEvent::StepStarted { id: id.into() },
            ProgressEvent::StepResult {
                id: id.into(),
                outcome: StepOutcome::Ok,
            },
        ]
    };
    let active = |id: &str, msg: &str, logs: &[&str]| {
        let mut v = vec![
            ProgressEvent::StepStarted { id: id.into() },
            ProgressEvent::Activity {
                id: id.into(),
                message: msg.into(),
            },
        ];
        for l in logs {
            v.push(ProgressEvent::SubLog {
                id: id.into(),
                line: (*l).to_string(),
            });
        }
        v
    };
    // Combine owned event vecs by moving (ProgressEvent is not Clone).
    fn seq(parts: Vec<Vec<ProgressEvent>>) -> Vec<ProgressEvent> {
        let mut out = Vec::new();
        for p in parts {
            out.extend(p);
        }
        out
    }
    // Each stop appends to the accumulated event stream.
    vec![
        active("preflight", "checking Docker", &["Docker 27.5.1"]),
        seq(vec![
            done("preflight"),
            active("write_config", "writing .env", &[]),
        ]),
        seq(vec![
            done("write_config"),
            active("up_convex", "pulling images", &["Pulling convex-backend"]),
        ]),
        seq(vec![
            done("up_convex"),
            active("wait_convex", "waiting for Convex :3210 (6s)", &[]),
        ]),
        seq(vec![
            done("wait_convex"),
            done("admin_key"),
            active(
                "push_functions",
                "deploying functions",
                &["Bundled 214 modules", "Deployed"],
            ),
        ]),
        seq(vec![
            done("push_functions"),
            done("auth_keys"),
            done("mqtt_passwd"),
            active(
                "up_rest",
                "building mission-control",
                &["=> [build 6/9] RUN next build", "=> exporting layers"],
            ),
        ]),
    ]
}

fn deploy_grid(th: &Theme, sz: TermSize, stop: usize) -> Vec<String> {
    let stops = deploy_stops();
    let mut events: Vec<ProgressEvent> = Vec::new();
    for s in stops.into_iter().take(stop + 1) {
        events.extend(s);
    }
    fullscreen::sample_grid(
        th,
        sz,
        DEPLOY_GROUPS,
        "ADOS · Deploying",
        DEPLOY_FOOTER,
        events,
        3,
        (30 + stop * 12) as u64,
    )
}
