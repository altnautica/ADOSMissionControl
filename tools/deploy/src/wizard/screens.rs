//! The deploy wizard's interactive stages, in the installer's house style.
//!
//! Each stage reads/writes the shared [`DeployConfig`] via the widget grammar
//! (`select_list`, `checklist`, `confirm_card`, `text_input`, `password_input`).
//! Esc goes back a stage; Ctrl-C aborts the whole wizard. The Review stage
//! offers Deploy / change an answer / cancel. The wizard returns the finished
//! config (or `None` on cancel); the caller runs the plan or the state machine.

use std::path::Path;

use crate::cli::Args;
use crate::ui::tty::Tty;
use crate::ui::Theme;
use crate::wizard::state::{DeployConfig, Provision, Scope, Tls};
use crate::wizard::widgets::{
    checklist, confirm_card, password_input, select_list, summary_select, text_input, CheckItem,
    Choice, Flow,
};

/// The wizard stages, in order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Stage {
    Scope,
    Services,
    Host,
    Ports,
    Tls,
    Review,
}

impl Stage {
    const ALL: [Stage; 6] = [
        Stage::Scope,
        Stage::Services,
        Stage::Host,
        Stage::Ports,
        Stage::Tls,
        Stage::Review,
    ];
    fn label(&self) -> &'static str {
        match self {
            Stage::Scope => "Scope",
            Stage::Services => "Services",
            Stage::Host => "Address",
            Stage::Ports => "Ports",
            Stage::Tls => "Access",
            Stage::Review => "Review",
        }
    }
}

/// How a stage wants the driver to move.
enum Move {
    Next,
    Back,
    Abort,
    /// Jump to a specific stage index (the Review "change an answer" path).
    Jump(usize),
    /// The wizard is finished; deploy with the collected config.
    Finish,
}

/// Run the wizard. Returns the finished config, or `None` on cancel/abort/no-tty.
pub fn run(theme: &Theme, args: &Args, repo_root: &Path) -> anyhow::Result<Option<DeployConfig>> {
    let mut tty = match Tty::open()? {
        Some(t) => t,
        None => return Ok(None),
    };
    let mut cfg = DeployConfig::with_generated_secrets();
    prefill_from_existing(&mut cfg, repo_root);
    prefill_from_args(&mut cfg, args);

    let mut i = 0usize;
    loop {
        let stage = Stage::ALL[i];
        tty.set_chrome(i + 1, Stage::ALL.len(), stage.label());
        let mv = match stage {
            Stage::Scope => stage_scope(&mut tty, theme, &mut cfg),
            Stage::Services => stage_services(&mut tty, theme, &mut cfg),
            Stage::Host => stage_host(&mut tty, theme, &mut cfg),
            Stage::Ports => stage_ports(&mut tty, theme, &mut cfg),
            Stage::Tls => stage_tls(&mut tty, theme, &mut cfg),
            Stage::Review => stage_review(&mut tty, theme, &cfg),
        };
        match mv {
            Move::Next => i = (i + 1).min(Stage::ALL.len() - 1),
            Move::Back => {
                if i == 0 {
                    return Ok(None);
                }
                i -= 1;
            }
            Move::Abort => return Ok(None),
            Move::Jump(j) => i = j.min(Stage::ALL.len() - 1),
            Move::Finish => return Ok(Some(cfg)),
        }
    }
}

/// Build a config non-interactively from defaults + supplied flags (for
/// `--plan` and `--non-interactive`).
pub fn config_from_args(args: &Args, repo_root: &Path) -> DeployConfig {
    let mut c = DeployConfig::with_generated_secrets();
    prefill_from_existing(&mut c, repo_root);
    prefill_from_args(&mut c, args);
    c
}

/// Reconstruct the deploy config from an existing `tools/selfhost/.env` (+ the
/// port override), so Reconfigure / Upgrade / the reach-links surfaces target the
/// same backend a prior deploy created. Recovers the host, ports, instance
/// name/secret, MQTT principal, and whether Convex is spun up locally or managed.
///
/// Honest boundary: `.env` records the all-in-one spin-up shape (scope + the
/// MQTT/video provisioning choice are not persisted), so this returns an
/// all-in-one config; a managed-relay redeploy should use the wizard or the
/// non-interactive flags. The instance secret makes the derived admin key stable,
/// which is the load-bearing idempotency guarantee.
pub fn config_from_env(repo_root: &Path) -> Option<DeployConfig> {
    let get = |k: &str| crate::env_files::read_env_var(repo_root, k);
    // CONVEX_CLOUD_ORIGIN always carries the real local host (`http://<host>:<p>`),
    // even for a managed Convex — unlike NEXT_PUBLIC_CONVEX_URL, which becomes the
    // managed domain. So the host comes from the cloud origin.
    let cloud_origin = get("CONVEX_CLOUD_ORIGIN")?;
    let host = url_host(&cloud_origin);

    let mut cfg = DeployConfig {
        host: host.clone(),
        ports: crate::env_files::read_existing_ports(repo_root),
        ..DeployConfig::default()
    };
    if let Some(v) = get("CONVEX_INSTANCE_NAME") {
        cfg.instance_name = v;
    }
    if let Some(v) = get("CONVEX_INSTANCE_SECRET") {
        cfg.instance_secret = v;
    }
    if let Some(v) = get("MQTT_USERNAME") {
        cfg.mqtt_username = v;
    }
    if let Some(v) = get("MQTT_PASSWORD") {
        cfg.mqtt_password = v;
    }
    // Convex is managed when the browser URL points somewhere other than the
    // local backend host.
    if let Some(npc) = get("NEXT_PUBLIC_CONVEX_URL") {
        if url_host(&npc) != host {
            cfg.convex = Provision::Managed { url: npc };
        }
    }
    Some(cfg)
}

/// The host component of a `scheme://host[:port][/path]` URL.
fn url_host(url: &str) -> String {
    let after_scheme = url.split_once("://").map(|(_, r)| r).unwrap_or(url);
    after_scheme
        .split(['/', ':'])
        .next()
        .unwrap_or("127.0.0.1")
        .to_string()
}

/// Seed the config from an existing deploy (`.env` + override): reuse the
/// secrets (a stable admin key → idempotent re-run), and pre-fill the host,
/// ports, and Convex provisioning so a reconfigure shows the current values.
fn prefill_from_existing(cfg: &mut DeployConfig, repo_root: &Path) {
    if let Some(existing) = config_from_env(repo_root) {
        cfg.host = existing.host;
        cfg.ports = existing.ports;
        cfg.instance_name = existing.instance_name;
        cfg.instance_secret = existing.instance_secret;
        cfg.mqtt_username = existing.mqtt_username;
        cfg.mqtt_password = existing.mqtt_password;
        cfg.convex = existing.convex;
    }
}

/// Seed the config with any non-interactive flags the operator supplied.
fn prefill_from_args(cfg: &mut DeployConfig, args: &Args) {
    // Reach address: an explicit --host always wins; otherwise keep a host
    // recovered from an existing deploy; otherwise default to the detected LAN IP
    // (so a browser/drone on the same network can reach it).
    if args.host.is_some() {
        cfg.host = crate::host::default_host(args.host.as_deref());
    } else if cfg.host == DeployConfig::default().host {
        cfg.host = crate::host::default_host(None);
    }
    if let Some(pw) = &args.mqtt_password {
        cfg.mqtt_password = pw.clone();
    }
    if let Some(url) = &args.convex_managed_url {
        cfg.convex = Provision::Managed { url: url.clone() };
    }
    if let Some(url) = &args.mqtt_managed_url {
        cfg.mqtt = Provision::Managed { url: url.clone() };
    }
    if let Some(url) = &args.video_managed_url {
        cfg.video = Provision::Managed { url: url.clone() };
    }
    if args.no_mqtt {
        cfg.mqtt = Provision::Managed { url: String::new() };
    }
    if args.no_video {
        cfg.video = Provision::Managed { url: String::new() };
    }
    if let Some(token) = &args.tunnel_token {
        cfg.tls = Tls::CloudflareTunnel {
            token: token.clone(),
        };
    }
}

// ── stages ────────────────────────────────────────────────────────────────

fn stage_scope(tty: &mut Tty, theme: &Theme, cfg: &mut DeployConfig) -> Move {
    let choices = [
        Choice::new(
            "all",
            "All-in-one on this host",
            Some("Convex + Mission Control + MQTT + video, everything local"),
        ),
        Choice::new(
            "relay",
            "Relay layers only",
            Some("MQTT + video, pointed at an existing Convex + Mission Control"),
        ),
    ];
    let default = match cfg.scope {
        Scope::AllInOne => 0,
        Scope::RelayOnly => 1,
    };
    match select_list(
        tty,
        theme,
        "Scope",
        "What do you want to deploy?",
        &choices,
        default,
    ) {
        Flow::Value(0) => {
            cfg.scope = Scope::AllInOne;
            cfg.gcs = true;
            Move::Next
        }
        Flow::Value(_) => {
            cfg.scope = Scope::RelayOnly;
            cfg.gcs = false;
            Move::Next
        }
        Flow::Back => Move::Back,
        Flow::Abort => Move::Abort,
    }
}

fn stage_services(tty: &mut Tty, theme: &Theme, cfg: &mut DeployConfig) -> Move {
    if matches!(cfg.scope, Scope::RelayOnly) {
        // Relay-only: Convex + GCS are the operator's; capture the Convex site URL.
        let initial = cfg.convex.managed_url().unwrap_or("").to_string();
        return match ask_url(
            tty,
            theme,
            "Services",
            "Existing Convex site URL (e.g. https://convex.example.com)",
            &initial,
        ) {
            Flow::Value(url) => {
                cfg.convex = Provision::Managed { url };
                cfg.mqtt = spin_or_keep(&cfg.mqtt);
                cfg.video = spin_or_keep(&cfg.video);
                Move::Next
            }
            Flow::Back => Move::Back,
            Flow::Abort => Move::Abort,
        };
    }

    let items = vec![
        CheckItem {
            id: "convex".into(),
            label: "Convex backend".into(),
            benefit: "auth, fleet, missions, cloud relay".into(),
            checked: !cfg.convex.is_managed(),
            locked: false,
        },
        CheckItem {
            id: "gcs".into(),
            label: "Mission Control (web GCS)".into(),
            benefit: "the ground control station in the browser".into(),
            checked: true,
            locked: true,
        },
        CheckItem {
            id: "mqtt".into(),
            label: "MQTT relay".into(),
            benefit: "live telemetry to the browser over the cloud".into(),
            checked: !cfg.mqtt.is_managed(),
            locked: false,
        },
        CheckItem {
            id: "video".into(),
            label: "Video relay".into(),
            benefit: "drone video in the browser".into(),
            checked: !cfg.video.is_managed(),
            locked: false,
        },
    ];
    let picked = match checklist(
        tty,
        theme,
        "Services",
        "Which services should run locally? (uncheck to use your own)",
        items,
    ) {
        Flow::Value(v) => v,
        Flow::Back => return Move::Back,
        Flow::Abort => return Move::Abort,
    };

    for item in &picked {
        match item.id.as_str() {
            "gcs" => cfg.gcs = item.checked,
            "convex" => {
                if item.checked {
                    cfg.convex = Provision::SpinUp;
                } else {
                    match ask_managed(tty, theme, "Convex", &cfg.convex) {
                        Flow::Value(p) => cfg.convex = p,
                        Flow::Back => return Move::Back,
                        Flow::Abort => return Move::Abort,
                    }
                }
            }
            "mqtt" => {
                if item.checked {
                    cfg.mqtt = Provision::SpinUp;
                } else {
                    match ask_managed(tty, theme, "MQTT broker", &cfg.mqtt) {
                        Flow::Value(p) => cfg.mqtt = p,
                        Flow::Back => return Move::Back,
                        Flow::Abort => return Move::Abort,
                    }
                }
            }
            "video" => {
                if item.checked {
                    cfg.video = Provision::SpinUp;
                } else {
                    match ask_managed(tty, theme, "Video relay", &cfg.video) {
                        Flow::Value(p) => cfg.video = p,
                        Flow::Back => return Move::Back,
                        Flow::Abort => return Move::Abort,
                    }
                }
            }
            _ => {}
        }
    }
    Move::Next
}

fn stage_host(tty: &mut Tty, theme: &Theme, cfg: &mut DeployConfig) -> Move {
    let gcs_port = cfg.ports.gcs;
    let https = cfg.tls.is_https();
    let scheme = if https { "https" } else { "http" };
    match text_input(
        tty,
        theme,
        "Address",
        "Where do browsers and drones reach this stack? (LAN IP or domain)",
        &cfg.host,
        "Mission Control",
        |raw: &mut String, ch: char| {
            if ch.is_ascii_alphanumeric() || ch == '.' || ch == '-' {
                raw.push(ch.to_ascii_lowercase());
            }
        },
        move |raw: &str| {
            if raw.is_empty() {
                None
            } else {
                Some(format!("{scheme}://{raw}:{gcs_port}"))
            }
        },
        |raw: &str| {
            if raw.trim().is_empty() {
                Some("Enter a LAN IP (e.g. 192.168.1.50) or a domain".to_string())
            } else {
                None
            }
        },
    ) {
        Flow::Value(h) => {
            cfg.host = h;
            Move::Next
        }
        Flow::Back => Move::Back,
        Flow::Abort => Move::Abort,
    }
}

fn stage_ports(tty: &mut Tty, theme: &Theme, cfg: &mut DeployConfig) -> Move {
    let detail = vec![
        theme.dim("Defaults: Convex 3210/3211 · dashboard 6791 · Mission Control 4000"),
        theme.dim("MQTT 1883/9001 · video 3001"),
    ];
    match confirm_card(
        tty,
        theme,
        "Ports",
        "Use the default ports?",
        &detail,
        "Use defaults",
        "Customize",
        cfg.ports.is_default(),
    ) {
        Flow::Value(true) => Move::Next,
        Flow::Value(false) => customize_ports(tty, theme, cfg),
        Flow::Back => Move::Back,
        Flow::Abort => Move::Abort,
    }
}

fn customize_ports(tty: &mut Tty, theme: &Theme, cfg: &mut DeployConfig) -> Move {
    let mut p = cfg.ports;
    // (label, current, setter-index)
    let fields: [(&str, u16); 7] = [
        ("Convex client API", p.convex_client),
        ("Convex site / HTTP actions", p.convex_site),
        ("Convex dashboard", p.dashboard),
        ("Mission Control", p.gcs),
        ("MQTT TCP", p.mqtt_tcp),
        ("MQTT WebSocket", p.mqtt_ws),
        ("Video relay", p.video),
    ];
    let mut vals = [0u16; 7];
    for (idx, (label, cur)) in fields.iter().enumerate() {
        match ask_port(tty, theme, label, *cur) {
            Flow::Value(v) => vals[idx] = v,
            Flow::Back => return Move::Back,
            Flow::Abort => return Move::Abort,
        }
    }
    p.convex_client = vals[0];
    p.convex_site = vals[1];
    p.dashboard = vals[2];
    p.gcs = vals[3];
    p.mqtt_tcp = vals[4];
    p.mqtt_ws = vals[5];
    p.video = vals[6];
    cfg.ports = p;
    Move::Next
}

fn stage_tls(tty: &mut Tty, theme: &Theme, cfg: &mut DeployConfig) -> Move {
    let choices = [
        Choice::new(
            "http",
            "HTTP on the LAN",
            Some("simplest; browser cloud mode stays off"),
        ),
        Choice::new(
            "cf",
            "Cloudflare Tunnel",
            Some("public HTTPS with no open ports (token)"),
        ),
        Choice::new(
            "proxy",
            "My own reverse proxy",
            Some("you terminate TLS in front of the stack"),
        ),
    ];
    let default = match cfg.tls {
        Tls::HttpLan => 0,
        Tls::CloudflareTunnel { .. } => 1,
        Tls::CustomProxy => 2,
    };
    match select_list(
        tty,
        theme,
        "Access",
        "How is the stack reached?",
        &choices,
        default,
    ) {
        Flow::Value(0) => {
            // Warn that cloud mode won't engage on plain HTTP.
            let detail = vec![
                theme.dim("Mission Control's browser cloud mode only activates over HTTPS."),
                theme.dim("On HTTP, drones appear over the LAN / direct-agent path."),
                theme.dim("For internet fleet control, pick a tunnel."),
            ];
            match confirm_card(
                tty,
                theme,
                "Access",
                "Continue with HTTP on the LAN?",
                &detail,
                "Continue",
                "Go back",
                true,
            ) {
                Flow::Value(true) => {
                    cfg.tls = Tls::HttpLan;
                    Move::Next
                }
                Flow::Value(false) => Move::Jump(idx_of(Stage::Tls)),
                Flow::Back => Move::Back,
                Flow::Abort => Move::Abort,
            }
        }
        Flow::Value(1) => {
            match password_input(tty, theme, "Access", "Cloudflare Tunnel token", 1) {
                Flow::Value(token) => {
                    cfg.tls = Tls::CloudflareTunnel { token };
                    Move::Next
                }
                Flow::Back => Move::Back,
                Flow::Abort => Move::Abort,
            }
        }
        Flow::Value(_) => {
            cfg.tls = Tls::CustomProxy;
            Move::Next
        }
        Flow::Back => Move::Back,
        Flow::Abort => Move::Abort,
    }
}

fn stage_review(tty: &mut Tty, theme: &Theme, cfg: &DeployConfig) -> Move {
    let summary = review_summary(theme, cfg);
    let choices = [
        Choice::new("deploy", "Deploy now", None),
        Choice::new("change", "Change an answer", None),
        Choice::new("cancel", "Cancel", None),
    ];
    match summary_select(
        tty,
        theme,
        "Review",
        "Ready to deploy",
        &summary,
        &choices,
        0,
    ) {
        Flow::Value(0) => Move::Finish,
        Flow::Value(1) => change_picker(tty, theme),
        Flow::Value(_) => Move::Abort,
        Flow::Back => Move::Back,
        Flow::Abort => Move::Abort,
    }
}

fn change_picker(tty: &mut Tty, theme: &Theme) -> Move {
    let choices = [
        Choice::new("scope", "Scope", None),
        Choice::new("services", "Services", None),
        Choice::new("host", "Address", None),
        Choice::new("ports", "Ports", None),
        Choice::new("tls", "Access", None),
    ];
    match select_list(tty, theme, "Review", "Which answer?", &choices, 0) {
        Flow::Value(i) => Move::Jump(i), // stages 0..=4 map 1:1
        Flow::Back => Move::Jump(idx_of(Stage::Review)),
        Flow::Abort => Move::Abort,
    }
}

// ── helpers ─────────────────────────────────────────────────────────────────

fn idx_of(stage: Stage) -> usize {
    Stage::ALL.iter().position(|s| *s == stage).unwrap()
}

/// Keep a managed provision, else spin up.
fn spin_or_keep(current: &Provision) -> Provision {
    match current {
        Provision::Managed { url } if !url.is_empty() => Provision::Managed { url: url.clone() },
        _ => Provision::SpinUp,
    }
}

/// Prompt for an existing service URL → `Provision::Managed`.
fn ask_managed(tty: &mut Tty, theme: &Theme, label: &str, current: &Provision) -> Flow<Provision> {
    let initial = current.managed_url().unwrap_or("").to_string();
    match ask_url(
        tty,
        theme,
        "Services",
        &format!("Existing {label} URL"),
        &initial,
    ) {
        Flow::Value(url) => Flow::Value(Provision::Managed { url }),
        Flow::Back => Flow::Back,
        Flow::Abort => Flow::Abort,
    }
}

/// A URL text input (allows the URL character set), non-empty.
fn ask_url(
    tty: &mut Tty,
    theme: &Theme,
    section: &str,
    prompt: &str,
    initial: &str,
) -> Flow<String> {
    text_input(
        tty,
        theme,
        section,
        prompt,
        initial,
        "URL",
        |raw: &mut String, ch: char| {
            if !ch.is_whitespace() {
                raw.push(ch);
            }
        },
        |raw: &str| {
            if raw.is_empty() {
                None
            } else {
                Some(raw.to_string())
            }
        },
        |raw: &str| {
            if raw.trim().is_empty() {
                Some("Enter a URL".to_string())
            } else {
                None
            }
        },
    )
}

/// A port text input (digits only, 1..=65535).
fn ask_port(tty: &mut Tty, theme: &Theme, label: &str, current: u16) -> Flow<u16> {
    let out = text_input(
        tty,
        theme,
        "Ports",
        &format!("{label} port"),
        &current.to_string(),
        "port",
        |raw: &mut String, ch: char| {
            if ch.is_ascii_digit() && raw.len() < 5 {
                raw.push(ch);
            }
        },
        // Live preview flags a port already bound on localhost (a non-blocking
        // hint — on a re-deploy the operator's own containers hold their ports).
        |raw: &str| {
            let note = match raw.parse::<u16>() {
                Ok(p) if p >= 1 && !crate::checks::port_free(p) => " · in use",
                _ => "",
            };
            Some(format!("bind :{raw}{note}"))
        },
        |raw: &str| match raw.parse::<u32>() {
            Ok(n) if (1..=65535).contains(&n) => None,
            _ => Some("Enter a port between 1 and 65535".to_string()),
        },
    );
    match out {
        Flow::Value(s) => Flow::Value(s.parse().unwrap_or(current)),
        Flow::Back => Flow::Back,
        Flow::Abort => Flow::Abort,
    }
}

/// The read-only review summary block.
fn review_summary(theme: &Theme, cfg: &DeployConfig) -> Vec<String> {
    let kv = |k: &str, v: &str| format!("  {}  {}", theme.dim(&format!("{k:<14}")), v);
    let prov = |p: &Provision, spin: &str| match p {
        Provision::SpinUp => spin.to_string(),
        Provision::Managed { url } if url.is_empty() => "not deployed".to_string(),
        Provision::Managed { url } => format!("managed · {url}"),
    };
    let scope = match cfg.scope {
        Scope::AllInOne => "all-in-one",
        Scope::RelayOnly => "relay only",
    };
    let tls = match &cfg.tls {
        Tls::HttpLan => "HTTP on the LAN".to_string(),
        Tls::CloudflareTunnel { .. } => "Cloudflare Tunnel".to_string(),
        Tls::CustomProxy => "custom reverse proxy".to_string(),
    };
    vec![
        kv("Address", &cfg.host),
        kv("Scope", scope),
        kv("Convex", &prov(&cfg.convex, "spin up locally")),
        kv(
            "Mission Ctrl",
            if cfg.gcs {
                "spin up locally"
            } else {
                "not deployed"
            },
        ),
        kv("MQTT", &prov(&cfg.mqtt, "spin up locally")),
        kv("Video", &prov(&cfg.video, "spin up locally")),
        kv(
            "Ports",
            if cfg.ports.is_default() {
                "defaults"
            } else {
                "custom"
            },
        ),
        kv("Access", &tls),
    ]
}

#[cfg(test)]
#[allow(clippy::field_reassign_with_default)]
mod tests {
    use super::*;

    #[test]
    fn stage_ordering_and_labels() {
        assert_eq!(Stage::ALL.len(), 6);
        assert_eq!(idx_of(Stage::Review), 5);
        assert_eq!(Stage::Scope.label(), "Scope");
    }

    #[test]
    fn review_summary_reflects_config() {
        let theme = Theme {
            ascii: true,
            tier: crate::ui::theme::ColorTier::None,
        };
        let mut cfg = DeployConfig::default();
        cfg.host = "192.168.1.50".into();
        cfg.video = Provision::Managed {
            url: "wss://video.example.com".into(),
        };
        let s = review_summary(&theme, &cfg).join("\n");
        assert!(s.contains("192.168.1.50"));
        assert!(s.contains("managed · wss://video.example.com"));
    }

    #[test]
    fn prefill_applies_flags() {
        let mut cfg = DeployConfig::with_generated_secrets();
        let args = Args {
            host: Some("10.0.0.5".into()),
            convex_managed_url: Some("https://c.example.com".into()),
            ..Args::default()
        };
        prefill_from_args(&mut cfg, &args);
        assert_eq!(cfg.host, "10.0.0.5");
        assert!(cfg.convex.is_managed());
    }
}
