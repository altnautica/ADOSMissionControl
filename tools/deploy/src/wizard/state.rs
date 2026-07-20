//! The collected deploy configuration — every wizard answer, plus the derived
//! URLs and generated secrets. Pure + fully unit-testable; the interactive
//! screens fill it and the plan/state-machine consume it.

use crate::services::Ports;

/// How a given backing service is provided.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Provision {
    /// Spin the service up locally in the compose stack.
    SpinUp,
    /// Point at an existing, operator-managed endpoint (don't spin one up).
    Managed { url: String },
}

impl Provision {
    pub fn is_managed(&self) -> bool {
        matches!(self, Provision::Managed { .. })
    }
    pub fn managed_url(&self) -> Option<&str> {
        match self {
            Provision::Managed { url } => Some(url),
            Provision::SpinUp => None,
        }
    }
}

/// The overall deployment shape.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Scope {
    /// Convex + GCS + MQTT + video, all on this host.
    AllInOne,
    /// Only the relay layers (MQTT + video), pointed at an existing Convex + GCS.
    RelayOnly,
}

/// How the stack is exposed (TLS posture).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Tls {
    /// Plain HTTP on the LAN. Cloud mode (HTTPS-only in the browser) stays off.
    HttpLan,
    /// A Cloudflare Tunnel fronts the stack (token supplied).
    CloudflareTunnel { token: String },
    /// The operator runs their own reverse proxy / TLS terminator.
    CustomProxy,
}

impl Tls {
    /// True when browser cloud mode (HTTPS) can engage.
    pub fn is_https(&self) -> bool {
        matches!(self, Tls::CloudflareTunnel { .. } | Tls::CustomProxy)
    }
}

/// The full set of collected deploy answers.
#[derive(Debug, Clone)]
pub struct DeployConfig {
    /// The address browsers + agents reach the stack at (LAN IP or domain).
    pub host: String,
    /// The deployment shape.
    pub scope: Scope,
    /// Convex provisioning.
    pub convex: Provision,
    /// Whether to deploy the Mission Control web GCS (always true in AllInOne).
    pub gcs: bool,
    /// MQTT relay provisioning.
    pub mqtt: Provision,
    /// Video relay provisioning.
    pub video: Provision,
    /// The host-facing ports.
    pub ports: Ports,
    /// The TLS / tunnel posture.
    pub tls: Tls,
    /// The MQTT principal username (default `ados`).
    pub mqtt_username: String,
    /// The MQTT principal password (generated, or operator-supplied). SECRET.
    pub mqtt_password: String,
    /// The Convex instance name (stable id; part of the admin key).
    pub instance_name: String,
    /// The Convex instance secret (generated). SECRET.
    pub instance_secret: String,
}

impl Default for DeployConfig {
    fn default() -> Self {
        DeployConfig {
            host: "127.0.0.1".to_string(),
            scope: Scope::AllInOne,
            convex: Provision::SpinUp,
            gcs: true,
            mqtt: Provision::SpinUp,
            video: Provision::SpinUp,
            ports: Ports::default(),
            tls: Tls::HttpLan,
            mqtt_username: "ados".to_string(),
            instance_name: "ados-selfhosted".to_string(),
            // Filled by `with_generated_secrets()`; empty here so `Default` is pure.
            mqtt_password: String::new(),
            instance_secret: String::new(),
        }
    }
}

impl DeployConfig {
    /// A fresh config with the two secrets minted. Kept separate from `Default`
    /// so tests can build a deterministic config without randomness.
    pub fn with_generated_secrets() -> Self {
        DeployConfig {
            instance_secret: mint_hex(32),
            mqtt_password: mint_hex(18),
            ..Self::default()
        }
    }

    /// The URL scheme browsers use, given the TLS posture. The container-facing
    /// origins stay `http` on the host network regardless; only the browser-facing
    /// advertised URLs go `https`/`wss` behind a tunnel/proxy.
    fn browser_scheme(&self) -> &'static str {
        if self.tls.is_https() {
            "https"
        } else {
            "http"
        }
    }

    fn ws_scheme(&self) -> &'static str {
        if self.tls.is_https() {
            "wss"
        } else {
            "ws"
        }
    }

    /// `NEXT_PUBLIC_CONVEX_URL` — the browser → Convex client API origin.
    pub fn next_public_convex_url(&self) -> String {
        match &self.convex {
            Provision::Managed { url } => url.clone(),
            Provision::SpinUp => format!(
                "{}://{}:{}",
                self.browser_scheme(),
                self.host,
                self.ports.convex_client
            ),
        }
    }

    /// `CONVEX_URL` — the agent + bridge → Convex site / HTTP-actions origin.
    pub fn convex_site_url(&self) -> String {
        match &self.convex {
            // A managed Convex advertises one origin; the site origin is derived
            // by the operator's own routing, so we reuse the supplied URL.
            Provision::Managed { url } => url.clone(),
            Provision::SpinUp => format!("http://{}:{}", self.host, self.ports.convex_site),
        }
    }

    /// The Convex cloud + site origins the backend container is configured with
    /// (always host-network http).
    pub fn convex_cloud_origin(&self) -> String {
        format!("http://{}:{}", self.host, self.ports.convex_client)
    }
    pub fn convex_site_origin(&self) -> String {
        format!("http://{}:{}", self.host, self.ports.convex_site)
    }

    /// `SITE_URL` — the app origin Convex Auth uses (the GCS).
    pub fn site_url(&self) -> String {
        format!(
            "{}://{}:{}",
            self.browser_scheme(),
            self.host,
            self.ports.gcs
        )
    }

    /// The Convex dashboard URL.
    pub fn dashboard_url(&self) -> String {
        format!(
            "{}://{}:{}",
            self.browser_scheme(),
            self.host,
            self.ports.dashboard
        )
    }

    /// The Mission Control web GCS URL (what the operator opens).
    pub fn gcs_url(&self) -> String {
        format!(
            "{}://{}:{}",
            self.browser_scheme(),
            self.host,
            self.ports.gcs
        )
    }

    /// `MQTT_BROKER_URL` set on Convex so the browser learns the broker WS URL.
    pub fn mqtt_broker_url(&self) -> String {
        match &self.mqtt {
            Provision::Managed { url } => url.clone(),
            Provision::SpinUp => {
                format!(
                    "{}://{}:{}/mqtt",
                    self.ws_scheme(),
                    self.host,
                    self.ports.mqtt_ws
                )
            }
        }
    }

    /// `VIDEO_RELAY_URL` set on Convex so the browser learns the relay WS URL.
    pub fn video_relay_url(&self) -> String {
        match &self.video {
            Provision::Managed { url } => url.clone(),
            Provision::SpinUp => {
                format!("{}://{}:{}", self.ws_scheme(), self.host, self.ports.video)
            }
        }
    }

    /// The compose service ids that should be brought up, filtered by which are
    /// spun up locally (managed services + the relay-only scope drop containers).
    pub fn compose_services(&self) -> Vec<&'static str> {
        use crate::services::*;
        let mut svc = Vec::new();
        if matches!(self.scope, Scope::AllInOne) {
            if self.convex.is_managed() {
                // managed convex → no backend/dashboard containers
            } else {
                svc.push(SVC_CONVEX_BACKEND);
                svc.push(SVC_CONVEX_DASHBOARD);
            }
            if self.gcs {
                svc.push(SVC_MISSION_CONTROL);
            }
        }
        if !self.mqtt.is_managed() {
            svc.push(SVC_MOSQUITTO);
            svc.push(SVC_MQTT_BRIDGE);
        }
        if !self.video.is_managed() {
            svc.push(SVC_VIDEO_RELAY);
        }
        svc
    }
}

/// Mint `n` random bytes as a lowercase hex string. Falls back to a
/// time-independent constant only if the OS RNG fails (never expected).
pub fn mint_hex(n: usize) -> String {
    let mut buf = vec![0u8; n];
    if getrandom::getrandom(&mut buf).is_err() {
        // OS RNG unavailable: refuse to emit a weak secret silently.
        return String::new();
    }
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
#[allow(clippy::field_reassign_with_default)]
mod tests {
    use super::*;

    #[test]
    fn default_urls_use_host_and_ports() {
        let mut c = DeployConfig::default();
        c.host = "192.168.1.50".to_string();
        assert_eq!(c.next_public_convex_url(), "http://192.168.1.50:3210");
        assert_eq!(c.convex_site_url(), "http://192.168.1.50:3211");
        assert_eq!(c.site_url(), "http://192.168.1.50:4000");
        assert_eq!(c.dashboard_url(), "http://192.168.1.50:6791");
        assert_eq!(c.mqtt_broker_url(), "ws://192.168.1.50:9001/mqtt");
        assert_eq!(c.video_relay_url(), "ws://192.168.1.50:3001");
    }

    #[test]
    fn https_posture_switches_browser_schemes() {
        let mut c = DeployConfig::default();
        c.host = "fleet.example.com".to_string();
        c.tls = Tls::CustomProxy;
        assert_eq!(c.next_public_convex_url(), "https://fleet.example.com:3210");
        assert_eq!(c.mqtt_broker_url(), "wss://fleet.example.com:9001/mqtt");
    }

    #[test]
    fn managed_services_drop_their_containers_and_use_supplied_urls() {
        let mut c = DeployConfig::default();
        c.host = "10.0.0.9".to_string();
        c.mqtt = Provision::Managed {
            url: "wss://mqtt.example.com/mqtt".to_string(),
        };
        c.video = Provision::Managed {
            url: "wss://video.example.com".to_string(),
        };
        assert_eq!(c.mqtt_broker_url(), "wss://mqtt.example.com/mqtt");
        assert_eq!(c.video_relay_url(), "wss://video.example.com");
        let svc = c.compose_services();
        assert!(svc.contains(&"convex-backend"));
        assert!(svc.contains(&"mission-control"));
        assert!(!svc.contains(&"mosquitto"));
        assert!(!svc.contains(&"video-relay"));
    }

    #[test]
    fn relay_only_scope_drops_convex_and_gcs() {
        let mut c = DeployConfig::default();
        c.scope = Scope::RelayOnly;
        let svc = c.compose_services();
        assert!(!svc.contains(&"convex-backend"));
        assert!(!svc.contains(&"mission-control"));
        assert!(svc.contains(&"mosquitto"));
        assert!(svc.contains(&"video-relay"));
    }

    #[test]
    fn generated_secrets_are_hex_of_expected_length() {
        let c = DeployConfig::with_generated_secrets();
        assert_eq!(c.instance_secret.len(), 64); // 32 bytes → 64 hex chars
        assert_eq!(c.mqtt_password.len(), 36); // 18 bytes → 36 hex chars
        assert!(c.instance_secret.chars().all(|ch| ch.is_ascii_hexdigit()));
    }

    #[test]
    fn compose_services_matrix() {
        use crate::services::*;
        // All-in-one, everything spun up → all six containers.
        let all = DeployConfig::default().compose_services();
        for svc in [
            SVC_CONVEX_BACKEND,
            SVC_CONVEX_DASHBOARD,
            SVC_MISSION_CONTROL,
            SVC_MOSQUITTO,
            SVC_MQTT_BRIDGE,
            SVC_VIDEO_RELAY,
        ] {
            assert!(all.contains(&svc), "all-in-one is missing {svc}");
        }

        // --no-mqtt + --no-video (Managed with an empty URL) drop those containers
        // but keep Convex + the GCS.
        let mut c = DeployConfig::default();
        c.mqtt = Provision::Managed { url: String::new() };
        c.video = Provision::Managed { url: String::new() };
        let s = c.compose_services();
        assert!(s.contains(&SVC_CONVEX_BACKEND));
        assert!(s.contains(&SVC_MISSION_CONTROL));
        assert!(!s.contains(&SVC_MOSQUITTO));
        assert!(!s.contains(&SVC_MQTT_BRIDGE));
        assert!(!s.contains(&SVC_VIDEO_RELAY));

        // GCS unchecked drops just the mission-control container.
        let mut c2 = DeployConfig::default();
        c2.gcs = false;
        assert!(!c2.compose_services().contains(&SVC_MISSION_CONTROL));
    }
}
