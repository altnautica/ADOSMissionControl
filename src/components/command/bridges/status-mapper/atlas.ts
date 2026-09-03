/**
 * @module command/bridges/status-mapper/atlas
 * @description Builds the per-slice patch the bridge applies to the atlas store
 * from the heartbeat's generic `pluginState.atlas` slice — the Atlas plugin's
 * own opaque telemetry (the core never inspects it; the plugin owns the shape).
 * Returns null when the heartbeat carries no atlas slice. Pure.
 * @license GPL-3.0-only
 */

import type { AtlasLiveState } from "@/stores/atlas-store";

export interface AtlasFanOutCurrent {
  live: AtlasLiveState;
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asBool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

/** Pull the `atlas` slice out of the generic plugin-state map, or null. */
function atlasSlice(cloudStatus: Record<string, unknown>): Record<string, unknown> | null {
  const pluginState = cloudStatus.pluginState;
  if (typeof pluginState !== "object" || pluginState === null) return null;
  const atlas = (pluginState as Record<string, unknown>).atlas;
  return typeof atlas === "object" && atlas !== null
    ? (atlas as Record<string, unknown>)
    : null;
}

/**
 * Build the patch the bridge applies to `useAtlasStore` from the heartbeat's
 * `pluginState.atlas` slice. Returns `null` when there is no atlas slice (a
 * non-capturing drone) so the previous live values are preserved.
 */
export function buildAtlasPatch(
  cloudStatus: Record<string, unknown>,
  current: AtlasFanOutCurrent,
  nowMs: number,
): { live: AtlasLiveState } | null {
  const slice = atlasSlice(cloudStatus);
  if (slice === null) return null;
  return mapAtlasSlice(slice, current, nowMs);
}

/**
 * Map the Atlas plugin's own state slice (the same shape whether it arrives
 * cloud-side under `pluginState.atlas` or is polled local-first from the agent's
 * `GET /api/plugins/atlas/state`) onto the atlas store's live slice. Returns
 * `null` when the slice carries nothing (a present-but-empty / non-capturing
 * slice) so the previous live values are preserved. The drone emits its own
 * capture + transport facts (state / session / cameras / VIO health / keyframes /
 * ingest rate / compute node / bearer / last keyframe); reconstruction metrics
 * (gaussian count, training rate) belong to the compute node's World Model
 * surface, not this drone-capture slice.
 */
export function mapAtlasSlice(
  slice: Record<string, unknown>,
  current: AtlasFanOutCurrent,
  nowMs: number,
): { live: AtlasLiveState } | null {
  const state = asString(slice.state);
  const sessionId = asString(slice.sessionId);
  const keyframesIngested = asNumber(slice.keyframesIngested);
  const ingestRateHz = asNumber(slice.ingestRateHz);
  const cameraCount = asNumber(slice.cameraCount);
  const vioHealth = asString(slice.vioHealth);
  const computeNodeId = asString(slice.computeNodeId);
  const lastKfAt = asNumber(slice.lastKfAt);
  const bearer = asString(slice.bearer);
  const keyframesCarried = asBool(slice.keyframesCarried);
  const capped = asBool(slice.capped);
  const anchored = asBool(slice.anchored);
  const poseTier = asString(slice.poseTier);
  const droppedKeyframes = asNumber(slice.droppedKeyframes);
  const relayGroundAgentId = asString(slice.relayGroundAgentId);
  const relayDecimation = asNumber(slice.relayDecimation);

  // A present-but-empty slice carries nothing to merge.
  if (
    state === null &&
    sessionId === null &&
    keyframesIngested === null &&
    ingestRateHz === null &&
    cameraCount === null &&
    vioHealth === null &&
    computeNodeId === null &&
    lastKfAt === null &&
    bearer === null &&
    keyframesCarried === null &&
    capped === null &&
    anchored === null &&
    poseTier === null &&
    droppedKeyframes === null &&
    relayGroundAgentId === null &&
    relayDecimation === null
  ) {
    return null;
  }

  // Merge over the current slice so a sparse heartbeat preserves last-known
  // values for fields it omitted.
  const live: AtlasLiveState = {
    state: state ?? current.live.state,
    sessionId: sessionId ?? current.live.sessionId,
    keyframesIngested: keyframesIngested ?? current.live.keyframesIngested,
    ingestRateHz: ingestRateHz ?? current.live.ingestRateHz,
    cameraCount: cameraCount ?? current.live.cameraCount,
    vioHealth: vioHealth ?? current.live.vioHealth,
    computeNodeId: computeNodeId ?? current.live.computeNodeId,
    lastKfAt: lastKfAt ?? current.live.lastKfAt,
    bearer: bearer ?? current.live.bearer,
    keyframesCarried: keyframesCarried ?? current.live.keyframesCarried,
    capped: capped ?? current.live.capped,
    anchored: anchored ?? current.live.anchored,
    poseTier: poseTier ?? current.live.poseTier,
    droppedKeyframes: droppedKeyframes ?? current.live.droppedKeyframes,
    relayGroundAgentId: relayGroundAgentId ?? current.live.relayGroundAgentId,
    relayDecimation: relayDecimation ?? current.live.relayDecimation,
    updatedAt: nowMs,
  };

  return { live };
}
