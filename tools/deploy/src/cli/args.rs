//! Hand-rolled argument parser (no clap dependency, matching the installer).
//!
//! Rendering + interactivity flags gate the UI; the deploy-answer flags let the
//! whole flow run non-interactively (CI / scripted self-host) with every wizard
//! answer supplied up front.

/// Parsed command-line arguments.
#[derive(Debug, Clone, Default)]
pub struct Args {
    // --- rendering / interactivity -----------------------------------------
    /// `--no-color` — disable ANSI color.
    pub no_color: bool,
    /// `--ascii` — ASCII glyph tier (no Unicode box/spinner/marks).
    pub ascii: bool,
    /// `--plain` — escape-free line output (non-tty / CI).
    pub plain: bool,
    /// `--quiet` — only the final summary.
    pub quiet: bool,
    /// `--json` — machine output, no UI.
    pub json: bool,
    /// `--non-interactive` — never prompt; use flags/env/defaults.
    pub non_interactive: bool,
    /// `--yes` / `-y` — accept detected defaults at every prompt.
    pub yes: bool,

    // --- top-level action --------------------------------------------------
    /// A direct action name (`deploy`, `dev`, `demo`, `services`, `status`,
    /// `teardown`, `plan`), bypassing the interactive menu. `None` → menu.
    pub action: Option<String>,
    /// `--plan` / `--dry-run` — print the exact commands + files a deploy WOULD
    /// run/write, then exit without executing.
    pub plan: bool,

    // --- deploy answers (for --non-interactive) ----------------------------
    /// `--host <ip|domain>` — the address browsers/agents reach the stack at.
    pub host: Option<String>,
    /// `--mqtt-password <pw>` — the MQTT principal password (else generated).
    pub mqtt_password: Option<String>,
    /// `--convex-managed-url <url>` — use an existing Convex, don't spin one up.
    pub convex_managed_url: Option<String>,
    /// `--mqtt-managed-url <url>` — use an existing MQTT broker.
    pub mqtt_managed_url: Option<String>,
    /// `--video-managed-url <url>` — use an existing video relay.
    pub video_managed_url: Option<String>,
    /// `--tunnel-token <token>` — a Cloudflare Tunnel token (TLS path).
    pub tunnel_token: Option<String>,
    /// `--no-video` — do not deploy the video relay.
    pub no_video: bool,
    /// `--no-mqtt` — do not deploy the MQTT relay.
    pub no_mqtt: bool,
}

impl Args {
    /// Parse from an iterator of argument strings (excluding argv[0]). Unknown
    /// flags are ignored (forward-compatible). The first bare word is the action.
    pub fn parse<I: IntoIterator<Item = String>>(iter: I) -> Args {
        let mut a = Args::default();
        let mut it = iter.into_iter().peekable();
        while let Some(arg) = it.next() {
            match arg.as_str() {
                "--no-color" => a.no_color = true,
                "--ascii" => a.ascii = true,
                "--plain" => a.plain = true,
                "--quiet" => a.quiet = true,
                "--json" => a.json = true,
                "--non-interactive" => a.non_interactive = true,
                "--yes" | "-y" => a.yes = true,
                "--plan" | "--dry-run" => a.plan = true,
                "--no-video" => a.no_video = true,
                "--no-mqtt" => a.no_mqtt = true,
                "--host" => a.host = it.next(),
                "--mqtt-password" => a.mqtt_password = it.next(),
                "--convex-managed-url" => a.convex_managed_url = it.next(),
                "--mqtt-managed-url" => a.mqtt_managed_url = it.next(),
                "--video-managed-url" => a.video_managed_url = it.next(),
                "--tunnel-token" => a.tunnel_token = it.next(),
                other if other.starts_with('-') => { /* unknown flag: ignore */ }
                bare => {
                    if a.action.is_none() {
                        a.action = Some(bare.to_string());
                    }
                }
            }
        }
        a
    }

    /// Parse from the real process arguments.
    pub fn from_env() -> Args {
        Args::parse(std::env::args().skip(1))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_flags_and_action() {
        let a = Args::parse(
            ["deploy", "--host", "192.168.1.50", "--plan", "--no-video"]
                .iter()
                .map(|s| s.to_string()),
        );
        assert_eq!(a.action.as_deref(), Some("deploy"));
        assert_eq!(a.host.as_deref(), Some("192.168.1.50"));
        assert!(a.plan);
        assert!(a.no_video);
    }

    #[test]
    fn unknown_flags_are_ignored() {
        let a = Args::parse(["--frobnicate", "--json"].iter().map(|s| s.to_string()));
        assert!(a.json);
        assert!(a.action.is_none());
    }
}
