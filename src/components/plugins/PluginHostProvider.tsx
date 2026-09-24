"use client";

import { createContext, Fragment, useContext, useMemo } from "react";

import type { BridgeHandler } from "@/lib/plugins/bridge";
import type { GcsIsolation, PluginSlotName } from "@/lib/plugins/types";
import type { InlineBundle } from "@/lib/plugins/inline-loader";

/** Where an inline contribution's module load stands. A failed load is shown
 * as an error card; an inline contribution never falls back to an iframe. */
export type InlineMountState =
  | { status: "loading" }
  | { status: "ready"; bundle: InlineBundle }
  | { status: "error"; message: string; retry: () => void };

/**
 * One renderable plugin contribution at a specific slot. The host
 * orchestrator hands these to `<PluginSlot>`, which mounts a
 * `<PluginIframeHost>` (or, for a trusted inline module, an
 * `<InlinePluginHost>`) per entry. The contribution is the unit of
 * trust: each mount gets its own granted-cap set, its own handler
 * surface, and its own bundle.
 */
export interface PluginSlotContribution {
  pluginId: string;
  /** Stable id within the plugin (`gcs.contributes.panels[].id`). */
  panelId: string;
  /** Blob URL or hosted URL pointing at the plugin's GCS iframe bundle.
   * Empty for an inline contribution. */
  bundleUrl: string;
  /** How the contribution mounts. Absent means the sandboxed iframe. */
  isolation?: GcsIsolation;
  /** The module load behind an `inline` contribution. */
  inline?: InlineMountState;
  /** Capability ids the operator has granted for this plugin. */
  grantedCapabilities: ReadonlySet<string>;
  /** Per-method dispatchers wired to host services. */
  handlers: Record<string, BridgeHandler>;
  /** Optional class list applied to the iframe element. */
  iframeClassName?: string;
  /** Title attribute for assistive tech. Defaults to pluginId/panelId. */
  title?: string;
  /**
   * Stable install id for this plugin record, so revoke/install cycles
   * map to a single entry. Falls back to `pluginId` if the caller omits it.
   */
  pluginInstallId?: string;
}

interface PluginHostContextValue {
  /** Contributions keyed by slot name. Slots not in the map are empty. */
  bySlot: ReadonlyMap<PluginSlotName, ReadonlyArray<PluginSlotContribution>>;
  /** Drone the provider is currently scoped to, or null for fleet-wide. */
  deviceId: string | null;
}

const PluginHostContext = createContext<PluginHostContextValue | null>(null);

interface PluginHostProviderProps {
  /**
   * Flat contribution list keyed by plugin/panel. The provider groups
   * them by slot for `<PluginSlot>` consumption. The list is expected
   * to come from a Convex query joined with the live plugin manifest;
   * the provider stays presentational so the wiring is testable.
   */
  contributions: ReadonlyArray<
    PluginSlotContribution & { slot: PluginSlotName }
  >;
  /**
   * The drone this provider is scoped to. When non-null, the entire
   * provider subtree is keyed by this id so React unmounts every
   * descendant on drone switch. Pass `null` for fleet-wide slots
   * (settings, hardware list, etc.) where the provider behaves as a
   * single long-lived host.
   */
  deviceId?: string | null;
  children: React.ReactNode;
}

/**
 * Top-level provider that hands per-slot contributions to descendant
 * `<PluginSlot>` instances. The tree shape is deliberate: one provider
 * near the root, slots scattered across the chrome and tabs.
 *
 * When `deviceId` is set, the children are wrapped in a keyed
 * `Fragment` so React tears the subtree down end-to-end on drone
 * switch: every plugin iframe for the previous drone unmounts with no
 * pause step, and the new drone's iframes mount fresh.
 */
export function PluginHostProvider({
  contributions,
  deviceId = null,
  children,
}: PluginHostProviderProps) {
  const bySlot = useMemo<
    ReadonlyMap<PluginSlotName, ReadonlyArray<PluginSlotContribution>>
  >(() => {
    const map = new Map<
      PluginSlotName,
      Array<PluginSlotContribution>
    >();
    for (const c of contributions) {
      const list = map.get(c.slot);
      const entry: PluginSlotContribution = {
        pluginId: c.pluginId,
        panelId: c.panelId,
        bundleUrl: c.bundleUrl,
        isolation: c.isolation,
        inline: c.inline,
        grantedCapabilities: c.grantedCapabilities,
        handlers: c.handlers,
        iframeClassName: c.iframeClassName,
        title: c.title,
        pluginInstallId: c.pluginInstallId ?? c.pluginId,
      };
      if (list) list.push(entry);
      else map.set(c.slot, [entry]);
    }
    return map;
  }, [contributions]);

  const value = useMemo<PluginHostContextValue>(
    () => ({ bySlot, deviceId }),
    [bySlot, deviceId],
  );

  // The Fragment key makes drone switch a full subtree reset: React
  // unmounts every descendant (slots, iframe hosts, plugin state) and
  // mounts a fresh tree against the new deviceId. Fleet-wide use
  // (deviceId=null) collapses to the "fleet" key so the subtree is
  // stable across the app lifetime.
  return (
    <PluginHostContext.Provider value={value}>
      <Fragment key={deviceId ?? "fleet"}>{children}</Fragment>
    </PluginHostContext.Provider>
  );
}

/**
 * Read the contributions registered at one slot. Returns an empty
 * array if no provider is mounted, which lets non-plugin-aware
 * surfaces render without runtime checks.
 */
export function useSlotContributions(
  name: PluginSlotName,
): ReadonlyArray<PluginSlotContribution> {
  const ctx = useContext(PluginHostContext);
  return ctx?.bySlot.get(name) ?? EMPTY_LIST;
}

/**
 * Access the provider's scoped state (contributions by slot and the
 * drone it is bound to). Returns `null` when no provider is mounted, so
 * call sites can gracefully no-op outside the plugin host context.
 */
export function usePluginHost(): PluginHostContextValue | null {
  return useContext(PluginHostContext);
}

const EMPTY_LIST: ReadonlyArray<PluginSlotContribution> = Object.freeze([]);
