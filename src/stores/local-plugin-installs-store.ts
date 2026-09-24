/**
 * @module LocalPluginInstallsStore
 * @description Browser-local record of plugin installs the operator made
 * over the LAN without a cloud (Convex) session. Mirrors
 * `local-nodes-store`: the GCS works fully local-first, so a
 * plugin installed on a LAN-paired drone (or a GCS-only plugin added to
 * Mission Control) is remembered here and its GCS half mounts from a
 * local source — never requiring sign-in.
 *
 * This is the LOCAL counterpart to the Convex `cmd_pluginInstalls` row.
 * When signed in, the Convex path also runs (cross-device / fleet view)
 * and these records reconcile up; when signed out, this is the only
 * record and the contribution producers read it directly.
 *
 * Bundle source is one of:
 *   - `agent`: the plugin was installed on a drone, and that agent holds
 *     the unpacked `gcs/` bundle. The mount fetches it over the LAN from
 *     the agent (resolved via `local-nodes-store` by `deviceId`).
 *   - `archive`: a GCS-only plugin with no drone; the bundle is fetched
 *     from the published archive URL (via the same-origin archive proxy)
 *     and extracted client-side, but only when the bytes still match the
 *     hash and signer pinned at install.
 *
 * THREAT MODEL: same as `local-nodes-store` — localStorage is plaintext;
 * an XSS on the GCS origin can read these records. They carry no
 * credentials themselves (the agent apiKey lives in `local-nodes-store`,
 * looked up by `deviceId` at fetch time). Persisted with a version /
 * migrate handler per project convention.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ArchivePin } from "@/lib/plugins/archive-pin";
import type { PluginParameter } from "@/lib/plugins/parameters/schema";
import type { PairedNodeProfile } from "@/lib/plugins/types";

/** One slot contribution the GCS half mounts (panel / overlay / channel). */
export interface LocalGcsContribution {
  slot: string;
  panelId: string;
  title?: string;
  icon?: string;
  order?: number;
  /** Node profiles a `node.detail.tab` is offered on; absent = any. */
  profile?: PairedNodeProfile[];
}

/** Where the GCS iframe bundle is fetched from for this install. */
export type LocalPluginBundleSource =
  | { kind: "agent"; deviceId: string; entrypoint: string }
  | { kind: "archive"; archiveUrl: string; entrypoint: string; pin: ArchivePin };

export interface LocalPluginInstall {
  pluginId: string;
  /** Target drone wire id, or null for a GCS-only / fleet-wide install. */
  deviceId: string | null;
  version: string;
  name: string;
  halves: Array<"agent" | "gcs">;
  /** Slot contributions for the GCS half (empty for agent-only plugins). */
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
      version: 3,
      // v1 → v2 added optional `gcsParameters` and a slot `profile`, both
      // additive. v2 → v3 pins archive installs to their verified bytes; a v2
      // archive record was never verified, so it is dropped and the plugin
      // must be reinstalled rather than mounted unchecked.
      migrate: (persisted, version) => {
        const state = persisted as LocalPluginInstallsState;
        if (version >= 3 || !Array.isArray(state?.installs)) return state;
        return { ...state, installs: state.installs.filter((i) => i.bundle.kind !== "archive") };
      },
    },
  ),
);
