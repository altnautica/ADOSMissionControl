"use client";

/**
 * @module fly/cockpit/CockpitTopRight
 * @description The top-right cockpit cluster — a faithful port of the reference
 * artifact's `.zone.tr`: the density segmented control (Min / Std / Full), the
 * live video stats (resolution · fps · frame age), and a camera pill.
 *
 * The camera pill names the node's primary (streaming) camera from the agent
 * capability probe — never a fabricated "main" label (Rule 44). When the node
 * advertises no camera roster the pill is omitted rather than inventing one;
 * when it advertises more than one, a `+N` hint points at the roster PiP. On a
 * multi-stream node the top-left stream switcher already names the active
 * stream, so the pill is omitted there to avoid a duplicate indicator.
 *
 * ## The latency figure
 *
 * This cluster used to render `latencyMs` — network RTT plus decoder buffer
 * wait, typically 10-30 ms — with a bare `ms` suffix, on a path whose real
 * camera-to-monitor delay is around 200 ms. An operator glancing at "18 ms"
 * flies as if the picture were current. It now shows the FRAME AGE from
 * `useVideoFrameAge`, always with a suffix naming which estimator produced
 * it, and `—` when neither can answer. No figure here is ever an unqualified
 * `ms`, and the roll-up is labelled `net` so it cannot be misread as
 * end-to-end.
 *
 * @license GPL-3.0-only
 */

import { useVideoStore } from "@/stores/video-store";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useVideoStreamsStore } from "@/stores/video-streams-store";
import { useVideoFrameAge } from "@/hooks/use-video-frame-age";
import { frameAgeLabel } from "@/lib/video/frame-age";
import type { CockpitDensity } from "@/lib/cockpit/density";

const MODES: { id: CockpitDensity; label: string }[] = [
  { id: "minimal", label: "Min" },
  { id: "standard", label: "Std" },
  { id: "full", label: "Full" },
];

interface Props {
  density: CockpitDensity;
  onDensity: (d: CockpitDensity) => void;
  /** The cockpit's drone, so the pill can defer to the stream switcher on a
   * multi-stream node. Absent = never a multi-stream node (the pill shows). */
  droneId?: string;
}

export function CockpitTopRight({ density, onDensity, droneId }: Props) {
  const isStreaming = useVideoStore((s) => s.isStreaming);
  const fps = useVideoStore((s) => s.fps);
  const latencyMs = useVideoStore((s) => s.latencyMs);
  const resolution = useVideoStore((s) => s.resolution);
  const degradedReason = useVideoStore((s) => s.degradedReason);
  const frameAge = useVideoFrameAge();
  const cameras = useAgentCapabilitiesStore((s) => s.cameras);
  const streamCount = useVideoStreamsStore((s) =>
    droneId ? (s.streamsByDrone[droneId]?.length ?? 0) : 0,
  );

  // The primary camera = the first streaming one, else the first advertised.
  // Never fabricate a "main" — with no roster the pill is simply absent. On a
  // multi-stream node the top-left switcher owns the active-stream indication,
  // so the pill is suppressed there to avoid duplicating it.
  const active =
    streamCount > 1
      ? null
      : (cameras.find((c) => c.streaming) ?? cameras[0] ?? null);
  const extra = cameras.length > 1 ? cameras.length - 1 : 0;

  return (
    <div className="zone tr">
      <div className="seg" role="group" aria-label="Information density">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-pressed={density === m.id}
            onClick={() => onDensity(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="vstats panel d-std">
        {isStreaming ? (
          <>
            <span className="s">
              <b>{resolution || "—"}</b>
            </span>
            <span className="s">
              <b>{Math.round(fps) || 0}</b>fps
            </span>
            {/* Frame age: how far behind the live world the picture is. The
                suffix names the estimator, and `—` is shown when neither can
                answer — an operator must never read an unqualified number
                here and take it for glass-to-glass. */}
            <span
              className="s"
              data-frame-age-source={frameAge?.source ?? "unknown"}
              title={
                frameAge?.source === "sei-g2g"
                  ? "Measured camera-to-monitor delay (SEI timestamps in the bitstream + WebRTC presentationTime + a drone/browser clock offset estimate)."
                  : frameAge?.source === "frame-metadata"
                    ? "Sender-capture to presented frame, from the browser's frame metadata (RTCP-synchronised). Excludes the camera and encoder legs, so the true delay is higher."
                    : "Frame age unknown: no SEI probe and no usable frame timestamps."
              }
            >
              VIDEO <b>{frameAge ? `+${frameAgeLabel(frameAge)}` : "—"}</b>
            </span>
            {/* The network roll-up, explicitly labelled. It is RTT plus
                decoder buffer wait, which is not an end-to-end quantity. */}
            <span className="s" title="Network round-trip plus decoder jitter-buffer wait. Not an end-to-end latency.">
              <b>{Math.round(latencyMs) || 0}</b>ms net
            </span>
            {degradedReason && (
              <span className="s" data-video-degraded={degradedReason}>
                <b>
                  {degradedReason === "ice-disconnect"
                    ? "LINK LOST"
                    : "NO FRAMES"}
                </b>
              </span>
            )}
          </>
        ) : (
          <span className="s">OFFLINE</span>
        )}
      </div>

      {active && (
        <div
          className={`camsel panel d-std${active.streaming ? "" : " idle"}`}
          data-camera-streaming={active.streaming}
        >
          <i className="dot" />
          <span title={active.name}>CAM · {active.name}</span>
          {extra > 0 && <span className="more">+{extra}</span>}
        </div>
      )}
    </div>
  );
}
