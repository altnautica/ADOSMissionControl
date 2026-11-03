/**
 * @module mock/live-world-demo-panel
 * @description The demo rendition of the world-engine `live-world` Agent
 * page: the demo occupancy grid, SLAM trail and scan through the shared
 * local-frame map, and an orbiting point cloud of the synthetic room coloured
 * by height band. Every surface is labelled as demo data. Mounted by
 * `DEMO_LIVE_WORLD_MODULE` inside the inline plugin host, in its own React
 * root wrapped in the app's message bundle so the shared map's copy resolves.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useRef, type CSSProperties, type PointerEvent } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";

import { LocalFrameMap } from "@/components/map/local/LocalFrameMap";
import { loadLocaleMessages } from "@/components/layout/LocaleProvider";
import { nodeIdForDevice } from "@/lib/agent/node-id";
import type { InlineHostApi } from "@/lib/plugins/inline-host-types";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { useSettingsStore } from "@/stores/settings-store";
import { mockDetectionStream } from "./mock-detections";
import { CLOUD_BAND_M, CLOUD_HEIGHT_M, demoPointCloud, type CloudPoint } from "./mock-live-world";

type Translate = (key: string, fallback: string) => string;

const card: CSSProperties = {
  border: "1px solid var(--alt-border-default)",
  borderRadius: "0.5rem",
  padding: "0.75rem",
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
  background: "var(--alt-bg-secondary)",
};
const heading: CSSProperties = { fontSize: "0.8125rem", fontWeight: 600, margin: 0, color: "var(--alt-text-secondary)" };
const caption: CSSProperties = { fontSize: "0.75rem", color: "var(--alt-text-tertiary)", margin: 0 };
const pill: CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  padding: "0.125rem 0.5rem",
  borderRadius: 9999,
  border: "1px solid var(--alt-status-warning)",
  color: "var(--alt-status-warning)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

/** Height-band colour roles, low to high; the floor uses the muted role. */
const BAND_VARS = ["--hud-primary", "--hud-good", "--hud-lead", "--hud-warn"] as const;
const FLOOR_VAR = "--hud-muted";
const DRONE_VAR = "--hud-ink";
/** Auto-orbit rate while the operator is not dragging (rad/s). */
const ORBIT_RATE = 0.1;
const CAMERA_DISTANCE_M = 26;

interface Orbit {
  az: number;
  el: number;
}

/** Project a map point (x north, y east, z up) for an orbit camera. Returns
 * screen offsets in metres and a perspective scale. */
export function projectPoint(x: number, y: number, z: number, orbit: Orbit): { u: number; v: number; k: number } {
  const ca = Math.cos(orbit.az);
  const sa = Math.sin(orbit.az);
  const ce = Math.cos(orbit.el);
  const se = Math.sin(orbit.el);
  const zc = z - CLOUD_HEIGHT_M / 2;
  const right = y * ca - x * sa;
  const fwd = y * sa + x * ca;
  const depth = fwd * ce + zc * se;
  const k = CAMERA_DISTANCE_M / (CAMERA_DISTANCE_M + depth);
  return { u: right * k, v: (zc * ce - fwd * se) * k, k };
}

function PointCloudView({ droneId, points, tr }: { droneId: string; points: CloudPoint[]; tr: Translate }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const orbit = useRef<Orbit>({ az: 0.6, el: 0.55 });
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const style = getComputedStyle(canvas);
    const bandColours = BAND_VARS.map((v) => style.getPropertyValue(v).trim());
    const floorColour = style.getPropertyValue(FLOOR_VAR).trim();
    const droneColour = style.getPropertyValue(DRONE_VAR).trim();
    const bandsPerColour = Math.ceil(CLOUD_HEIGHT_M / CLOUD_BAND_M / bandColours.length) || 1;
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      if (!drag.current) orbit.current.az += ((now - last) / 1000) * ORBIT_RATE;
      last = now;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const scale = Math.min(w, h) / 15;
      const cx = w / 2;
      const cy = h / 2;
      for (const p of points) {
        const { u, v, k } = projectPoint(p.x, p.y, p.z, orbit.current);
        ctx.fillStyle =
          p.z === 0 && p.band === 0
            ? floorColour
            : bandColours[Math.min(bandColours.length - 1, Math.floor(p.band / bandsPerColour))];
        const r = Math.max(1, 1.6 * k);
        ctx.fillRect(cx + u * scale - r / 2, cy - v * scale - r / 2, r, r);
      }
      const pose = useNavStreamStore.getState().byDrone[droneId]?.pose?.data;
      if (pose) {
        const { u, v } = projectPoint(pose.t[0], pose.t[1], -pose.t[2], orbit.current);
        ctx.fillStyle = droneColour;
        ctx.beginPath();
        ctx.arc(cx + u * scale, cy - v * scale, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [droneId, points]);

  const onDown = (e: PointerEvent<HTMLCanvasElement>) => {
    drag.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    orbit.current.az += (e.clientX - d.x) * 0.01;
    orbit.current.el = Math.max(0.05, Math.min(1.45, orbit.current.el + (e.clientY - d.y) * 0.01));
    drag.current = { x: e.clientX, y: e.clientY };
  };
  const onUp = () => {
    drag.current = null;
  };

  return (
    <canvas
      ref={canvasRef}
      data-testid="live-world-cloud"
      aria-label={tr("liveWorld.cloudLabel", "Demo point cloud, drag to orbit")}
      style={{ width: "100%", height: 320, touchAction: "none", cursor: "grab", background: "var(--alt-bg-primary)", borderRadius: "0.375rem" }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    />
  );
}

function LiveWorldDemoPanel({ host }: { host: InlineHostApi }) {
  const deviceId = host.node.deviceId;
  const droneId = deviceId ? nodeIdForDevice(deviceId) : null;
  const points = useMemo(() => demoPointCloud(), []);

  // Run the demo feed while the viewer is open, unless the cockpit already
  // runs it; stop it again only if this viewer started it.
  useEffect(() => {
    if (!droneId) return;
    const startedHere = !mockDetectionStream.isRunning();
    mockDetectionStream.start(droneId);
    return () => {
      if (startedHere) mockDetectionStream.stop();
    };
  }, [droneId]);

  const tr: Translate = (key, fallback) => {
    const out = host.ctx.i18n.t(key);
    return out === key ? fallback : out;
  };

  return (
    <div
      data-testid="live-world-demo"
      style={{ display: "flex", flexDirection: "column", gap: "0.75rem", padding: "0.875rem", color: "var(--alt-text-primary)", background: "var(--alt-bg-primary)", minHeight: "100%", boxSizing: "border-box" }}
    >
      <header style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <h2 style={{ fontSize: "0.9375rem", fontWeight: 600, margin: 0 }}>{tr("liveWorld.title", "Live World")}</h2>
        <span style={pill}>{tr("liveWorld.demoBadge", "Demo data")}</span>
      </header>
      <p style={caption}>
        {tr(
          "liveWorld.demoNote",
          "Synthetic room, map and point cloud generated in the browser. No agent or capture session is connected.",
        )}
      </p>
      <section style={card} data-testid="live-world-occupancy">
        <h3 style={heading}>{tr("liveWorld.occupancy", "Occupancy (demo)")}</h3>
        {droneId ? (
          // The map's canvas and chrome are absolutely positioned: this box is
          // their containing block.
          <div style={{ height: 320, display: "flex", position: "relative", overflow: "hidden", borderRadius: "0.375rem", background: "var(--color-media)" }}>
            <LocalFrameMap droneId={droneId} className="absolute inset-0" />
          </div>
        ) : (
          <p style={caption}>{tr("liveWorld.noNode", "No node selected.")}</p>
        )}
      </section>
      <section style={card}>
        <h3 style={heading}>{tr("liveWorld.cloud", "Point cloud (demo)")}</h3>
        <PointCloudView droneId={droneId ?? ""} points={points} tr={tr} />
        <p style={caption}>
          {tr("liveWorld.cloudCaption", "{n} points, coloured by {band} m height band. Drag to orbit.")
            .replace("{n}", String(points.length))
            .replace("{band}", String(CLOUD_BAND_M))}
        </p>
      </section>
    </div>
  );
}

/** Render the demo viewer under the inline host's root; the returned disposer
 * unmounts it. The nested root carries its own message provider (the host's
 * provider does not reach a separate React root). */
export async function mountLiveWorldDemoPanel(root: HTMLElement, host: InlineHostApi): Promise<() => void> {
  const locale = useSettingsStore.getState().locale;
  const messages = await loadLocaleMessages(locale);
  const container = document.createElement("div");
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.flex = "1 1 auto";
  root.append(container);
  const reactRoot = createRoot(container);
  reactRoot.render(
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
      <LiveWorldDemoPanel host={host} />
    </NextIntlClientProvider>,
  );
  return () =>
    queueMicrotask(() => {
      reactRoot.unmount();
      container.remove();
    });
}
