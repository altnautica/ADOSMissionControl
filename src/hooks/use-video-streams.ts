/**
 * @module hooks/use-video-streams
 * @description Populates the per-drone {@link useVideoStreamsStore} from the
 * node's advertised cameras and applies the selection side effect, so the
 * cockpit stream switcher (top-left `1..N` tabs) works on any multi-camera node.
 *
 * Two sources, one descriptor list (population priority):
 *   1. Per-leg video `access_urls` ({@link StreamDescriptor} `kind:"concurrent"`)
 *      — the agent exposes N addressable WHEP paths (added in the agent-core
 *      multi-path pipeline). Selecting one re-points the video cascade at that
 *      leg's WHEP URL for an instant flip. (Wired here; the advertisement lands
 *      with the agent-core work.)
 *   2. Else the capability roster `CameraCapability[]` where more than one camera
 *      is present (`kind:"switchable"`) — one encoder, N cameras. Selecting one
 *      calls the agent's `switchCamera` (the encoder restarts, ~3s) with an
 *      optimistic "switching…" state (the LcdCameraSwitch pattern).
 *
 * The switcher UI is identical for both because the store hides which mechanism
 * applies. The side effect is applied reactively to the active-stream id so
 * every entry point (a tab click, a `1..N` digit, a cycle key, a gamepad
 * bumper) just mutates the pure store and this hook reacts — deduped against the
 * last-applied id, and NOT fired for the initial default selection (the primary
 * camera is already the streaming one / the default WHEP).
 *
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useRef } from "react";

import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useVideoStore } from "@/stores/video-store";
import {
  useVideoStreamsStore,
  type StreamDescriptor,
  type StreamRole,
  type StreamSwitchKind,
} from "@/stores/video-streams-store";
import type { CameraCapability } from "@/lib/agent/feature-types";

/** How long the optimistic "switching…" state holds while a `switchable`
 * encoder restarts before showing the new feed. Mirrors LcdCameraSwitch's
 * `RESTART_INDICATOR_MS`. */
export const STREAM_RESTART_MS = 3000;

/** Best-effort role from a capability-roster camera (which carries no explicit
 * role), for a nicer tab label. Unknown → undefined (the tab shows the name). */
function inferRole(cam: CameraCapability): StreamRole | undefined {
  const n = cam.name.toLowerCase();
  if (n.includes("thermal") || n.includes("ir") || n.includes("infrared")) {
    return "ir";
  }
  if (n.includes("wide")) return "eo_wide";
  if (n.includes("zoom") || n.includes("eo")) return "eo";
  return undefined;
}

/** Build `switchable` descriptors from the capability roster (order preserved;
 * selecting one switches the encoder to that camera's device). */
function camerasToDescriptors(cameras: CameraCapability[]): StreamDescriptor[] {
  return cameras.map((cam, i) => ({
    id: cam.device || cam.name || `camera-${i}`,
    index: i + 1,
    label: cam.name,
    role: inferRole(cam),
    kind: "switchable" as const,
    devicePath: cam.device,
  }));
}

/**
 * Wire the video streams store for a drone: populate it from the node's cameras
 * and apply the selection side effect. Call once from the cockpit (it renders
 * nothing). The tabs + hotkeys read the store and call its plain
 * `selectStream` / `cycleStream`; this hook performs the resulting transport
 * change.
 */
export function useVideoStreams(droneId: string): void {
  // Single-focus stores (the currently-selected drone), same as the cockpit's
  // video-store / capabilities-store usage.
  const cameras = useAgentCapabilitiesStore((s) => s.cameras);
  const videoStreams = useAgentCapabilitiesStore((s) => s.videoStreams);
  const client = useAgentConnectionStore((s) => s.client);
  const activeId = useVideoStreamsStore(
    (s) => s.activeStreamIdByDrone[droneId] ?? null,
  );

  // Guards, re-armed when the drone changes:
  //  - appliedRef  = the last active id the side effect applied (dedup + the
  //    "the first selection is the default" skip so the primary is not re-dialed
  //    on mount).
  //  - prevKindRef = the switch mechanism of the last stream set, so a
  //    concurrent↔switchable transition can drop a stale override + re-arm.
  const appliedRef = useRef<string | null>(null);
  const prevKindRef = useRef<StreamSwitchKind | null>(null);
  // A single "switching…" shimmer timer per drone, so overlapping switchable
  // selections never leave stacked independent timers where an earlier one
  // clears a later selection's shimmer prematurely.
  const switchTimerRef = useRef<number | null>(null);
  useEffect(() => {
    appliedRef.current = null;
    prevKindRef.current = null;
    if (switchTimerRef.current != null) {
      clearTimeout(switchTimerRef.current);
      switchTimerRef.current = null;
    }
  }, [droneId]);

  // Population, in priority: the agent's host-resolved per-leg WHEP streams
  // (`concurrent` — an instant client-side flip), else the capability roster
  // (`switchable` — a single-encoder switchCamera restart).
  useEffect(() => {
    if (!droneId) return;
    const descriptors: StreamDescriptor[] =
      videoStreams.length > 0
        ? videoStreams.map((leg, i) => ({
            id: leg.id,
            index: i + 1,
            label: leg.role ?? leg.id,
            role: leg.role,
            kind: "concurrent" as const,
            live: leg.live,
            address: {
              whepPath: `${leg.id}/whep`,
              whepUrl: leg.whepUrl,
              codec: leg.codec as "h264" | "h265" | undefined,
            },
          }))
        : camerasToDescriptors(cameras);
    // A change of switch mechanism (a pod hot-swap / capability transition)
    // invalidates any concurrent leg override and the "first is default" guard:
    // the auto-selected first leg of the NEW set must not be treated as a user
    // switch — that would leave the override pointing at a leg that no longer
    // exists, or fire a stray switchCamera for a carried-over concurrent id.
    const newKind = descriptors[0]?.kind ?? null;
    const prevKind = prevKindRef.current;
    if (prevKind !== null && newKind !== null && newKind !== prevKind) {
      useVideoStore.getState().setWhepUrlOverride(null);
      appliedRef.current = null;
    }
    if (newKind !== null) prevKindRef.current = newKind;
    useVideoStreamsStore.getState().setStreams(droneId, descriptors);
  }, [droneId, cameras, videoStreams]);

  // Selection side effect: react to the active-stream id, deduped, skipping the
  // initial default (the primary is already live).
  useEffect(() => {
    if (!droneId) return;
    const v = useVideoStore.getState();

    // No active stream (the list emptied / streams dropped to 0): clear any
    // concurrent leg override so the cascade falls back to the poller-owned
    // default URL instead of pinning a now-dead leg (a permanent NO SIGNAL),
    // and re-arm the guard for when a stream returns.
    if (activeId == null) {
      v.setWhepUrlOverride(null);
      appliedRef.current = null;
      return;
    }
    if (appliedRef.current === activeId) return;
    const first = appliedRef.current === null;
    appliedRef.current = activeId;

    const streams = useVideoStreamsStore.getState().streamsByDrone[droneId] ?? [];
    const target = streams.find((s) => s.id === activeId);
    if (!target) {
      // The active id is not a leg of the current set (a stale id carried
      // across a population change): clear any override, and never fire a
      // switchCamera for an id that is not a real device leg.
      v.setWhepUrlOverride(null);
      return;
    }

    if (target.kind === "concurrent") {
      // Never silently re-point the video at a KNOWN-DEAD leg (the agent
      // sampled `live === false`): dialing it would only show NO SIGNAL. The
      // tab is rendered disabled, so this is the belt for the hotkey / default
      // paths. `undefined`/`null` liveness is not dead — it flips normally.
      if (target.live === false) return;
      // Instant client-side flip: point the cascade at THIS leg's own WHEP URL
      // via the switcher override (which the status poller never touches, so
      // the selection survives polls), for EVERY leg including the first — the
      // active tab and the video then always agree with the agent's advertised
      // stream ids (a first leg whose id is not the poller default would
      // otherwise show the wrong camera). A leg with no resolved URL clears the
      // override so video falls back to the poller-owned default. The override
      // IS the cascade's URL, so changing it re-runs the transport cascade (a
      // fresh WHEP offer); no separate stall signal is needed.
      v.setWhepUrlOverride(target.address?.whepUrl ?? null);
    } else if (target.kind === "switchable" && target.devicePath && client) {
      // The primary encoder is already on the default camera at mount, so the
      // initial default selection needs no switch — only a subsequent (user)
      // selection restarts the encoder.
      if (first) return;
      // Optimistic restart: the active tab already lit up (the store changed);
      // hold a "switching…" shimmer for the encoder restart, then clear it. A
      // single per-drone timer (the previous one is cleared first) means a
      // rapid second selection extends the shimmer to its own restart instead
      // of the first timer clearing it early. A switchable node has no distinct
      // first-frame boundary the GCS can observe (the WHEP URL is unchanged
      // across the restart), so the timer is the clear mechanism, with the tabs
      // disabled meanwhile to keep restarts from stacking.
      useVideoStreamsStore.getState().setSwitching(droneId, true);
      Promise.resolve(client.switchCamera(target.devicePath))
        .catch(() => {
          // Leave the population effect to reconcile the roster on the next poll.
        })
        .finally(() => {
          if (switchTimerRef.current != null) {
            clearTimeout(switchTimerRef.current);
          }
          switchTimerRef.current = window.setTimeout(() => {
            switchTimerRef.current = null;
            useVideoStreamsStore.getState().setSwitching(droneId, false);
          }, STREAM_RESTART_MS);
        });
    }
  }, [droneId, activeId, client]);
}
