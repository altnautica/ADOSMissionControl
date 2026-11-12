/**
 * @module mock/vision-nav-demo-tour
 * @description The Vision Navigation extension's telemetry trend charts and
 * first-run guided tour, as its GCS tab renders them, for the demo stand-in
 * in `vision-nav-demo-panel`. The charts keep a one-minute rolling history of
 * flow quality and the camera-IMU sync offset from each health refresh. The
 * tour walks the five cards in the extension's order, opens on the first
 * visit, and reopens from the header's "Replay tour" link.
 *
 * The extension's iframe pins its tour overlay to the iframe viewport. The
 * demo panel renders inline in the app, so the overlay is scoped to the tab
 * body instead of covering the whole window.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useState, type CSSProperties } from "react";

import type { VisionNavHealth } from "./mock-vision-nav";

export type Translate = (key: string, fallback: string) => string;

/** One minute of history at the panel's 1 Hz refresh. */
export const CHART_BUFFER_LIMIT = 60;

/** Records that the operator finished or skipped the tour once. */
export const TOUR_PERSIST_KEY = "vision-nav-tour-seen";

interface TourStepSpec {
  id: string;
  targetTestId: string;
  titleKey: string;
  titleFallback: string;
  bodyKey: string;
  bodyFallback: string;
}

/** The extension's five tour steps, in its order. */
export const TOUR_STEPS: ReadonlyArray<TourStepSpec> = [
  {
    id: "mode-card",
    targetTestId: "vn-mode-card",
    titleKey: "navigation.tour.modeTitle",
    titleFallback: "Navigation mode",
    bodyKey: "navigation.tour.modeBody",
    bodyFallback:
      "The modes the agent can run, with the active one marked. Set the mode in the plugin's per-drone settings.",
  },
  {
    id: "sensors-card",
    targetTestId: "vn-sensors-card",
    titleKey: "navigation.tour.sensorsTitle",
    titleFallback: "Sensor health",
    bodyKey: "navigation.tour.sensorsBody",
    bodyFallback:
      "Camera, IMU, and rangefinder health at a glance. The camera row shows whether the agent loaded a camera calibration (camchain.yaml in the plugin's data directory).",
  },
  {
    id: "estimator-card",
    targetTestId: "vn-estimator-card",
    titleKey: "navigation.tour.estimatorTitle",
    titleFallback: "Estimator state",
    bodyKey: "navigation.tour.estimatorBody",
    bodyFallback:
      "Live state of the active estimator. The pill shows init / converging / converged / degraded / failed.",
  },
  {
    id: "telemetry-charts",
    targetTestId: "vn-telemetry-charts",
    titleKey: "navigation.tour.chartsTitle",
    titleFallback: "Telemetry trends",
    bodyKey: "navigation.tour.chartsBody",
    bodyFallback:
      "Sixty seconds of rolling history. Watch the flow quality stay above the gate and the camera-IMU sync offset stay green.",
  },
  {
    id: "pre-arm",
    targetTestId: "vn-pre-arm",
    titleKey: "navigation.tour.preArmTitle",
    titleFallback: "Pre-arm checklist",
    bodyKey: "navigation.tour.preArmBody",
    bodyFallback:
      "Advisory arm-readiness for this mode. It does not stop the flight controller from arming; check every row is green before you arm.",
  },
];

const MUTED = "var(--vn-text-muted, #94a3b8)";
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
const heading: CSSProperties = { fontSize: "0.8125rem", fontWeight: 600, margin: 0, color: "var(--vn-text-2, #b4b4b4)" };
const labelRow: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between" };
const labelText: CSSProperties = { fontSize: "0.7rem", color: MUTED };
const valueText: CSSProperties = { fontSize: "0.75rem", fontWeight: 600, fontVariantNumeric: "tabular-nums" };

function pushAndCap(buf: number[], v: number): number[] {
  const next = buf.length >= CHART_BUFFER_LIMIT ? buf.slice(1) : buf.slice();
  next.push(v);
  return next;
}

function formatValue(v: number, unit: string): string {
  if (unit === "ms" || unit === "m") return v.toFixed(2);
  return Number.isInteger(v) ? v.toString() : v.toFixed(2);
}

interface Series {
  label: string;
  unit: string;
  values: number[];
  color: string;
  yMin: number;
  yMax: number;
}

function Sparkline({ label, unit, values, color, yMin, yMax, tr }: Series & { tr: Translate }) {
  const w = 180;
  const h = 36;
  const testId = `vn-sparkline-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  if (values.length < 2) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }} data-testid={testId}>
        <div style={labelRow}>
          <span style={labelText}>{label}</span>
          <span style={valueText}>{tr("navigation.charts.noData", "no data")}</span>
        </div>
        <svg width={w} height={h} style={{ display: "block" }} aria-hidden>
          <line x1={0} x2={w} y1={h / 2} y2={h / 2} stroke={BORDER} strokeDasharray="2 2" />
        </svg>
      </div>
    );
  }
  const span = Math.max(yMax - yMin, 1e-6);
  const points = values
    .map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - ((v - yMin) / span) * h).toFixed(1)}`)
    .join(" ");
  const last = values[values.length - 1];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }} data-testid={testId}>
      <div style={labelRow}>
        <span style={labelText}>{label}</span>
        <span style={valueText}>{`${formatValue(last, unit)} ${unit}`}</span>
      </div>
      <svg width={w} height={h} style={{ display: "block" }} aria-hidden>
        <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} />
      </svg>
    </div>
  );
}

/** The extension's "Telemetry trends" card: flow quality and the absolute
 * camera-IMU sync offset, one sample per health refresh. A null reading adds
 * no sample, and a series under two samples shows "no data". */
export function TelemetryCharts({ health, tr }: { health: VisionNavHealth; tr: Translate }) {
  // One sample per health report, taken when the report changes (the
  // adjust-state-during-render pattern, so no effect re-renders the card).
  const [history, setHistory] = useState<{ seen: VisionNavHealth | null; quality: number[]; sync: number[] }>({
    seen: null,
    quality: [],
    sync: [],
  });
  if (history.seen !== health) {
    setHistory({
      seen: health,
      quality: typeof health.flowQuality === "number" ? pushAndCap(history.quality, health.flowQuality) : history.quality,
      sync:
        typeof health.cameraImuSyncOffsetMs === "number"
          ? pushAndCap(history.sync, Math.abs(health.cameraImuSyncOffsetMs))
          : history.sync,
    });
  }
  const series: Series[] = [
    { label: tr("navigation.charts.flowQuality", "Flow quality"), unit: "/255", values: history.quality, color: "var(--vn-accent, #3a82ff)", yMin: 0, yMax: 255 },
    { label: tr("navigation.charts.syncOffset", "Sync offset"), unit: "ms", values: history.sync, color: "var(--vn-warn, #f59e0b)", yMin: 0, yMax: 40 },
  ];
  return (
    <section style={card} data-testid="vn-telemetry-charts">
      <h3 style={heading}>{tr("navigation.charts.title", "Telemetry trends")}</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.75rem" }}>
        {series.map((s) => (
          <Sparkline key={s.label} {...s} tr={tr} />
        ))}
      </div>
    </section>
  );
}

function tourSeen(): boolean {
  try {
    return window.localStorage.getItem(TOUR_PERSIST_KEY) === "true";
  } catch {
    // Storage refused (private mode): open the tour, as the extension does.
    return false;
  }
}

const btn: CSSProperties = { borderRadius: "0.375rem", cursor: "pointer", fontSize: "0.8125rem" };

/** The extension's tour: opens on the first visit or on `replay`, scrolls each
 * step's card into view, and records completion on Skip or Finish. */
export function TourOrchestrator({ replay, onClose, tr }: { replay: boolean; onClose: () => void; tr: Translate }) {
  // Opens on the first visit, and again whenever `replay` turns on.
  const [active, setActive] = useState(() => replay || !tourSeen());
  const [index, setIndex] = useState(0);
  const [lastReplay, setLastReplay] = useState(replay);
  if (replay !== lastReplay) {
    setLastReplay(replay);
    if (replay) {
      setIndex(0);
      setActive(true);
    } else if (!tourSeen()) {
      setActive(true);
    }
  }

  useEffect(() => {
    if (!active) return;
    const step = TOUR_STEPS[index];
    if (!step) return;
    const el = document.querySelector(`[data-testid="${step.targetTestId}"]`);
    if (el instanceof HTMLElement && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    }
  }, [active, index]);

  const close = useCallback(() => {
    try {
      window.localStorage.setItem(TOUR_PERSIST_KEY, "true");
    } catch {
      // Storage refused: the tour opens again next visit.
    }
    setActive(false);
    setIndex(0);
    onClose();
  }, [onClose]);

  if (!active) return null;
  const step = TOUR_STEPS[Math.min(index, TOUR_STEPS.length - 1)];
  const isLast = index >= TOUR_STEPS.length - 1;
  return (
    <div
      data-testid="vn-tour-overlay"
      style={{ position: "absolute", inset: 0, zIndex: 50, background: "rgba(0, 0, 0, 0.5)", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "1.5rem" }}
    >
      <div
        role="dialog"
        aria-label={tr(step.titleKey, step.titleFallback)}
        data-testid={`vn-tour-step-${step.id}`}
        style={{ position: "sticky", top: "1.5rem", maxWidth: "420px", width: "100%", background: "var(--vn-surface, #0a0a0a)", border: "1px solid var(--vn-border, rgba(255,255,255,0.12))", borderRadius: "0.5rem", padding: "1rem 1.125rem", color: "var(--vn-text, #ededed)", boxShadow: "0 10px 32px rgba(0, 0, 0, 0.4)", display: "flex", flexDirection: "column", gap: "0.625rem" }}
      >
        <header style={labelRow}>
          <span style={{ fontSize: "0.7rem", color: MUTED, fontWeight: 600 }}>
            {tr("navigation.tour.step", "Step")} {index + 1}/{TOUR_STEPS.length}
          </span>
          <button type="button" onClick={close} data-testid="vn-tour-skip" style={{ ...btn, padding: "0.25rem 0.5rem", background: "transparent", color: MUTED, border: `1px solid ${BORDER}`, fontSize: "0.7rem" }}>
            {tr("navigation.tour.skip", "Skip")}
          </button>
        </header>
        <h3 style={{ fontSize: "0.9375rem", fontWeight: 600, margin: 0 }}>{tr(step.titleKey, step.titleFallback)}</h3>
        <p style={{ fontSize: "0.8125rem", margin: 0, color: "var(--vn-text-2, #b4b4b4)", lineHeight: 1.45 }}>{tr(step.bodyKey, step.bodyFallback)}</p>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={isLast ? close : () => setIndex((n) => n + 1)}
            data-testid={isLast ? "vn-tour-finish" : "vn-tour-next"}
            style={{ ...btn, padding: "0.5rem 1rem", background: "var(--vn-accent, #3a82ff)", color: "white", border: "none", fontWeight: 600 }}
          >
            {isLast ? tr("navigation.tour.finish", "Finish") : tr("navigation.tour.next", "Next")}
          </button>
        </div>
      </div>
    </div>
  );
}
