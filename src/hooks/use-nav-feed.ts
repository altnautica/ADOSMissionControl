"use client";

/**
 * @module use-nav-feed
 * @description Read hooks over the navigation feed. The LAN nav stream
 * (`nav-stream-store`) is the primary source; for a cloud-reached node the
 * plugin heartbeat slices (`plugin-cloud-state-store`) carry the same
 * `follow.state` / `nav.state` / map status payloads, so the HUD still has a
 * source when no LAN path exists. Each hook returns the payload with its
 * receive time; callers apply the HUD staleness rules.
 *
 * @license GPL-3.0-only
 */

import { useMemo } from "react";

import {
  parseFollowState,
  parseMapStatus,
  parseNavState,
  type FollowState,
  type MapStatus,
  type NavState,
} from "@/lib/agent/nav-types";
import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import { WORLD_ENGINE_PLUGIN_ID } from "@/lib/api/agent/sensors";
import { usePluginCloudStateStore, type PluginCloudSlice } from "@/stores/plugin-cloud-state-store";
import { useNavStreamStore, type DroneNavFeed, type Stamped } from "@/stores/nav-stream-store";

export const FOLLOW_ME_PLUGIN_ID = "com.altnautica.follow-me";
export const VISION_NAV_PLUGIN_ID = "com.altnautica.vision-nav";

export const FOLLOW_STATE_TOPIC = "follow.state";
export const NAV_STATE_TOPIC = "nav.state";
export const MAP_STATUS_TOPIC = "plugin.world-engine.map_status";

/**
 * One topic's payload from a plugin heartbeat slice (`{topic: {payload,
 * ts_ms}}`), stamped with the slice's own `ts_ms` when present, else the
 * heartbeat time.
 */
export function topicFromSlice<T>(
  slice: PluginCloudSlice | undefined,
  topic: string,
  heartbeatAt: number | undefined,
  parse: (raw: unknown) => T | null,
): Stamped<T> | null {
  const entry = slice?.[topic];
  if (typeof entry !== "object" || entry === null) return null;
  const e = entry as { payload?: unknown; ts_ms?: unknown };
  const data = parse(e.payload);
  if (data === null) return null;
  const at = typeof e.ts_ms === "number" ? e.ts_ms : heartbeatAt;
  return at === undefined ? null : { data, receivedAt: at };
}

/** The newer of two stamped entries. */
function newer<T>(a: Stamped<T> | null | undefined, b: Stamped<T> | null): Stamped<T> | null {
  if (!a) return b;
  if (!b) return a;
  return b.receivedAt > a.receivedAt ? b : a;
}

/** The drone's LAN nav feed (pose, scan, trail, occupancy, events). */
export function useNavFeed(droneId: string | null | undefined): DroneNavFeed | undefined {
  return useNavStreamStore((s) => (droneId ? s.byDrone[droneId] : undefined));
}

function useCloudTopic<T>(
  droneId: string | null | undefined,
  pluginId: string,
  topic: string,
  parse: (raw: unknown) => T | null,
): Stamped<T> | null {
  const deviceId = droneId ? (deviceIdFromNodeId(droneId) ?? droneId) : null;
  const slice = usePluginCloudStateStore((s) => (deviceId ? s.byDevice[deviceId]?.[pluginId] : undefined));
  const at = usePluginCloudStateStore((s) => (deviceId ? s.updatedAt[deviceId] : undefined));
  return useMemo(() => topicFromSlice(slice, topic, at, parse), [slice, topic, at, parse]);
}

/** Latest `follow.state` from the nav stream or the heartbeat slice. */
export function useFollowStateEntry(droneId: string | null | undefined): Stamped<FollowState> | null {
  const live = useNavStreamStore((s) => (droneId ? s.byDrone[droneId]?.follow : undefined));
  const cloud = useCloudTopic(droneId, FOLLOW_ME_PLUGIN_ID, FOLLOW_STATE_TOPIC, parseFollowState);
  return newer(live, cloud);
}

/** Latest vision-nav `nav.state`. */
export function useNavStateEntry(droneId: string | null | undefined): Stamped<NavState> | null {
  const live = useNavStreamStore((s) => (droneId ? s.byDrone[droneId]?.nav : undefined));
  const cloud = useCloudTopic(droneId, VISION_NAV_PLUGIN_ID, NAV_STATE_TOPIC, parseNavState);
  return newer(live, cloud);
}

/** Latest world-engine map status. */
export function useMapStatusEntry(droneId: string | null | undefined): Stamped<MapStatus> | null {
  const live = useNavStreamStore((s) => (droneId ? s.byDrone[droneId]?.map : undefined));
  const cloud = useCloudTopic(droneId, WORLD_ENGINE_PLUGIN_ID, MAP_STATUS_TOPIC, parseMapStatus);
  return newer(live, cloud);
}
