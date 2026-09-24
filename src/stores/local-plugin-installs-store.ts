/**
 * @module LocalPluginInstallsStore
 * @description Browser-local record of GCS-only plugins (no agent half) the
 * operator installed from the registry without a cloud (Convex) session.
 * Mirrors `local-nodes-store`: the GCS works fully local-first, so a
 * GCS-only plugin is remembered here and its GCS half mounts from a local
 * source — never requiring sign-in.
 *
 * This is the LOCAL counterpart to the Convex `cmd_pluginInstalls` row for
 * a plugin no node holds. A plugin with an agent half is never recorded
 * here: the node's own install list (`GET /api/plugins`) is the source of
 * truth for what is installed on a node, however it got there.
 *
 * The bundle comes from the published archive URL (via the same-origin
 * archive proxy) and is extracted client-side, but only when the bytes still
 * match the hash and signer pinned at install.
 *
 * THREAT MODEL: same as `local-nodes-store` — localStorage is plaintext;
 * an XSS on the GCS origin can read these records. They carry no
 * credentials. Persisted with a version / migrate handler per project
 * convention.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ArchivePin } from "@/lib/plugins/archive-pin";
import type { PluginParameter } from "@/lib/plugins/parameters/schema";
import type { GcsContributeRow } from "@/lib/plugins/types";

/** One slot contribution the GCS half mounts (panel / overlay / page). */
export type LocalGcsContribution = GcsContributeRow;

/** Where the GCS iframe bundle is fetched from for this install. */
export type LocalPluginBundleSource = {
  kind: "archive";
  archiveUrl: string;
  entrypoint: string;
  pin: ArchivePin;
};

export interface LocalPluginInstall {
  pluginId: string;
  /** The drone the install dialog was opened from, or null for a
   * fleet-wide install from the Settings home. */
  deviceId: string | null;
  version: string;
  name: string;
  halves: Array<"agent" | "gcs">;
  /** Slot contributions for the GCS half. */
  gcsContributes: LocalGcsContribution[];
  /** Declarative parameter contributions the native panel renders. Absent
   * when the plugin declares none (the panel then renders nothing). */
  gcsParameters?: PluginParameter[];
  /** Capability ids the operator approved at install. */
  grantedCaps: string[];
  /** Manifest hash, for de-dup + reconciliation against Convex on sign-in. */
  manifestHash: string;
  bundle: LocalPluginBundleSource;
  installedAt: number;
}

/** Composite key: a plugin is installed at most once per device (or once
 * fleet-wide when deviceId is null). */
function keyOf(pluginId: string, deviceId: string | null): string {
  return `${deviceId ?? "fleet"}::${pluginId}`;
}

/** A no-op storage for SSR / test environments where a usable
 * localStorage is absent. Note: some test DOM shims (happy-dom here)
 * expose `window.localStorage` as an object whose `setItem` is
 * `undefined`, so we feature-detect the methods, not just `window`. */
const NOOP_STORAGE = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

function resolveStorage() {
  if (typeof window === "undefined") return NOOP_STORAGE;
  // Some embedded browsers expose a stub without the methods.
  const ls: Partial<Storage> | undefined = window.localStorage;
  if (
    ls &&
    typeof ls.getItem === "function" &&
    typeof ls.setItem === "function" &&
    typeof ls.removeItem === "function"
  ) {
    return window.localStorage;
  }
  return NOOP_STORAGE;
}

interface LocalPluginInstallsState {
  installs: LocalPluginInstall[];
  /** Upsert an install (replaces any prior record with the same key). */
  record: (install: LocalPluginInstall) => void;
  /** Remove an install by plugin + device. */
  remove: (pluginId: string, deviceId: string | null) => void;
  /** Installs for one device, or the fleet/GCS-only set when null. */
  listForDevice: (deviceId: string | null) => LocalPluginInstall[];
  /** One install, or undefined. */
  get: (
    pluginId: string,
    deviceId: string | null,
  ) => LocalPluginInstall | undefined;
  /** Drop every record (operator reset). */
  clear: () => void;
}

export const useLocalPluginInstallsStore = create<LocalPluginInstallsState>()(
  persist(
    (set, get) => ({
      installs: [],
      record: (install) =>
        set((s) => {
          const k = keyOf(install.pluginId, install.deviceId);
          const rest = s.installs.filter(
            (i) => keyOf(i.pluginId, i.deviceId) !== k,
          );
          return { installs: [...rest, install] };
        }),
      remove: (pluginId, deviceId) =>
        set((s) => ({
          installs: s.installs.filter(
            (i) => keyOf(i.pluginId, i.deviceId) !== keyOf(pluginId, deviceId),
          ),
        })),
      listForDevice: (deviceId) =>
        get().installs.filter((i) => i.deviceId === deviceId),
      get: (pluginId, deviceId) =>
        get().installs.find(
          (i) => keyOf(i.pluginId, i.deviceId) === keyOf(pluginId, deviceId),
        ),
      clear: () => set({ installs: [] }),
    }),
    {
      name: "altcmd:local-plugin-installs",
      // SSR/test-safe: localStorage may be absent (SSR) or method-incomplete
      // (some test DOM shims), so resolveStorage feature-detects it and
      // falls back to a no-op store instead of throwing.
      storage: createJSONStorage(resolveStorage),
      version: 4,
      // v1 → v2 added optional `gcsParameters` and a slot `profile`, both
      // additive. v2 → v3 pins archive installs to their verified bytes; a v2
      // archive record was never verified, so it is dropped and the plugin
      // must be reinstalled rather than mounted unchecked. v3 → v4 stops
      // recording plugins with an agent half (their node's own install list
      // is the source of truth), so those records are dropped.
      migrate: (persisted, version) => {
        const state = persisted as LocalPluginInstallsState;
        if (version >= 4 || !Array.isArray(state?.installs)) return state;
        // Only a pinned (v3) GCS-only record survives; an agent-bundle record
        // always belonged to a plugin with an agent half.
        const installs =
          version < 3 ? [] : state.installs.filter((i) => !i.halves.includes("agent"));
        return { ...state, installs };
      },
    },
  ),
);
