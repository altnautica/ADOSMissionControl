//! The service + port registry — the single source of truth for what the
//! self-host stack runs and the default ports, mirroring
//! `tools/selfhost/docker-compose.yml`.

/// The compose service names, exactly as they appear in
/// `tools/selfhost/docker-compose.yml`.
pub const SVC_CONVEX_BACKEND: &str = "convex-backend";
pub const SVC_CONVEX_DASHBOARD: &str = "convex-dashboard";
pub const SVC_MISSION_CONTROL: &str = "mission-control";
pub const SVC_MOSQUITTO: &str = "mosquitto";
pub const SVC_MQTT_BRIDGE: &str = "mqtt-bridge";
pub const SVC_VIDEO_RELAY: &str = "video-relay";

/// The host-facing ports the stack binds. Defaults match the compose file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Ports {
    /// Convex client API (browser → `NEXT_PUBLIC_CONVEX_URL`).
    pub convex_client: u16,
    /// Convex site / HTTP actions (agent + bridge → `CONVEX_URL`).
    pub convex_site: u16,
    /// Convex dashboard UI.
    pub dashboard: u16,
    /// Mission Control web GCS.
    pub gcs: u16,
    /// Mosquitto MQTT TCP listener.
    pub mqtt_tcp: u16,
    /// Mosquitto MQTT WebSocket listener (browser).
    pub mqtt_ws: u16,
    /// Video relay (RTSP → fMP4 WebSocket).
    pub video: u16,
}

impl Default for Ports {
    fn default() -> Self {
        Ports {
            convex_client: 3210,
            convex_site: 3211,
            dashboard: 6791,
            gcs: 4000,
            mqtt_tcp: 1883,
            mqtt_ws: 9001,
            video: 3001,
        }
    }
}

impl Ports {
    /// Every bound port, with a human label, in a stable order (for conflict
    /// detection + the review summary).
    pub fn labeled(&self) -> Vec<(&'static str, u16)> {
        vec![
            ("Convex client API", self.convex_client),
            ("Convex site / HTTP actions", self.convex_site),
            ("Convex dashboard", self.dashboard),
            ("Mission Control", self.gcs),
            ("MQTT (TCP)", self.mqtt_tcp),
            ("MQTT (WebSocket)", self.mqtt_ws),
            ("Video relay", self.video),
        ]
    }

    /// True when any port differs from the compose default (so an override file
    /// is needed).
    pub fn is_default(&self) -> bool {
        *self == Ports::default()
    }
}
