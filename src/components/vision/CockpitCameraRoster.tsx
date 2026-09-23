"use client";

/**
 * @module vision/CockpitCameraRoster
 * @description A compact picture-in-picture roster of the node's cameras, over
 * the main video. When a node advertises more than one camera (the capability
 * probe roster), this lists them so the operator sees at a glance that a second
 * (e.g. a downward CSI or a thermal USB) camera is present, and whether each is
 * live or idle. The main video canvas shows one feed; this is the "what other
 * eyes does this drone have" strip beside it.
 *
 * Honest by construction (no fabricated reading): every row is a real camera from the agent
 * capability probe, and its LIVE / IDLE state is the agent's own `streaming`
 * flag; a camera the agent reports no flag for reads UNKNOWN (detection is not
 * publication). Never a fabricated thumbnail or a synthesized second feed. Only ONE
 * WHEP stream is decoded, so idle cameras are shown as roster tiles, not fake
 * video. Self-gated: with fewer than two cameras there is nothing to roster
 * (the top-right CAM pill already names the single feed), so it renders null
 * and stays out of the way.
 *
 * Mounted as a registered, arrangeable cockpit widget (see `CockpitZones`).
 *
 * @license GPL-3.0-only
 */

import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";

/** Minimum cameras before a roster earns its space (below this the CAM pill covers it). */
const ROSTER_MIN_CAMERAS = 2;

export function CockpitCameraRoster() {
  const cameras = useAgentCapabilitiesStore((s) => s.cameras);

  // Nothing to roster with zero or one camera: the top-right CAM pill already
  // names the single feed, so a one-row roster would just be noise.
  if (cameras.length < ROSTER_MIN_CAMERAS) return null;

  return (
    <div className="camroster panel" data-cockpit-widget="camera-roster">
      <div className="rhead">Cameras</div>
      {cameras.map((cam, i) => {
        const sub = [
          cam.type?.toUpperCase(),
          cam.resolution === "unknown" ? null : cam.resolution,
        ]
          .filter(Boolean)
          .join(" · ");
        const badge =
          cam.streaming === null ? "Unknown" : cam.streaming ? "Live" : "Idle";
        return (
          <div
            key={`${cam.name}-${i}`}
            className={`crow${cam.streaming === true ? " live" : ""}`}
            data-streaming={String(cam.streaming)}
          >
            <span className="dot" aria-hidden="true" />
            <span className="meta">
              <span className="nm" title={cam.name}>
                {cam.name}
              </span>
              {sub ? <span className="sub">{sub}</span> : null}
            </span>
            <span className="badge">{badge}</span>
          </div>
        );
      })}
    </div>
  );
}
