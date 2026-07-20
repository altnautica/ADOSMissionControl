//! The turnkey deploy step machine — one `graph::Step` per stage, in dependency
//! order, driven by `graph::run_graph`. A Required failure aborts (no half-stack);
//! Optional failures degrade. Each step streams its subprocess output to the
//! live split-view via the progress sink, and skips cleanly when its work does
//! not apply (a managed service, or the relay-only scope).

use std::time::Duration;

use crate::checks;
use crate::ctx::Ctx;
use crate::docker;
use crate::env_files;
use crate::graph::{Step, StepKind, StepOutcome};
use crate::services::SVC_CONVEX_BACKEND;
use crate::ui::activity;
use crate::ui::ProgressSink;
use crate::wizard::state::Scope;

/// The full ordered step set for a deploy.
pub fn build_steps() -> Vec<Box<dyn Step>> {
    vec![
        Box::new(Preflight),
        Box::new(WriteConfig),
        Box::new(UpConvex),
        Box::new(WaitConvex),
        Box::new(AdminKey),
        Box::new(PushFunctions),
        Box::new(AuthKeys),
        Box::new(MqttPasswd),
        Box::new(UpRest),
        Box::new(Verify),
    ]
}

/// Emit a raw line into the step's log tail and, when a reducer matches, set the
/// curated headline for the live-detail pane.
fn emit(sink: &ProgressSink, id: &str, reduce: fn(&str) -> Option<String>, line: &str) {
    sink.sub_log(id, line);
    if let Some(h) = reduce(line) {
        sink.activity(id, h);
    }
}

/// Whether Convex is spun up locally (all-in-one and not managed).
fn convex_is_local(ctx: &Ctx) -> bool {
    matches!(ctx.config.scope, Scope::AllInOne) && !ctx.config.convex.is_managed()
}

// ── preflight ───────────────────────────────────────────────────────────────

struct Preflight;
impl Step for Preflight {
    fn id(&self) -> &str {
        "preflight"
    }
    fn requires(&self) -> &[&str] {
        &[]
    }
    fn checkpoint(&self) -> Option<&str> {
        None
    }
    fn kind(&self) -> StepKind {
        StepKind::Required
    }
    fn run(&self, ctx: &mut Ctx) -> StepOutcome {
        let sink = ctx.progress.clone();
        sink.activity("preflight", "checking Docker".into());
        if !docker::docker_present() {
            return StepOutcome::Failed("Docker is not installed. Install Docker Desktop.".into());
        }
        if !docker::is_docker_running() {
            return StepOutcome::Failed(
                "the Docker daemon is not running — start Docker Desktop and retry".into(),
            );
        }
        if convex_is_local(ctx) && !checks::node_present() {
            return StepOutcome::Failed(
                "Node.js is not installed (needed to push Convex functions). Install Node 20+."
                    .into(),
            );
        }
        // Port availability is advisory: a re-deploy's ports are held by our own
        // containers, so a conflict here is not fatal.
        for (label, port) in ctx.config.ports.labeled() {
            if !checks::port_free(port) {
                sink.sub_log("preflight", &format!("port {port} ({label}) is in use"));
            }
        }
        StepOutcome::Ok
    }
}

// ── write config ─────────────────────────────────────────────────────────────

struct WriteConfig;
impl Step for WriteConfig {
    fn id(&self) -> &str {
        "write_config"
    }
    fn requires(&self) -> &[&str] {
        &["preflight"]
    }
    fn checkpoint(&self) -> Option<&str> {
        None
    }
    fn kind(&self) -> StepKind {
        StepKind::Required
    }
    fn run(&self, ctx: &mut Ctx) -> StepOutcome {
        let sink = ctx.progress.clone();
        let selfhost = ctx.selfhost_dir();
        sink.activity("write_config", "writing .env".into());
        let env_path = selfhost.join(".env");
        if let Err(e) = env_files::write_secret_file(
            &ctx.repo_root,
            &env_path,
            &env_files::render_env(&ctx.config),
        ) {
            return StepOutcome::Failed(e.to_string());
        }
        if let Some(ov) = env_files::render_override(&ctx.config) {
            let ov_path = selfhost.join("docker-compose.override.yml");
            sink.activity("write_config", "writing port overrides".into());
            if let Err(e) = env_files::write_secret_file(&ctx.repo_root, &ov_path, &ov) {
                return StepOutcome::Failed(e.to_string());
            }
        }
        StepOutcome::Ok
    }
}

// ── convex bring-up ───────────────────────────────────────────────────────────

struct UpConvex;
impl Step for UpConvex {
    fn id(&self) -> &str {
        "up_convex"
    }
    fn requires(&self) -> &[&str] {
        &["write_config"]
    }
    fn checkpoint(&self) -> Option<&str> {
        Some("up_convex")
    }
    fn kind(&self) -> StepKind {
        StepKind::Required
    }
    fn run(&self, ctx: &mut Ctx) -> StepOutcome {
        if !convex_is_local(ctx) {
            return StepOutcome::Skipped;
        }
        let sink = ctx.progress.clone();
        let root = ctx.repo_root.clone();
        let res = docker::compose_streamed(
            &root,
            &["up", "-d", "convex-backend", "convex-dashboard"],
            |l| emit(&sink, "up_convex", activity::docker_activity, l),
        );
        if res.success() {
            StepOutcome::Ok
        } else {
            StepOutcome::Failed(fail_tail("starting Convex failed", &res.stderr))
        }
    }
}

struct WaitConvex;
impl Step for WaitConvex {
    fn id(&self) -> &str {
        "wait_convex"
    }
    fn requires(&self) -> &[&str] {
        &["up_convex"]
    }
    fn checkpoint(&self) -> Option<&str> {
        None
    }
    fn kind(&self) -> StepKind {
        StepKind::Required
    }
    fn run(&self, ctx: &mut Ctx) -> StepOutcome {
        if !convex_is_local(ctx) {
            return StepOutcome::Skipped;
        }
        let sink = ctx.progress.clone();
        let url = format!("{}/version", ctx.config.convex_cloud_origin());
        sink.activity("wait_convex", "waiting for Convex :3210".into());
        let ok = docker::wait_http_ok(&url, Duration::from_secs(120), |s| {
            sink.activity("wait_convex", format!("waiting for Convex :3210 ({s}s)"));
        });
        if ok {
            StepOutcome::Ok
        } else {
            StepOutcome::Failed(
                "Convex did not become ready within 120s — check `docker compose logs convex-backend`".into(),
            )
        }
    }
}

struct AdminKey;
impl Step for AdminKey {
    fn id(&self) -> &str {
        "admin_key"
    }
    fn requires(&self) -> &[&str] {
        &["wait_convex"]
    }
    fn checkpoint(&self) -> Option<&str> {
        None
    }
    fn kind(&self) -> StepKind {
        StepKind::Required
    }
    fn run(&self, ctx: &mut Ctx) -> StepOutcome {
        if !convex_is_local(ctx) {
            return StepOutcome::Skipped;
        }
        let sink = ctx.progress.clone();
        let root = ctx.repo_root.clone();
        sink.activity("admin_key", "deriving the admin key".into());
        let res = docker::compose_capture(
            &root,
            &["exec", "-T", SVC_CONVEX_BACKEND, "./generate_admin_key.sh"],
        );
        let key = res
            .stdout
            .lines()
            .map(str::trim)
            .find(|l| l.contains('|') && !l.is_empty());
        match key {
            Some(k) => {
                ctx.admin_key = Some(k.to_string());
                StepOutcome::Ok
            }
            None => StepOutcome::Failed(fail_tail(
                "could not retrieve the Convex admin key",
                &res.stderr,
            )),
        }
    }
}

struct PushFunctions;
impl Step for PushFunctions {
    fn id(&self) -> &str {
        "push_functions"
    }
    fn requires(&self) -> &[&str] {
        &["admin_key"]
    }
    fn checkpoint(&self) -> Option<&str> {
        Some("push_functions")
    }
    fn kind(&self) -> StepKind {
        StepKind::Required
    }
    fn run(&self, ctx: &mut Ctx) -> StepOutcome {
        if !convex_is_local(ctx) {
            return StepOutcome::Skipped;
        }
        let Some(key) = ctx.admin_key.clone() else {
            return StepOutcome::Failed("admin key missing (retrieval step did not run)".into());
        };
        let sink = ctx.progress.clone();
        let root = ctx.repo_root.clone();
        let url = ctx.config.convex_cloud_origin();
        sink.activity("push_functions", "pushing Convex functions".into());
        let cmd = docker::convex_command(
            "npx",
            &["convex", "deploy", "--yes", "--typecheck", "disable"],
            &root,
            &url,
            &key,
        );
        let res = crate::exec::run_streamed_cmd(cmd, |l| {
            emit(&sink, "push_functions", activity::convex_activity, l)
        });
        if res.success() {
            StepOutcome::Ok
        } else {
            StepOutcome::Failed(fail_tail("pushing Convex functions failed", &res.stderr))
        }
    }
}

struct AuthKeys;
impl Step for AuthKeys {
    fn id(&self) -> &str {
        "auth_keys"
    }
    fn requires(&self) -> &[&str] {
        &["push_functions"]
    }
    fn checkpoint(&self) -> Option<&str> {
        Some("auth_keys")
    }
    fn kind(&self) -> StepKind {
        StepKind::Required
    }
    fn run(&self, ctx: &mut Ctx) -> StepOutcome {
        if !convex_is_local(ctx) {
            return StepOutcome::Skipped;
        }
        let Some(key) = ctx.admin_key.clone() else {
            return StepOutcome::Failed("admin key missing".into());
        };
        let sink = ctx.progress.clone();
        let root = ctx.repo_root.clone();
        let url = ctx.config.convex_cloud_origin();

        sink.activity("auth_keys", "generating RS256 auth keys".into());
        // Full capture (no line cap): the PEM key is ~1.7 KB on one line, which
        // the streaming runners would truncate.
        let gen = docker::capture_in("node", &["scripts/generate-auth-keys.mjs"], &root, &[]);
        if !gen.success() {
            return StepOutcome::Failed(fail_tail("generating auth keys failed", &gen.stderr));
        }
        let jwt = parse_quoted(&gen.stdout, "JWT_PRIVATE_KEY");
        let jwks = parse_quoted(&gen.stdout, "JWKS");
        let (Some(jwt), Some(jwks)) = (jwt, jwks) else {
            return StepOutcome::Failed("could not parse the generated auth keys".into());
        };

        // Set the auth keys + the derived Convex env vars (SITE_URL, relay URLs).
        let mut pairs: Vec<(String, String)> =
            vec![("JWT_PRIVATE_KEY".into(), jwt), ("JWKS".into(), jwks)];
        for (k, v) in env_files::convex_env_vars(&ctx.config) {
            pairs.push((k.to_string(), v));
        }
        for (k, v) in &pairs {
            sink.activity("auth_keys", format!("setting {k}"));
            // `--` terminates option parsing: the JWT PEM value starts with
            // "-----BEGIN", which the CLI would otherwise read as a flag.
            let cmd = docker::convex_command(
                "npx",
                &["convex", "env", "set", "--", k, v],
                &root,
                &url,
                &key,
            );
            let res = crate::exec::run_streamed_cmd(cmd, |l| {
                emit(&sink, "auth_keys", activity::convex_activity, l)
            });
            if !res.success() {
                return StepOutcome::Failed(fail_tail(&format!("setting {k} failed"), &res.stderr));
            }
        }
        StepOutcome::Ok
    }
}

// ── mqtt credentials ──────────────────────────────────────────────────────────

struct MqttPasswd;
impl Step for MqttPasswd {
    fn id(&self) -> &str {
        "mqtt_passwd"
    }
    fn requires(&self) -> &[&str] {
        &["write_config"]
    }
    fn checkpoint(&self) -> Option<&str> {
        Some("mqtt_passwd")
    }
    fn kind(&self) -> StepKind {
        StepKind::Required
    }
    fn run(&self, ctx: &mut Ctx) -> StepOutcome {
        if ctx.config.mqtt.is_managed() {
            return StepOutcome::Skipped;
        }
        let sink = ctx.progress.clone();
        let selfhost = ctx.selfhost_dir();
        let selfhost_abs = std::fs::canonicalize(&selfhost).unwrap_or(selfhost);
        let mount = format!("{}:/work", selfhost_abs.display());
        sink.activity("mqtt_passwd", "hashing the MQTT password".into());
        let res = docker::streamed_in(
            "docker",
            &[
                "run",
                "--rm",
                "-v",
                &mount,
                "eclipse-mosquitto:2",
                "mosquitto_passwd",
                "-b",
                "-c",
                "/work/passwd",
                &ctx.config.mqtt_username,
                &ctx.config.mqtt_password,
            ],
            &ctx.repo_root,
            &[],
            |l| emit(&sink, "mqtt_passwd", activity::docker_activity, l),
        );
        if res.success() {
            StepOutcome::Ok
        } else {
            StepOutcome::Failed(fail_tail("creating the MQTT password failed", &res.stderr))
        }
    }
}

// ── start the rest + verify ───────────────────────────────────────────────────

struct UpRest;
impl Step for UpRest {
    fn id(&self) -> &str {
        "up_rest"
    }
    fn requires(&self) -> &[&str] {
        &["write_config", "auth_keys", "mqtt_passwd"]
    }
    fn checkpoint(&self) -> Option<&str> {
        None
    }
    fn kind(&self) -> StepKind {
        StepKind::Required
    }
    fn run(&self, ctx: &mut Ctx) -> StepOutcome {
        let sink = ctx.progress.clone();
        let root = ctx.repo_root.clone();
        let services = ctx.config.compose_services();
        let mut args: Vec<&str> = vec!["up", "-d", "--build"];
        args.extend(services.iter().copied());
        sink.activity("up_rest", "building + starting services".into());
        let res = docker::compose_streamed(&root, &args, |l| {
            emit(&sink, "up_rest", activity::docker_activity, l)
        });
        if res.success() {
            StepOutcome::Ok
        } else {
            StepOutcome::Failed(fail_tail("starting the services failed", &res.stderr))
        }
    }
}

struct Verify;
impl Step for Verify {
    fn id(&self) -> &str {
        "verify"
    }
    fn requires(&self) -> &[&str] {
        &["up_rest"]
    }
    fn checkpoint(&self) -> Option<&str> {
        None
    }
    fn kind(&self) -> StepKind {
        StepKind::Optional
    }
    fn run(&self, ctx: &mut Ctx) -> StepOutcome {
        let sink = ctx.progress.clone();
        let cfg = &ctx.config;
        let mut all_ok = true;
        let mut probe = |name: &str, ok: bool| {
            let mark = if ok { "ok" } else { "not ready yet" };
            sink.sub_log("verify", &format!("{name}: {mark}"));
            if !ok {
                all_ok = false;
            }
        };
        if cfg.gcs {
            probe("Mission Control :4000", docker::http_ok(&cfg.gcs_url()));
        }
        if !cfg.video.is_managed() {
            let vurl = format!("http://{}:{}", cfg.host, cfg.ports.video);
            probe("Video relay :3001", docker::http_ok(&vurl));
        }
        if convex_is_local(ctx) {
            probe(
                "Convex dashboard :6791",
                docker::http_ok(&format!("http://{}:{}", cfg.host, cfg.ports.dashboard)),
            );
        }
        if !cfg.mqtt.is_managed() {
            probe(
                "MQTT :1883",
                docker::tcp_open(&cfg.host, cfg.ports.mqtt_tcp, Duration::from_secs(2)),
            );
        }
        // Verify is Optional: a service still warming up degrades, never aborts.
        let _ = all_ok;
        StepOutcome::Ok
    }
}

// ── helpers ───────────────────────────────────────────────────────────────────

/// Extract the value of a `KEY="value"` or `KEY='value'` line from `text`.
fn parse_quoted(text: &str, key: &str) -> Option<String> {
    for line in text.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix(key) {
            let rest = rest.trim_start_matches('=').trim();
            let bytes = rest.as_bytes();
            if bytes.len() >= 2 {
                let q = bytes[0];
                if (q == b'"' || q == b'\'') && rest.ends_with(q as char) {
                    return Some(rest[1..rest.len() - 1].to_string());
                }
            }
        }
    }
    None
}

/// A failure message with a short tail of the subprocess stderr appended.
fn fail_tail(msg: &str, stderr: &str) -> String {
    let tail: Vec<&str> = stderr
        .lines()
        .rev()
        .take(3)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    if tail.is_empty() {
        msg.to_string()
    } else {
        format!("{msg}: {}", tail.join(" · "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph::topo_order;

    #[test]
    fn steps_form_a_valid_ordered_graph() {
        let steps = build_steps();
        let order = topo_order(&steps).expect("deploy graph orders");
        let pos = |id: &str| order.iter().position(|x| x == id).unwrap();
        assert!(pos("preflight") < pos("write_config"));
        assert!(pos("up_convex") < pos("wait_convex"));
        assert!(pos("admin_key") < pos("push_functions"));
        assert!(pos("push_functions") < pos("auth_keys"));
        assert!(pos("auth_keys") < pos("up_rest"));
        assert!(pos("mqtt_passwd") < pos("up_rest"));
        assert!(pos("up_rest") < pos("verify"));
    }

    #[test]
    fn parse_quoted_handles_both_quote_styles() {
        let text = "# comment\nJWT_PRIVATE_KEY=\"-----BEGIN abc def-----\"\nJWKS='{\"keys\":[]}'\n";
        assert_eq!(
            parse_quoted(text, "JWT_PRIVATE_KEY").as_deref(),
            Some("-----BEGIN abc def-----")
        );
        assert_eq!(parse_quoted(text, "JWKS").as_deref(), Some("{\"keys\":[]}"));
        assert!(parse_quoted(text, "MISSING").is_none());
    }

    #[test]
    fn fail_tail_appends_stderr_tail() {
        let s = fail_tail("boom", "line1\nline2\nline3\nline4");
        assert!(s.starts_with("boom: "));
        assert!(s.contains("line4"));
        assert!(!s.contains("line1"));
    }
}
