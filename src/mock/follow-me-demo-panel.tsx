/**
 * @module mock/follow-me-demo-panel
 * @description The demo rendition of the Follow-Me extension's node tab: the
 * About (specs) section and the Live read-back, laid out and labelled as the
 * extension's own GCS tab renders them. The read-back is
 * {@link demoFollowReadback} over the demo follow feed and demo pilot for the
 * mounted drone, re-derived as the inputs change and as they age. While the
 * tab is open it runs the demo feed, unless the cockpit already does. Copy
 * resolves through the host's plugin i18n, then the extension's published
 * English bundle. Mounted by `DEMO_FOLLOW_ME_MODULE` inside the inline plugin
 * host.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";

import { nodeIdForDevice } from "@/lib/agent/node-id";
import type { InlineHostApi } from "@/lib/plugins/inline-host-types";
import { pluginConfigKey, usePluginConfigCache } from "@/lib/plugins/config-cache";
import { defaultFor } from "@/lib/plugins/parameters/schema";
import { FOLLOW_STALE_MS, freshData, useNavStreamStore } from "@/stores/nav-stream-store";
import { demoExtensionLocale } from "./extension-locales";
import { demoReleaseManifest, FOLLOW_ME } from "./extension-manifests";
import { mockDetectionStream } from "./mock-detections";
import {
  demoFollowReadback,
  FOLLOW_ME_REFRESH_MS,
  type FollowMeHoldReason,
  type FollowMeLockState,
} from "./mock-follow-me";

type Translate = (key: string) => string;

const manifest = demoReleaseManifest(FOLLOW_ME);
const PARAM_DEFAULTS: Readonly<Record<string, string | number | boolean>> = Object.fromEntries(
  (manifest.contributesParameters ?? []).map((p) => [p.key, defaultFor(p.schema)]),
);
const BUNDLE = demoExtensionLocale(manifest.pluginId);

const MUTED = "var(--fm-text-muted, #94a3b8)";
const card: CSSProperties = {
  background: "var(--fm-surface, rgba(255,255,255,0.03))",
  border: "1px solid var(--fm-border, rgba(255,255,255,0.08))",
  borderRadius: "0.5rem",
  padding: "0.75rem 0.875rem",
};
const sectionTitle: CSSProperties = {
  margin: "0 0 0.5rem 0",
  fontSize: "0.75rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: MUTED,
};
const labelRow: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "0.75rem",
  fontSize: "0.8125rem",
  padding: "0.25rem 0",
};

/** Green locked, amber uncertain, red lost, neutral without a lock. */
const LOCK_COLORS: Record<FollowMeLockState | "none", string> = {
  locked: "var(--fm-success, #22c55e)",
  uncertain: "var(--fm-warning, #f59e0b)",
  lost: "var(--fm-error, #ef4444)",
  none: "var(--fm-tertiary, #94a3b8)",
};

/** Hold reasons that mean an input stopped arriving, not a normal pre-flight state. */
const STALE_HOLDS: Partial<Record<FollowMeHoldReason, true>> = { "pose-stale": true, "fc-stale": true };

const fmtMeters = (v: number | null): string => (v === null || !Number.isFinite(v) ? "—" : `${v.toFixed(1)} m`);

function Row({ name, value, testId }: { name: string; value: string; testId?: string }) {
  return (
    <div style={labelRow}>
      <span style={{ color: MUTED }}>{name}</span>
      <span style={testId ? { fontFamily: "monospace" } : undefined} data-testid={testId}>
        {value}
      </span>
    </div>
  );
}

function numberSetting(values: Record<string, unknown> | undefined, key: string): number {
  const v = values?.[key];
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : Number(PARAM_DEFAULTS[key]);
}

function FollowMeDemoPanel({ host }: { host: InlineHostApi }) {
  const deviceId = host.node.deviceId;
  const droneId = deviceId ? nodeIdForDevice(deviceId) : null;
  const feed = useNavStreamStore((s) => (droneId ? s.byDrone[droneId] : undefined));
  const settings = usePluginConfigCache((s) =>
    deviceId ? s.values[pluginConfigKey(deviceId, manifest.pluginId)] : undefined,
  );
  const [now, setNow] = useState(() => Date.now());
  const [themeVars, setThemeVars] = useState<Record<string, string>>({});

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), FOLLOW_ME_REFRESH_MS);
    const offTheme = host.ctx.theme.onChange(setThemeVars);
    return () => {
      clearInterval(timer);
      offTheme();
    };
  }, [host]);

  // Run the demo feed while the tab is open, unless the cockpit already runs
  // it; stop it again only if this tab started it.
  useEffect(() => {
    if (!droneId) return;
    const startedHere = !mockDetectionStream.isRunning();
    if (startedHere) mockDetectionStream.start(droneId);
    return () => {
      if (startedHere) mockDetectionStream.stop();
    };
  }, [droneId]);

  const t: Translate = (key) => {
    const out = host.ctx.i18n.t(key);
    return out === key ? (BUNDLE[key] ?? key) : out;
  };
  const follow = freshData(feed?.follow, now, FOLLOW_STALE_MS);
  const readback = demoFollowReadback({
    follow,
    pilot: feed?.pilot ? { state: feed.pilot.data, ageMs: now - feed.pilot.receivedAt } : null,
    distanceM: numberSetting(settings, "follow_distance_m"),
    heightM: numberSetting(settings, "follow_height_m"),
  });
  const camera = settings?.designate_camera;
  const lockColor = LOCK_COLORS[readback.lock_state ?? "none"];
  const yesNo = (v: boolean) => (v ? t("metrics.yes") : t("metrics.no"));
  const hold = readback.hold_reason;

  return (
    <div
      data-testid="fm-tab"
      style={{ display: "flex", flexDirection: "column", gap: "0.75rem", padding: "0.875rem", background: "var(--fm-bg, #0b1220)", color: "var(--fm-text, #e5e7eb)", minHeight: "100%", boxSizing: "border-box", ...(themeVars as CSSProperties) }}
    >
      <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>{t("tab.title")}</h2>

      <section style={card} data-testid="fm-specs">
        <h3 style={sectionTitle}>{t("specs.title")}</h3>
        <Row name={t("specs.detector")} value={t("specs.detectorValue")} />
        <Row name={t("specs.camera")} value={typeof camera === "string" && camera ? camera : String(PARAM_DEFAULTS.designate_camera)} />
        <Row name={t("specs.fcMode")} value={t("specs.fcModeValue")} />
        <Row name={t("specs.resource")} value={t("specs.resourceValue")} />
        <p style={{ margin: "0.4rem 0 0", fontSize: "0.7rem", color: MUTED }} data-testid="fm-settings-hint">
          {t("specs.settingsHint")}
        </p>
      </section>

      <section style={card} data-testid="fm-metrics">
        <h3 style={sectionTitle}>{t("metrics.title")}</h3>
        <div style={labelRow}>
          <span>{t("metrics.lockState")}</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", color: lockColor }} data-testid="fm-lock-state">
            <span style={{ width: "0.55rem", height: "0.55rem", borderRadius: "999px", background: lockColor }} />
            {readback.lock_state ? t(`lock.${readback.lock_state}`) : t("lock.none")}
          </span>
        </div>
        <Row name={t("metrics.commanding")} value={yesNo(readback.commanding)} testId="fm-commanding" />
        {/* "Not commanding" alone reads the same disarmed on the ground as
            with telemetry gone mid-follow: name the gate, faults in red. */}
        {!readback.commanding && hold !== null ? (
          <div style={labelRow} data-testid="fm-hold-reason-row">
            <span>{t("metrics.holdReason")}</span>
            <span style={{ color: STALE_HOLDS[hold] ? "var(--fm-error, #ef4444)" : MUTED }} data-testid="fm-hold-reason">
              {t(`hold.${hold.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())}`)}
            </span>
          </div>
        ) : null}
        <Row name={t("metrics.fcArmed")} value={yesNo(readback.fc_armed)} testId="fm-fc-armed" />
        <Row name={t("metrics.guidedMode")} value={yesNo(readback.fc_guided)} testId="fm-fc-guided" />
        <Row name={t("metrics.targetId")} value={readback.target_id !== null ? `#${readback.target_id}` : "—"} testId="fm-target-id" />
        <Row name={t("metrics.range")} value={fmtMeters(readback.range_m)} testId="fm-range" />
        <Row name={t("metrics.distanceSetpoint")} value={fmtMeters(readback.distance_setpoint_m)} testId="fm-distance-setpoint" />
        <Row name={t("metrics.heightSetpoint")} value={fmtMeters(readback.height_setpoint_m)} testId="fm-height-setpoint" />
      </section>
    </div>
  );
}

/** Render the demo tab under the inline host's root; the returned disposer
 * unmounts it on the next microtask (the host calls it while React commits). */
export function mountFollowMeDemoPanel(root: HTMLElement, host: InlineHostApi): () => void {
  const container = document.createElement("div");
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.flex = "1 1 auto";
  root.append(container);
  const reactRoot = createRoot(container);
  reactRoot.render(<FollowMeDemoPanel host={host} />);
  return () =>
    queueMicrotask(() => {
      reactRoot.unmount();
      container.remove();
    });
}
