/**
 * @module mock/capture-monitor-demo
 * @description The demo rendition of the Capture extension's Live view: a
 * capture-session header with its state, the capture controls (inert in
 * demo), the Capture and Stream cards fed by demo values, and the
 * Reconstruction section, which holds a placeholder because the demo runs no
 * reconstruction. The live map is on the drone's Map tab, as it is on a real
 * node.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

import { DEMO_WORKSTATION } from "./drones";

type Translate = (key: string, fallback: string) => string;

/** The session the demo map stream reports (`mock-nav` `map_status`). */
export const DEMO_CAPTURE_SESSION_ID = "demo-session";
const KEYFRAMES_AT_MOUNT = 412;
const INGEST_HZ = 1.5;
const CAMERA_COUNT = 2;

const box: CSSProperties = {
  border: "1px solid var(--alt-border-default)",
  borderRadius: "0.5rem",
  padding: "0.75rem",
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
};
const label: CSSProperties = { fontSize: "0.75rem", fontWeight: 500, color: "var(--alt-text-secondary)" };
const muted: CSSProperties = { fontSize: "0.6875rem", color: "var(--alt-text-tertiary)", margin: 0 };
const mono: CSSProperties = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontVariantNumeric: "tabular-nums" };
const button: CSSProperties = {
  fontSize: "0.75rem",
  padding: "0.25rem 0.625rem",
  borderRadius: "0.25rem",
  border: "1px solid var(--alt-border-default)",
  background: "transparent",
  color: "var(--alt-text-secondary)",
  opacity: 0.5,
  cursor: "not-allowed",
};

function Stat({ name, value }: { name: string; value: string }) {
  return (
    <div style={{ textAlign: "center", padding: "0.375rem 0.5rem", borderRadius: "0.25rem", background: "var(--alt-bg-secondary)" }}>
      <div style={{ ...mono, fontSize: "0.875rem", color: "var(--alt-text-primary)" }}>{value}</div>
      <div style={{ fontSize: "0.5625rem", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--alt-text-tertiary)" }}>{name}</div>
    </div>
  );
}

function Row({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.6875rem" }}>
      <span style={{ color: "var(--alt-text-tertiary)" }}>{name}</span>
      <span style={{ ...mono, color: "var(--alt-text-secondary)" }}>{children}</span>
    </div>
  );
}

/** Seconds since mount, ticking once a second. */
function useElapsedSeconds(): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  return elapsed;
}

export function CaptureMonitorDemo({ tr }: { tr: Translate }) {
  const elapsed = useElapsedSeconds();
  const keyframes = KEYFRAMES_AT_MOUNT + Math.floor(elapsed * INGEST_HZ);
  const controlsBlocked = tr(
    "capture.notLocalReason",
    "Connect to this drone over your local network to control capture",
  );
  const controls: [string, string][] = [
    ["capture.pauseCapture", "Pause"],
    ["capture.stopCapture", "Stop & reconstruct"],
    ["capture.reconstructNow", "Reconstruct now"],
  ];

  return (
    <div
      data-testid="capture-demo"
      style={{ display: "flex", flexDirection: "column", gap: "1rem", padding: "1rem", color: "var(--alt-text-primary)", background: "var(--alt-bg-primary)", minHeight: "100%", boxSizing: "border-box" }}
    >
      <div style={{ ...box, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>{tr("capture.title", "Capture")}</span>
          <span data-testid="capture-state" style={{ fontSize: "0.625rem", fontWeight: 500, padding: "0.125rem 0.375rem", borderRadius: "0.25rem", color: "var(--alt-status-success)" }}>
            capturing
          </span>
          <span style={{ fontSize: "0.625rem", color: "var(--alt-status-warning)" }}>{tr("capture.demoBadge", "Demo data")}</span>
        </div>
        <span style={{ ...mono, fontSize: "0.625rem", color: "var(--alt-text-tertiary)" }}>{DEMO_CAPTURE_SESSION_ID}</span>
      </div>

      <div style={box} data-testid="capture-controls">
        <span style={label}>{tr("capture.captureControlsTitle", "Capture")}</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          {controls.map(([key, fallback]) => (
            <button key={key} type="button" disabled title={controlsBlocked} style={button}>
              {tr(key, fallback)}
            </button>
          ))}
        </div>
        <p style={muted}>{controlsBlocked}</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(14rem, 1fr))", gap: "1rem" }}>
        <div style={box} data-testid="capture-capture">
          <span style={label}>{tr("capture.captureSection", "Capture")}</span>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
            <Stat name={tr("capture.statKeyframes", "Keyframes")} value={String(keyframes)} />
            <Stat name={tr("capture.statIngestHz", "Ingest Hz")} value={INGEST_HZ.toFixed(1)} />
            <Stat name={tr("capture.statCameras", "Cameras")} value={String(CAMERA_COUNT)} />
          </div>
          <Row name={tr("capture.vioTracking", "VIO tracking")}>good</Row>
        </div>
        <div style={box} data-testid="capture-stream">
          <span style={label}>{tr("capture.streamSection", "Stream")}</span>
          <Row name={tr("capture.computeNode", "Compute node")}>{DEMO_WORKSTATION.deviceId}</Row>
          <Row name={tr("capture.bearer", "Bearer")}>{tr("capture.bearerDirectLan", "Direct LAN")}</Row>
          <Row name={tr("capture.lastKeyframe", "Last keyframe")}>{`${elapsed % 2}s`}</Row>
        </div>
      </div>

      <div style={box} data-testid="capture-reconstruction">
        <span style={label}>{tr("capture.reconstructionSection", "Reconstruction")}</span>
        <p style={{ ...muted, textAlign: "center", padding: "2rem 1rem" }}>
          {tr(
            "capture.demoReconstruction",
            "The demo runs no reconstruction, so no model is shown here. The live map of this session is on the drone's Map tab.",
          )}
        </p>
      </div>
    </div>
  );
}
