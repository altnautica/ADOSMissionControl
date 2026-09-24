"use client";

/**
 * @module plugin-cloud-state-store
 * @description The cloud sibling of the local per-plugin state egress
 * (`usePluginSkillHostStore`). The heartbeat carries a generic `pluginState`
 * map — each plugin's own opaque telemetry slice, ferried by the relay under
 * `pluginState[pluginId]` (the core never inspects a slice). This store holds
 * the latest slice per device per plugin so any plugin's GCS half can read its
 * own cloud telemetry without the core growing a column per plugin.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";

/** A plugin's opaque cloud-state slice (the plugin owns its shape). */
export type PluginCloudSlice = Record<string, unknown>;

interface PluginCloudStateStore {
  /** deviceId -> pluginId -> that plugin's latest opaque slice. */
  byDevice: Record<string, Record<string, PluginCloudSlice>>;
  /** deviceId -> epoch ms of the heartbeat the slices came from. */
  updatedAt: Record<string, number>;
  /** Replace a device's whole plugin-state map from one heartbeat taken at
   * `at` (epoch ms). */
  setForDevice: (
    deviceId: string,
    pluginState: Record<string, PluginCloudSlice>,
    at: number,
  ) => void;
  /** Drop a device's slices (e.g. on a focus switch). */
  clearDevice: (deviceId: string) => void;
}

export const usePluginCloudStateStore = create<PluginCloudStateStore>((set) => ({
  byDevice: {},
  updatedAt: {},
  setForDevice(deviceId, pluginState, at) {
    set((state) => ({
      byDevice: { ...state.byDevice, [deviceId]: pluginState },
      updatedAt: { ...state.updatedAt, [deviceId]: at },
    }));
  },
  clearDevice(deviceId) {
    set((state) => {
      if (!(deviceId in state.byDevice)) return state;
      const byDevice = { ...state.byDevice };
      const updatedAt = { ...state.updatedAt };
      delete byDevice[deviceId];
      delete updatedAt[deviceId];
      return { byDevice, updatedAt };
    });
  },
}));

/**
 * Selector: one plugin's cloud slice for a device, or undefined.
 * Usage: `usePluginCloudStateStore(selectPluginCloudSlice(deviceId, "follow-me"))`.
 */
export function selectPluginCloudSlice(
  deviceId: string | null | undefined,
  pluginId: string,
) {
  return (s: PluginCloudStateStore): PluginCloudSlice | undefined =>
    deviceId ? s.byDevice[deviceId]?.[pluginId] : undefined;
}
