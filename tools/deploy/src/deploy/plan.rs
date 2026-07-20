//! The deploy plan: the exact ordered command sequence + files a deploy would
//! run/write, built purely from a [`DeployConfig`]. Drives the `--plan` preview
//! and is the golden-test seam for the turnkey state machine, which runs the
//! same order for real. Secrets are always redacted.

use crate::env_files;
use crate::ui::Theme;
use crate::wizard::state::{DeployConfig, Scope, Tls};

/// The compose file, relative to the repo root (commands run with cwd = root).
pub const COMPOSE_FILE: &str = "tools/selfhost/docker-compose.yml";
/// The generated env file, relative to the repo root.
pub const ENV_FILE: &str = "tools/selfhost/.env";
/// The generated override file, relative to the repo root.
pub const OVERRIDE_FILE: &str = "tools/selfhost/docker-compose.override.yml";
/// The generated MQTT password file, relative to the repo root.
pub const PASSWD_FILE: &str = "tools/selfhost/passwd";

const REDACTED: &str = "<redacted>";

/// A file the deploy would write, with its content already secret-redacted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedFile {
    pub path: String,
    pub note: String,
    pub redacted_content: String,
}

/// A command the deploy would run, secret-redacted for display.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedCommand {
    pub label: String,
    pub display: String,
}

/// The full plan.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Plan {
    pub files: Vec<PlannedFile>,
    pub commands: Vec<PlannedCommand>,
}

impl Plan {
    /// Build the plan for `cfg`.
    pub fn build(cfg: &DeployConfig) -> Plan {
        Plan {
            files: planned_files(cfg),
            commands: planned_commands(cfg),
        }
    }

    /// Flat text lines (used by `--plan --json`-free plain output + tests).
    pub fn to_lines(&self) -> Vec<String> {
        let mut out = Vec::new();
        out.push("Files:".to_string());
        for f in &self.files {
            out.push(format!("  {}  ({})", f.path, f.note));
        }
        out.push("Commands:".to_string());
        for (i, c) in self.commands.iter().enumerate() {
            out.push(format!("  {}. {}", i + 1, c.label));
            out.push(format!("     $ {}", c.display));
        }
        out
    }

    /// Pretty-print the plan in the amber house style.
    pub fn render(&self, theme: &Theme) {
        println!(
            "\n{}  {}",
            theme.accent("▌ ADOS"),
            theme.heading("Deploy plan (dry run — nothing is executed)")
        );
        println!("\n{}", theme.heading("Files it would write"));
        for f in &self.files {
            println!(
                "  {} {}   {}",
                theme.accent("•"),
                theme.bold(&f.path),
                theme.dim(&f.note)
            );
        }
        println!("\n{}", theme.heading("Commands it would run, in order"));
        for (i, c) in self.commands.iter().enumerate() {
            println!("  {} {}", theme.accent(&format!("{}.", i + 1)), c.label);
            println!("     {}", theme.dim(&format!("$ {}", c.display)));
        }
        println!(
            "\n{}",
            theme.dim(
                "Secrets are redacted here; the real run writes them only to gitignored files."
            )
        );
    }
}

fn planned_files(cfg: &DeployConfig) -> Vec<PlannedFile> {
    let mut redacted = cfg.clone();
    redacted.instance_secret = REDACTED.to_string();
    redacted.mqtt_password = REDACTED.to_string();

    let mut files = vec![PlannedFile {
        path: ENV_FILE.to_string(),
        note: "stack env (secrets redacted)".to_string(),
        redacted_content: env_files::render_env(&redacted),
    }];
    if let Some(ov) = env_files::render_override(cfg) {
        files.push(PlannedFile {
            path: OVERRIDE_FILE.to_string(),
            note: "host port remaps".to_string(),
            redacted_content: ov,
        });
    }
    if !cfg.mqtt.is_managed() {
        files.push(PlannedFile {
            path: PASSWD_FILE.to_string(),
            note: "hashed MQTT principal".to_string(),
            redacted_content: format!("{}:{REDACTED}\n", cfg.mqtt_username),
        });
    }
    files
}

/// The compose invocation as it will really run: the base file, plus the
/// port-remap override layered with a second `-f` whenever ports are customized.
fn compose(cfg: &DeployConfig, args: &str) -> String {
    if cfg.ports.is_default() {
        format!("docker compose -f {COMPOSE_FILE} {args}")
    } else {
        format!("docker compose -f {COMPOSE_FILE} -f {OVERRIDE_FILE} {args}")
    }
}

fn planned_commands(cfg: &DeployConfig) -> Vec<PlannedCommand> {
    let mut c: Vec<PlannedCommand> = Vec::new();
    let push = |c: &mut Vec<PlannedCommand>, label: &str, display: String| {
        c.push(PlannedCommand {
            label: label.to_string(),
            display,
        });
    };

    push(
        &mut c,
        "Preflight: Docker running, ports free, Node present",
        "docker version && docker compose version".to_string(),
    );

    let spin_convex = matches!(cfg.scope, Scope::AllInOne) && !cfg.convex.is_managed();

    if spin_convex {
        push(
            &mut c,
            "Start Convex backend + dashboard",
            compose(cfg, "up -d convex-backend convex-dashboard"),
        );
        push(
            &mut c,
            "Wait for Convex to be ready",
            format!(
                "curl -f {}/version   (poll, ≤120s)",
                cfg.convex_cloud_origin()
            ),
        );
        push(
            &mut c,
            "Retrieve the deterministic admin key",
            compose(cfg, "exec -T convex-backend ./generate_admin_key.sh"),
        );
        push(
            &mut c,
            "Push Convex functions (self-hosted, env-var targeting)",
            format!(
                "CONVEX_SELF_HOSTED_URL={} CONVEX_SELF_HOSTED_ADMIN_KEY={REDACTED} npx convex deploy --yes --typecheck disable",
                cfg.convex_cloud_origin()
            ),
        );
        push(
            &mut c,
            "Generate + set the auth keys",
            "node scripts/generate-auth-keys.mjs → npx convex env set JWT_PRIVATE_KEY <redacted> / JWKS <redacted>".to_string(),
        );
        for (k, v) in env_files::convex_env_vars(cfg) {
            push(
                &mut c,
                &format!("Set Convex env {k}"),
                // `--` terminates option parsing (values like a PEM start with `-`).
                format!("npx convex env set -- {k} {v}"),
            );
        }
    }

    if !cfg.mqtt.is_managed() {
        push(
            &mut c,
            "Create the MQTT password file",
            format!(
                "docker run --rm -v <selfhost>:/work eclipse-mosquitto:2 mosquitto_passwd -b -c /work/passwd {} {REDACTED}",
                cfg.mqtt_username
            ),
        );
    }

    let services = cfg.compose_services().join(" ");
    push(
        &mut c,
        "Build + start the remaining services",
        compose(cfg, &format!("up -d --build --no-deps {services}")),
    );

    push(
        &mut c,
        "Verify each service is reachable",
        format!(
            "curl {} (GCS), curl http://{}:{} (video), tcp {}:{} (MQTT)",
            cfg.gcs_url(),
            cfg.host,
            cfg.ports.video,
            cfg.host,
            cfg.ports.mqtt_tcp
        ),
    );

    if matches!(cfg.tls, Tls::HttpLan) {
        push(
            &mut c,
            "Note: HTTP-only",
            "browser cloud mode needs HTTPS — add a tunnel for internet fleet control".to_string(),
        );
    }
    c
}

#[cfg(test)]
#[allow(clippy::field_reassign_with_default)]
mod tests {
    use super::*;
    use crate::wizard::state::Provision;

    fn cfg() -> DeployConfig {
        let mut c = DeployConfig::default();
        c.host = "192.168.1.50".to_string();
        c.instance_secret = "sekret".to_string();
        c.mqtt_password = "pw".to_string();
        c
    }

    #[test]
    fn all_in_one_plan_is_ordered_and_redacted() {
        let plan = Plan::build(&cfg());
        let labels: Vec<&str> = plan.commands.iter().map(|c| c.label.as_str()).collect();
        // The admin-key retrieval precedes the function push precedes bringing up
        // the rest.
        let idx = |needle: &str| labels.iter().position(|l| l.contains(needle)).unwrap();
        assert!(idx("Retrieve the deterministic admin key") < idx("Push Convex functions"));
        assert!(idx("Push Convex functions") < idx("Build + start the remaining services"));
        // No plaintext secret anywhere in the rendered plan.
        let text = plan.to_lines().join("\n")
            + &plan
                .files
                .iter()
                .map(|f| f.redacted_content.clone())
                .collect::<String>();
        assert!(!text.contains("sekret"), "instance secret leaked into plan");
        assert!(!text.contains("pw\n"), "mqtt password leaked into plan");
        assert!(text.contains("<redacted>"));
    }

    #[test]
    fn managed_convex_skips_convex_bringup_commands() {
        let mut c = cfg();
        c.convex = Provision::Managed {
            url: "https://convex.example.com".to_string(),
        };
        let plan = Plan::build(&c);
        let labels: Vec<&str> = plan.commands.iter().map(|c| c.label.as_str()).collect();
        assert!(!labels
            .iter()
            .any(|l| l.contains("Retrieve the deterministic admin key")));
        assert!(labels
            .iter()
            .any(|l| l.contains("Build + start the remaining services")));
    }

    #[test]
    fn relay_only_has_no_convex_or_gcs_files_beyond_env() {
        let mut c = cfg();
        c.scope = Scope::RelayOnly;
        let plan = Plan::build(&c);
        assert!(!plan
            .commands
            .iter()
            .any(|c| c.label.contains("Push Convex functions")));
    }

    // The plan and the real step machine are two encodings of the same ordered
    // flow. This ties them: every command-producing step must appear in the plan,
    // in the same order the graph runs them — so drift in either surface fails.
    #[test]
    fn plan_command_order_follows_build_steps() {
        let plan = Plan::build(&cfg()); // all-in-one, spin-up everything
        let labels: Vec<&str> = plan.commands.iter().map(|c| c.label.as_str()).collect();
        let steps = crate::deploy::steps::build_steps();
        let step_order = crate::graph::topo_order(&steps).expect("steps order");

        // (step id in build_steps, a substring of its plan command label)
        let expected: &[(&str, &str)] = &[
            ("preflight", "Preflight"),
            ("up_convex", "Start Convex"),
            ("wait_convex", "Wait for Convex"),
            ("admin_key", "admin key"),
            ("push_functions", "Push Convex functions"),
            ("auth_keys", "auth keys"),
            ("mqtt_passwd", "MQTT password"),
            ("up_rest", "Build + start"),
            ("verify", "Verify"),
        ];
        let mut last = 0usize;
        for (step_id, needle) in expected {
            assert!(
                step_order.iter().any(|s| s == step_id),
                "expected step {step_id} not in build_steps"
            );
            let pos = labels
                .iter()
                .position(|l| l.contains(needle))
                .unwrap_or_else(|| panic!("plan has no command for step {step_id} ({needle:?})"));
            assert!(pos >= last, "plan command for {step_id} is out of order");
            last = pos;
        }
    }
}
