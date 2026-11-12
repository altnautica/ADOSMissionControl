"use client";

/**
 * @module plugins/use-plugin-camera-names
 * @description The node's camera display names, as the payload the plugin
 * hosts push to a node-bound plugin under {@link PLUGIN_CAMERAS_EVENT}. A
 * plugin config holds a camera by its id; with this list the plugin can show
 * the operator's name for it. Read from the node's camera roster
 * (`useCameraRoster`); `null` while loading or when the roster cannot be
 * read, so a host sends nothing rather than an empty list as if the node had
 * no cameras.
 *
 * @license GPL-3.0-only
 */

import { useMemo } from "react";

import { useCameraRoster } from "@/lib/plugins/parameters/use-camera-roster";

/** Host event carrying the node's camera names (a host-reserved topic). */
export const PLUGIN_CAMERAS_EVENT = "cameras.changed";

/** One camera: its logical id and the operator's name for it, or `null`
 * when the agent has none. */
export interface PluginCameraName {
  id: string;
  name: string | null;
}

export interface PluginCamerasPayload {
  cameras: PluginCameraName[];
}

/** The camera names of `deviceId` (a bare agent device id), or `null`. */
export function usePluginCameraNames(
  deviceId: string | null | undefined,
): PluginCamerasPayload | null {
  const roster = useCameraRoster(deviceId ?? undefined);
  return useMemo(
    () =>
      roster
        ? { cameras: roster.map((c) => ({ id: c.id, name: c.name ?? null })) }
        : null,
    [roster],
  );
}
