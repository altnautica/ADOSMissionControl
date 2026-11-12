/**
 * @module mock/vision-nav-demo-panel
 * @description The demo rendition of the Vision Navigation extension's node
 * tab: the header with the Replay tour link and the companion pill, the
 * first-run tour, the fallback banner, then the Mode, Navigation feed,
 * Sensors, Estimator, Telemetry trends, Flow health, Pre-arm and ArduPilot
 * parameter cards, laid out and labelled as the extension's own GCS panel
 * renders them, fed by the demo health snapshot.
 * Copy resolves through the host's plugin i18n with the extension's English
 * fallbacks, exactly as the extension resolves it. Mounted by
 * `DEMO_VISION_NAV_MODULE` inside the inline plugin host.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import type { InlineHostApi } from "@/lib/plugins/inline-host-types";
import {
  getMockVisionNavHealth,
  getMockVisionNavState,
  VISION_NAV_REFRESH_MS,
  type VisionNavCheckSeverity,
  type VisionNavExtnavHealth,
  type VisionNavHealth,
  type VisionNavState,
} from "./mock-vision-nav";
import { TelemetryCharts, TourOrchestrator, type Translate } from "./vision-nav-demo-tour";

const OK = "var(--vn-ok, #34d399)";
const WARN = "var(--vn-warn, #f59e0b)";
const ERROR = "var(--vn-error, #ef4444)";
const MUTED = "var(--vn-muted, #6b7280)";
const TEXT_2 = "var(--vn-text-2, #cbd5e1)";
const TEXT_3 = "var(--vn-text-3, #94a3b8)";
const BORDER = "var(--vn-border, rgba(255,255,255,0.08))";

const card: CSSProperties = {
  background: "var(--vn-surface, rgba(255,255,255,0.02))",
  border: `1px solid ${BORDER}`,
  borderRadius: "0.5rem",
  padding: "0.875rem 1rem",
  display: "flex",
  flexDirection: "column",
  gap: "0.625rem",
};
const heading: CSSProperties = { fontSize: "0.8125rem", fontWeight: 600, margin: 0, color: TEXT_2 };
const spread: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" };
const label: CSSProperties = { fontSize: "0.75rem", color: TEXT_3 };
const value: CSSProperties = { fontSize: "0.8125rem", fontWeight: 600, fontVariantNumeric: "tabular-nums" };

const STATE_TONES: Record<string, { color: string; label: string }> = {
  off: { color: MUTED, label: "Off" },
  init: { color: WARN, label: "Initializing" },
  converging: { color: WARN, label: "Converging" },
  converged: { color: OK, label: "Converged" },
  degraded: { color: WARN, label: "Degraded" },
  failed: { color: ERROR, label: "Failed" },
};
const COMPANION_TONES: Record<VisionNavHealth["companionState"], { color: string; label: string }> = {
  active: { color: OK, label: "Active" },
  critical: { color: ERROR, label: "Critical" },
  terminating: { color: ERROR, label: "Terminating" },
  inactive: { color: MUTED, label: "Offline" },
};
const MODES: ReadonlyArray<{ id: string; label: string; needs: string }> = [
  { id: "off", label: "Off", needs: "No hardware required." },
  { id: "optical_flow", label: "Optical Flow", needs: "Downward USB or CSI camera and a rangefinder." },
  { id: "optical_flow_degraded", label: "Optical Flow (degraded)", needs: "Downward camera. No rangefinder required." },
  { id: "external_nav", label: "External Navigation", needs: "A plugin publishing the shared pose topic, and an EKF origin." },
];
const ENGINE_LABELS: Record<string, string> = {
  off: "—",
  optical_flow: "Lucas-Kanade",
  optical_flow_degraded: "Lucas-Kanade (degraded)",
  external_nav: "External pose (ODOMETRY)",
};
/** Symbol plus word for each tracking health, so colour is never the only cue. */
const EXTNAV_HEALTH: Record<VisionNavExtnavHealth, { symbol: string; word: string; color: string }> = {
  good: { symbol: "●", word: "Good", color: OK },
  degraded: { symbol: "◐", word: "Degraded", color: WARN },
  lost: { symbol: "✕", word: "Lost", color: ERROR },
};
/** GPS_FIX_TYPE words. */
const FIX_WORDS = ["No GPS", "No fix", "2D fix", "3D fix", "DGPS", "RTK float", "RTK fixed"];
/** The ArduPilot parameter groups the extension's read-only card lists. */
const ARDUPILOT_PARAMS: ReadonlyArray<{ title: string; rows: ReadonlyArray<[string, string]> }> = [
  { title: "Sensor drivers", rows: [["FLOW_TYPE", "Optical flow sensor backend (5 = MAVLink)."]] },
  {
    title: "EKF source sets",
    rows: [
      ["EK3_SRC1_POSXY", "Source set 1 horizontal position."],
      ["EK3_SRC1_VELXY", "Source set 1 horizontal velocity."],
      ["EK3_SRC2_POSXY", "Source set 2 horizontal position."],
      ["EK3_SRC2_VELXY", "Source set 2 horizontal velocity."],
      ["EK3_SRC3_POSXY", "Source set 3 horizontal position."],
      ["EK3_SRC3_VELXY", "Source set 3 horizontal velocity."],
      ["EK3_SRC_OPTIONS", "Source-set switching options bitmask."],
    ],
  },
  {
    title: "Flow tuning",
    rows: [
      ["EK3_FLOW_DELAY", "Optical flow measurement delay (ms)."],
      ["EK3_FLOW_QUAL_MIN", "Minimum flow quality (0-255)."],
      ["FLOW_HEIGHT_MIN", "Minimum AGL for flow fusion (m)."],
      ["FLOW_HEIGHT_MAX", "Maximum AGL for flow fusion (m)."],
    ],
  },
];
const CHECK_TITLES: Record<string, string> = {
  companion_active: "Companion process active",
  flow_quality: "Optical flow quality",
  rangefinder: "Rangefinder healthy",
  scale_source: "Altitude scale source",
};
const SEVERITY: Record<VisionNavCheckSeverity, { color: string; icon: string }> = {
  ok: { color: OK, icon: "✓" },
  pending: { color: WARN, icon: "…" },
  blocking: { color: ERROR, icon: "✕" },
};

function Pill({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem", padding: "0.2rem 0.5rem", borderRadius: 999, border: `1px solid ${color}`, color, fontSize: "0.7rem", fontWeight: 600 }}>
      {children}
    </span>
  );
}

function StatePill({ state, tr }: { state: string; tr: Translate }) {
  const tone = STATE_TONES[state] ?? STATE_TONES.off;
  return (
    <Pill color={tone.color}>
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: tone.color }} />
      {tr(`navigation.estimatorState.${state}`, tone.label)}
    </Pill>
  );
}

function Row({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div style={{ ...spread, padding: "0.25rem 0", borderBottom: "1px solid var(--vn-border, rgba(255,255,255,0.04))" }}>
      <span style={label}>{name}</span>
      <span style={value}>{children}</span>
    </div>
  );
}

function SensorRow({ name, sub, children }: { name: string; sub: string; children: ReactNode }) {
  return (
    <div style={spread}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <span style={{ fontSize: "0.8125rem" }}>{name}</span>
        <span style={{ ...label, fontFamily: "ui-monospace, monospace" }}>{sub}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>{children}</div>
    </div>
  );
}

const num = (v: number | null, digits: number, unit: string) =>
  v === null ? "—" : `${v.toFixed(digits)}${unit}`;

function syncTone(offset: number | null, tr: Translate): { color: string; label: string } {
  if (offset === null) return { color: MUTED, label: tr("navigation.syncBand.unknown", "—") };
  const abs = Math.abs(offset);
  if (abs <= 10) return { color: OK, label: tr("navigation.syncBand.green", "Sync ≤10 ms") };
  if (abs <= 30) return { color: WARN, label: tr("navigation.syncBand.yellow", "Sync ≤30 ms") };
  return { color: ERROR, label: tr("navigation.syncBand.red", "Sync >30 ms") };
}

/** The extension's fallback banner: hidden while the estimator is healthy;
 * on a degraded or failed estimator it names the first likely cause and a
 * next action, in the extension's order. */
function FallbackBanner({ health, tr }: { health: VisionNavHealth; tr: Translate }) {
  const state = health.estimatorState;
  if (state !== "degraded" && state !== "failed") return null;
  const failed = state === "failed";
  const drift = health.cameraImuSyncOffsetMs !== null && Math.abs(health.cameraImuSyncOffsetMs) > 30;
  const lowQuality = health.flowQuality !== null && health.flowQuality < 50;
  const reason =
    health.flowScaleSource === "static"
      ? tr("navigation.fallback.reasonStaticScale", "No live altitude source; the flow scale is a fixed 1.5 m estimate.")
      : lowQuality
        ? tr("navigation.fallback.reasonLowQuality", "Optical-flow quality dropped below the safe gate.")
        : drift
          ? tr("navigation.fallback.reasonSyncDrift", "Camera-IMU time sync drifted beyond 30 ms.")
          : health.flowScaleSource === null
            ? tr("navigation.fallback.reasonNoScale", "No altitude or depth source is healthy for OF scaling.")
            : tr("navigation.fallback.reasonGeneric", "Estimator inputs are below the safe operating envelope.");
  const suggestion =
    health.flowScaleSource === null || health.flowScaleSource === "static"
      ? tr("navigation.fallback.suggestionLand", "Land, or switch the flight controller back to GPS with your RC source-set switch.")
      : drift
        ? tr("navigation.fallback.suggestionRecalibrate", "Re-run the camera-IMU calibration before the next flight.")
        : lowQuality
          ? tr("navigation.fallback.suggestionSlowYaw", "Slow yaw rate and fly over a more textured surface.")
          : tr("navigation.fallback.suggestionWatch", "Watch closely and prepare to hand back to manual.");
  const tone = failed ? ERROR : WARN;
  return (
    <section role="alert" data-testid={`vn-fallback-banner-${state}`} style={{ display: "flex", gap: "0.75rem", padding: "0.625rem 0.875rem", borderRadius: "0.5rem", border: `1px solid ${tone}` }}>
      <span aria-hidden style={{ color: tone, fontWeight: 700 }}>{failed ? "✕" : "!"}</span>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        <span style={{ fontSize: "0.8125rem", fontWeight: 600 }}>
          {failed ? tr("navigation.fallback.failedTitle", "Vision estimator failed") : tr("navigation.fallback.degradedTitle", "Vision estimator degraded")}
        </span>
        <span style={label}>{reason} {suggestion}</span>
      </div>
    </section>
  );
}

/** The extension's Navigation feed card, read from `nav.state` and the
 * `navigation.poseAgeMs` field. */
function NavStateCard({ state, poseAgeMs, tr }: { state: VisionNavState; poseAgeMs: number | null; tr: Translate }) {
  const health = state.extnav_health ? EXTNAV_HEALTH[state.extnav_health] : null;
  const rows: ReadonlyArray<{ id: string; key: string; fallback: string; text: string; color?: string }> = [
    { id: "active-set", key: "activeSet", fallback: "EKF source set", text: state.active_set === null ? "—" : `${state.active_set}` },
    {
      id: "extnav-health",
      key: "extnavHealth",
      fallback: "External nav",
      text: health && state.extnav_health ? `${health.symbol} ${tr(`navigation.navState.health.${state.extnav_health}`, health.word)}` : "—",
      color: health?.color,
    },
    { id: "odom-rate", key: "odomRate", fallback: "ODOMETRY rate", text: num(state.odom_rate_hz, 1, " Hz") },
    { id: "pose-age", key: "poseAge", fallback: "Pose age", text: poseAgeMs === null ? "—" : `${Math.round(poseAgeMs)} ms` },
    { id: "reset-counter", key: "resetCounter", fallback: "Pose resets", text: state.last_reset_counter === null ? "—" : `${state.last_reset_counter}` },
    { id: "obstacle-rate", key: "obstacleRate", fallback: "Obstacle feed", text: num(state.obstacle_rate_hz, 1, " Hz") },
    { id: "min-obstacle", key: "minObstacle", fallback: "Nearest obstacle", text: num(state.min_obstacle_m, 2, " m") },
    { id: "gps-fix", key: "gpsFix", fallback: "GPS", text: FIX_WORDS[state.gps_fix] ?? `Fix ${state.gps_fix}` },
  ];
  return (
    <section style={card} data-testid="vn-nav-state">
      <h3 style={heading}>{tr("navigation.navState.title", "Navigation feed")}</h3>
      {rows.map((r) => (
        <div style={spread} key={r.id}>
          <span style={label}>{tr(`navigation.navState.${r.key}`, r.fallback)}</span>
          <span style={r.color ? { ...value, color: r.color } : value} data-testid={`vn-nav-${r.id}`}>{r.text}</span>
        </div>
      ))}
    </section>
  );
}

function VisionNavDemoPanel({ host }: { host: InlineHostApi }) {
  const [health, setHealth] = useState(getMockVisionNavHealth);
  const navState = getMockVisionNavState();
  const [themeVars, setThemeVars] = useState<Record<string, string>>({});
  const [tourReplay, setTourReplay] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setHealth(getMockVisionNavHealth()), VISION_NAV_REFRESH_MS);
    const offTheme = host.ctx.theme.onChange(setThemeVars);
    return () => {
      clearInterval(timer);
      offTheme();
    };
  }, [host]);

  const tr: Translate = (key, fallback) => {
    const out = host.ctx.i18n.t(key);
    return out === key ? fallback : out;
  };
  const companion = COMPANION_TONES[health.companionState];
  const quality = health.flowQuality;
  const qualityColor = quality === null ? MUTED : quality < 50 ? ERROR : quality < 150 ? WARN : OK;
  const report = health.preArmReport;
  const sync = syncTone(health.cameraImuSyncOffsetMs, tr);
  const topology = health.rangefinderTopology;

  return (
    <div
      data-testid="vn-navigation-tab"
      style={{ position: "relative", display: "flex", flexDirection: "column", gap: "0.75rem", padding: "0.875rem", background: "var(--vn-bg, #0A0A0A)", color: "var(--vn-text, #EDEDED)", minHeight: "100%", boxSizing: "border-box", ...(themeVars as CSSProperties) }}
    >
      <header style={spread}>
        <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>{tr("navigation.tabTitle", "Vision Nav")}</h2>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <button
            type="button"
            onClick={() => setTourReplay(true)}
            data-testid="vn-tour-replay"
            style={{ background: "transparent", border: "none", color: "var(--vn-text-muted, #94a3b8)", fontSize: "0.7rem", cursor: "pointer", padding: 0, textDecoration: "underline" }}
          >
            {tr("navigation.tour.replay", "Replay tour")}
          </button>
          <span data-testid="vn-companion-pill" style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", padding: "0.25rem 0.75rem", borderRadius: 9999, border: `1px solid ${BORDER}`, fontSize: "0.8125rem" }}>
            <span aria-hidden style={{ width: 8, height: 8, borderRadius: 9999, background: companion.color }} />
            Companion: {companion.label}
          </span>
        </div>
      </header>

      <TourOrchestrator replay={tourReplay} onClose={() => setTourReplay(false)} tr={tr} />

      <FallbackBanner health={health} tr={tr} />

      <section style={card} data-testid="vn-mode-card">
        <header style={spread}>
          <h3 style={heading}>{tr("navigation.modeCard.title", "Mode")}</h3>
          <StatePill state={health.estimatorState} tr={tr} />
        </header>
        <p style={{ ...label, margin: 0 }}>
          {tr("navigation.modeCard.subhead", "The estimator the plugin feeds to the flight controller. Set `mode` in the plugin's per-drone configuration to change it.")}
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))", gap: "0.5rem" }}>
          {MODES.filter((m) => health.availableEstimators.includes(m.id)).map((m) => {
            const selected = m.id === health.mode;
            return (
              <div key={m.id} aria-current={selected ? "true" : undefined} style={{ borderRadius: "0.375rem", padding: "0.5rem 0.625rem", border: `1px solid ${selected ? OK : BORDER}`, background: selected ? "rgba(52,211,153,0.08)" : "transparent" }}>
                <div style={{ fontSize: "0.8125rem", fontWeight: 600 }}>{m.label}</div>
                <div style={label}>{m.needs}</div>
              </div>
            );
          })}
        </div>
      </section>

      <NavStateCard state={navState} poseAgeMs={health.poseAgeMs} tr={tr} />

      <section style={card} data-testid="vn-sensors-card">
        <h3 style={heading}>{tr("navigation.sensorsCard.title", "Sensors")}</h3>
        <SensorRow name={tr("navigation.sensorsCard.camera", "Camera")} sub={health.recommendedCameraId ?? "—"}>
          <Pill color={health.cameraIntrinsicsLoaded ? OK : WARN}>
            {health.cameraIntrinsicsLoaded ? tr("navigation.sensorsCard.calibrated", "Calibrated") : tr("navigation.sensorsCard.notCalibrated", "Not calibrated")}
          </Pill>
        </SensorRow>
        <SensorRow name={tr("navigation.sensorsCard.imu", "IMU")} sub={health.imuSource ?? "—"}>
          <span style={label}>{tr("navigation.sensorsCard.rate", "Rate")} <span style={value}>{health.imuRateHz === null ? "—" : `${Math.round(health.imuRateHz)} Hz`}</span></span>
          <Pill color={sync.color}>{sync.label}</Pill>
        </SensorRow>
        <SensorRow
          name={tr("navigation.sensorsCard.rangefinder", "Rangefinder")}
          sub={health.flowScaleSource ? tr(`navigation.scaleSource.${health.flowScaleSource}`, health.flowScaleSource) : tr("navigation.sensorsCard.noScale", "No scale source")}
        >
          <span style={label}>{tr("navigation.sensorsCard.distance", "Distance")} <span style={value}>{num(health.flowDistanceM, 2, " m")}</span></span>
          <Pill color={topology === null ? MUTED : OK}>
            {topology === null ? tr("navigation.sensorsCard.absent", "Absent") : topology === "companion" ? "Companion" : topology === "fc" ? "FC" : "Both"}
          </Pill>
        </SensorRow>
      </section>

      <section style={card} data-testid="vn-estimator-card">
        <header style={spread}>
          <h3 style={heading}>{tr("navigation.estimatorCard.title", "Estimator")}</h3>
          <StatePill state={health.estimatorState} tr={tr} />
        </header>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem 1rem" }}>
          <Row name={tr("navigation.estimatorCard.engine", "Engine")}>{ENGINE_LABELS[health.mode ?? "off"] ?? "—"}</Row>
          <Row name={tr("navigation.estimatorCard.flowQuality", "Flow quality")}>{quality === null ? "—" : `${quality}/255`}</Row>
          <Row name={tr("navigation.estimatorCard.syncOffset", "Sync offset")}>{num(health.cameraImuSyncOffsetMs, 1, " ms")}</Row>
        </div>
      </section>

      <TelemetryCharts health={health} tr={tr} />

      <section style={card} data-testid="vn-flow-health">
        <h3 style={heading}>Flow health</h3>
        <div>
          <div style={spread}><span style={label}>Flow quality</span><span style={value}>{quality === null ? "—" : `${quality}/255`}</span></div>
          <div role="progressbar" aria-valuemin={0} aria-valuemax={255} aria-valuenow={quality ?? 0} style={{ height: "0.5rem", marginTop: "0.25rem", background: "var(--vn-surface-2, rgba(255,255,255,0.06))", borderRadius: 9999, overflow: "hidden" }}>
            <div style={{ width: `${quality === null ? 0 : Math.min(100, (quality / 255) * 100)}%`, height: "100%", background: qualityColor, transition: "width 200ms linear" }} />
          </div>
        </div>
        <div style={spread}><span style={label}>Flow rate</span><span style={value}>{num(health.flowRateHz, 1, " Hz")}</span></div>
        <div style={spread}><span style={label}>Flow distance</span><span style={value}>{num(health.flowDistanceM, 2, " m")}</span></div>
      </section>

      <section style={card} data-testid="vn-pre-arm">
        <header style={spread}>
          <h3 style={heading}>Pre-arm</h3>
          <Pill color={report?.armable ? OK : ERROR}>{report?.armable ? "Ready" : "Blocked"}</Pill>
        </header>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "0.375rem" }}>
          {(report?.checks ?? []).map((check) => (
            <li key={check.id} data-check-id={check.id} data-state={check.severity} style={{ display: "flex", flexDirection: "column", gap: "0.125rem", fontSize: "0.8125rem" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span aria-hidden style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 14, height: 14, borderRadius: 9999, background: SEVERITY[check.severity].color, color: "#0A0A0A", fontSize: "0.625rem", fontWeight: 700 }}>
                  {SEVERITY[check.severity].icon}
                </span>
                {CHECK_TITLES[check.id] ?? check.id}
              </span>
              {check.detail ? <span style={{ ...label, marginLeft: "1.25rem" }}>{check.detail}</span> : null}
            </li>
          ))}
        </ul>
      </section>

      <section style={card} data-testid="vn-ardupilot-params">
        <h3 style={heading}>ArduPilot vision parameters</h3>
        <p style={{ ...label, margin: 0 }}>Read-only summary. Edit in Mission Control&apos;s parameter editor.</p>
        {ARDUPILOT_PARAMS.map((group) => (
          <div key={group.title}>
            <p style={{ ...label, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 0.375rem 0" }}>{group.title}</p>
            <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", columnGap: "0.875rem", rowGap: "0.25rem", fontSize: "0.8125rem", margin: 0 }}>
              {group.rows.map(([id, description]) => (
                <div key={id} style={{ display: "contents" }}>
                  <dt style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>{id}</dt>
                  <dd style={{ ...label, margin: 0 }}>{description}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </section>
    </div>
  );
}

/** Render the demo panel under the inline host's root; the returned disposer
 * unmounts it. Each mount gets its own container, because the host may start a
 * second mount (a remount, or React's development double-run) before the
 * first one's disposer has run. The host calls the disposer from its own
 * effect cleanup, while React is committing, so the nested root unmounts on
 * the next microtask. */
export function mountVisionNavDemoPanel(root: HTMLElement, host: InlineHostApi): () => void {
  const container = document.createElement("div");
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.flex = "1 1 auto";
  root.append(container);
  const reactRoot = createRoot(container);
  reactRoot.render(<VisionNavDemoPanel host={host} />);
  return () =>
    queueMicrotask(() => {
      reactRoot.unmount();
      container.remove();
    });
}
