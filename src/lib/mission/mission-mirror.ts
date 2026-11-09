/**
 * @module mission/mission-mirror
 * @description The drone agent's mirror of the flight controller's mission
 * (`GET /api/v1/mission`): every MISSION_ITEM_INT the router saw, with `x`/`y`
 * in 1e-7 degrees. When the plan on the drone is not the one this device
 * holds, the map views draw this route instead of the local plan, so the map
 * never shows a route the aircraft is not flying.
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";

import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import { resolveLocalAgentForDrone } from "@/lib/agent/resolve-agent";
import { timedFetch } from "@/lib/agent/agent-client/timeout";
import { usePilotState } from "@/lib/cockpit/use-pilot-state";
import { planIdentity, type PlanIdentity } from "@/lib/mission/plan-identity";
import { useUploadReceiptsStore } from "@/stores/upload-receipts-store";

/** One positioned waypoint of the mirrored mission. `seq` is the FC's item
 * sequence (MISSION_CURRENT counts in it). */
export interface MirrorPoint {
  seq: number;
  lat: number;
  lon: number;
}

/** MAV_CMD ids that put the aircraft somewhere (the route's vertices). */
const NAV_COMMANDS: Record<number, true> = {
  16: true, // NAV_WAYPOINT
  17: true, // NAV_LOITER_UNLIM
  18: true, // NAV_LOITER_TURNS
  19: true, // NAV_LOITER_TIME
  21: true, // NAV_LAND
  22: true, // NAV_TAKEOFF
  31: true, // NAV_LOITER_TO_ALT
  82: true, // NAV_SPLINE_WAYPOINT
  84: true, // NAV_VTOL_TAKEOFF
  85: true, // NAV_VTOL_LAND
};

/** The route from a `GET /api/v1/mission` body: positioned nav items, the
 * ArduPilot home slot excluded. Null when the agent has mirrored nothing. */
export function mirrorRoute(body: unknown): MirrorPoint[] | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (b.present !== true || !Array.isArray(b.items)) return null;
  const homeSlot = b.home_slot === true;
  const out: MirrorPoint[] = [];
  for (const raw of b.items) {
    if (typeof raw !== "object" || raw === null) continue;
    const i = raw as Record<string, unknown>;
    const seq = i.seq;
    const x = i.x;
    const y = i.y;
    if (typeof seq !== "number" || typeof x !== "number" || typeof y !== "number") continue;
    if (homeSlot && seq === 0) continue;
    if (typeof i.command !== "number" || !NAV_COMMANDS[i.command]) continue;
    if (x === 0 && y === 0) continue;
    out.push({ seq, lat: x / 1e7, lon: y / 1e7 });
  }
  return out;
}

/** Fetch the mirrored route of `droneId`'s mission from its LAN agent. */
export async function fetchMissionMirror(droneId: string, signal?: AbortSignal): Promise<MirrorPoint[] | null> {
  const agent = resolveLocalAgentForDrone(deviceIdFromNodeId(droneId) ?? droneId);
  if (!agent) return null;
  const res = await timedFetch(`${agent.agentUrl}/api/v1/mission`, {
    headers: agent.apiKey ? { "X-ADOS-Key": agent.apiKey } : {},
    signal,
  });
  if (!res.ok) return null;
  return mirrorRoute(await res.json());
}

/**
 * The mirrored route while `enabled`, refetched whenever the drone's mission
 * identity changes (a new upload). Null while off, loading or unavailable.
 */
export function useMissionMirror(droneId: string | null | undefined, enabled: boolean): MirrorPoint[] | null {
  const { pilot } = usePilotState(droneId);
  const id = pilot?.mission?.id ?? null;
  const total = pilot?.mission?.total ?? null;
  const uploads = pilot?.mission?.uploadsSeen ?? null;
  const [route, setRoute] = useState<{ key: string; points: MirrorPoint[] | null } | null>(null);
  const key = `${droneId}|${id}|${total}|${uploads}`;

  useEffect(() => {
    if (!enabled || !droneId) return;
    const ctl = new AbortController();
    fetchMissionMirror(droneId, ctl.signal)
      .then((points) => setRoute({ key, points }))
      .catch(() => {
        if (!ctl.signal.aborted) setRoute({ key, points: null });
      });
    return () => ctl.abort();
  }, [enabled, droneId, key]);

  return enabled && route?.key === key ? route.points : null;
}

/** Whether the plan on `droneId` is the one this device uploaded. */
export function useDronePlanIdentity(droneId: string | null | undefined): PlanIdentity {
  const { pilot } = usePilotState(droneId);
  const receipt = useUploadReceiptsStore((s) => (droneId ? s.receipts[droneId]?.mission : undefined));
  return droneId ? planIdentity(receipt, pilot?.mission) : "unknown";
}
