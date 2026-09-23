"use client";

/**
 * @module use-plugin-contributions
 * @description The live plugin contribution producer. Joins a drone's
 * (or the fleet-wide) enabled plugin installs from
 * `cmdPlugins.listForDeviceWithDetail` with each install's signed GCS
 * bundle blob and a per-plugin handler surface, and returns a stable
 * sorted list of `PluginSlotContribution & { slot }` ready to feed a
 * `<PluginHostProvider>`.
 *
 * This is the keystone that makes an installed + enabled + permission-
 * granted plugin actually mount as a live sandboxed iframe. The hook is
 * inert by default: it returns `[]` until the operator installs, enables,
 * and grants a plugin (the natural gate — no extra feature flag).
 *
 * Lifecycle the hook owns:
 *   - Bundle blobs: the Convex query hands back a short-lived SIGNED URL
 *     per install; a blob URL is null-origin and is what the sandboxed
 *     iframe needs. Blobs live in the shared `plugin-contribution-cache`,
 *     loaded once per `(installId, version)` however many slot hosts ask,
 *     and revoked when the last host lets go. A contribution is omitted
 *     until its blob is ready, so no iframe ever mounts against an empty src.
 *   - Handlers: `buildPluginHandlers()` runs once per `(pluginId, deviceId)`
 *     in the same shared cache and is `dispose()`d when the last host holding
 *     it drops the plugin (it tears down any telemetry subscriptions the
 *     plugin opened).
 *   - Only installs contributing to the requested `slot` are loaded, so a
 *     host for one slot never downloads another slot's bundle.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { makeFunctionReference } from "convex/server";
import { api } from "../../convex/_generated/api";
import { useConvex } from "convex/react";
import { useTranslations } from "next-intl";

import { isDemoMode } from "@/lib/utils";
import { useConvexSkipQuery } from "@/hooks/use-convex-skip-query";
import { useAuthStore } from "@/stores/auth-store";
import { useLocalAgentPlugins } from "@/hooks/use-local-agent-plugins";
import {
  acquireBundle,
  acquireHandlers,
  bundleKey,
  handlerKey,
  peekBundle,
  releaseBundle,
  releaseHandlers,
  type BundleSource,
} from "@/hooks/plugin-contribution-cache";
import { buildPluginHandlers } from "@/lib/plugins/handlers";
import type { BridgeHandler } from "@/lib/plugins/bridge";
import type { PluginSlotContribution } from "@/components/plugins/PluginHostProvider";
import {
  PLUGIN_SLOTS,
  type PluginSlotName,
  type PairedNodeProfile,
} from "@/lib/plugins/types";

/** Slot fallback sort hint, matching the slot-13 contract default. */
const DEFAULT_ORDER = 60;

/** A renderable contribution carrying the slot it mounts into. */
type SlottedContribution = PluginSlotContribution & { slot: PluginSlotName };

/** Source-agnostic install row the blob + handler + builder pipeline reads,
 * unifying the Convex query rows and the local agent-detail rows. */
interface NormalizedRow {
  installId: string;
  pluginId: string;
  version: string;
  name: string;
  grantedCaps: string[];
  gcsContributes: Array<{
    slot: string;
    panelId: string;
    title?: string;
    icon?: string;
    order?: number;
    profile?: PairedNodeProfile[];
  }>;
  /** Null when the install has no loadable GCS bundle yet (agent-only, or
   * a cloud row whose bundle has not finished uploading). */
  bundle: BundleSource | null;
}

/** Local install statuses that mount a contribution (matches the cloud
 * `listForDeviceWithDetail` server filter). */
function isLiveStatus(status: string): boolean {
  return status === "enabled" || status === "running";
}

/** A `node.detail.tab` mounts on a node when its `profile` narrowing is absent
 * or includes the node's resolved profile. Non-tab slots are never narrowed.
 * Matches `tabOffersOnProfile` in `use-drone-plugin-contributions.ts`. */
function slotOffersOnProfile(
  slot: string,
  profile: PairedNodeProfile[] | undefined,
  nodeProfile: PairedNodeProfile | undefined,
): boolean {
  if (slot !== "node.detail.tab") return true;
  if (!profile || profile.length === 0) return true;
  if (!nodeProfile) return true;
  return profile.includes(nodeProfile);
}

const EMPTY: ReadonlyArray<SlottedContribution> = Object.freeze([]);

const KNOWN_SLOTS = new Set<string>(PLUGIN_SLOTS);
function isKnownSlot(slot: string): slot is PluginSlotName {
  return KNOWN_SLOTS.has(slot);
}

type ContributeEntry = NormalizedRow["gcsContributes"][number];

/** Whether a manifest entry mounts in `slot` (any slot when unset) on a node of
 * `nodeProfile`: a known slot, with a `node.detail.tab` profile-narrowed to the
 * node, matching the header/body filter so an off-profile tab never mounts. */
function entryMounts(
  entry: ContributeEntry,
  slot: PluginSlotName | undefined,
  nodeProfile: PairedNodeProfile | undefined,
): entry is ContributeEntry & { slot: PluginSlotName } {
  return (
    (!slot || entry.slot === slot) &&
    isKnownSlot(entry.slot) &&
    slotOffersOnProfile(entry.slot, entry.profile, nodeProfile)
  );
}

/**
 * Live plugin contributions for a drone (or fleet-wide when `deviceId` is
 * null), optionally narrowed to a single `slot`. `nodeProfile` is the
 * resolved profile of the node these contributions mount on; a
 * `node.detail.tab` that declares a `profile` narrowing is dropped when the
 * node's profile is not in the set (so a ground-station-only tab's iframe
 * never mounts on a drone). Other slots ignore `nodeProfile`. Returns a stable
 * memoized array (same identity while the install set, loaded blobs, and
 * built handlers are unchanged) sorted by manifest `order` then
 * `pluginId`. Returns `[]` when unauthenticated, in demo mode, before the
 * query resolves, or while bundle blobs are still loading.
 */
export function usePluginContributions(
  deviceId: string | null,
  slot?: PluginSlotName,
  nodeProfile?: PairedNodeProfile,
): ReadonlyArray<SlottedContribution> {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const installs = useConvexSkipQuery(api.cmdPlugins.listForDeviceWithDetail, {
    args: { deviceId: deviceId ?? undefined },
    enabled: isAuthenticated,
  });

  // Local-first source: when signed out, the agent that
  // unpacked the archive both reports the install detail AND serves the
  // GCS bundle, so the iframe mounts with no cloud. Null in cloud/demo.
  const localDetail = useLocalAgentPlugins(deviceId);

  // Unify the two sources into one row shape. Everything downstream (blob
  // lifecycle, handler lifecycle, contribution builder) reads `rows`, so
  // the only difference between cloud and local is the bundle SOURCE.
  const rows = useMemo<NormalizedRow[] | null>(() => {
    if (isDemoMode()) return [];
    if (isAuthenticated) {
      if (!installs) return null;
      return installs.map((r) => ({
        installId: String(r.installId),
        pluginId: r.pluginId,
        version: r.version,
        name: r.name,
        grantedCaps: r.grantedCaps,
        gcsContributes: r.gcsContributes,
        bundle:
          typeof r.bundleUrl === "string" && r.bundleUrl.length > 0
            ? { kind: "url", url: r.bundleUrl }
            : null,
      }));
    }
    if (!localDetail) return null;
    return localDetail
      .filter((r) => isLiveStatus(r.status))
      .map((r) => {
        let bundle: BundleSource | null = null;
        if (r.bundle?.kind === "agent") {
          bundle = {
            kind: "agent",
            agentUrl: r.bundle.agentUrl,
            apiKey: r.bundle.apiKey,
            pluginId: r.pluginId,
            entrypoint: r.bundle.entrypoint,
          };
        } else if (r.bundle?.kind === "archive") {
          bundle = {
            kind: "archive",
            archiveUrl: r.bundle.archiveUrl,
            entrypoint: r.bundle.entrypoint,
            pin: r.bundle.pin,
          };
        }
        return {
          installId: r.installId,
          pluginId: r.pluginId,
          version: r.version,
          name: r.name,
          grantedCaps: r.grantedCaps,
          gcsContributes: r.gcsContributes,
          bundle,
        };
      });
  }, [isAuthenticated, installs, localDetail]);

  // Stable translator for the plugin handler factory. next-intl's `t`
  // identity can change across renders; the ref keeps the factory's
  // `translate` dependency stable so handlers are not rebuilt needlessly.
  const t = useTranslations();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const translate = useCallback(
    (key: string, params?: Record<string, string | number>): string =>
      tRef.current(key, params),
    [],
  );

  // Convex caller for cloud.read. The handler enforces the read allowlist +
  // arg validation + rate limit BEFORE this runs, so only the few public
  // allowlisted queries ever reach here.
  const convex = useConvex();
  const cloudQuery = useCallback(
    (fn: string, args: Record<string, unknown>): Promise<unknown> =>
      convex.query(
        makeFunctionReference<"query", Record<string, unknown>, unknown>(fn),
        args,
      ),
    [convex],
  );

  // Only installs with an entry that mounts in this host's slot (and on this
  // node's profile) are loaded; a host for one slot never pulls another
  // slot's bundle or builds its handlers.
  const slotRows = useMemo(
    () =>
      rows?.filter((r) =>
        r.gcsContributes.some((e) => entryMounts(e, slot, nodeProfile)),
      ) ?? null,
    [rows, slot, nodeProfile],
  );

  // ── Bundle blob lifecycle (shared, ref-counted) ─────────────────────
  // Keys this host holds in the shared cache, mapped to their install id.
  const heldBundlesRef = useRef<Map<string, string>>(new Map());
  const [blobs, setBlobs] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );

  // Installs that ship a loadable GCS bundle, the only ones that can mount.
  const loadTargets = useMemo(
    () =>
      (slotRows ?? []).flatMap((r) =>
        r.bundle ? [{ key: bundleKey(r.installId, r.version), installId: r.installId, bundle: r.bundle }] : [],
      ),
    [slotRows],
  );

  useEffect(() => {
    const held = heldBundlesRef.current;
    const wanted = new Map(loadTargets.map((t) => [t.key, t]));

    // Let go of bundles no longer wanted (or wanted at another version).
    for (const key of Array.from(held.keys())) {
      if (!wanted.has(key)) {
        releaseBundle(key);
        held.delete(key);
      }
    }

    // Publish what is loaded now (covers the release-only case), then again
    // as each load settles, so one slow bundle never holds back the plugins
    // whose bundles already arrived.
    const publish = () => {
      const next = new Map<string, string>();
      for (const [key, installId] of held) {
        const url = peekBundle(key);
        if (url) next.set(installId, url);
      }
      setBlobs(next);
    };
    publish();
    for (const target of loadTargets) {
      if (held.has(target.key)) continue;
      held.set(target.key, target.installId);
      acquireBundle(target.key, target.bundle).then(
        () => {
          if (held.has(target.key)) publish();
        },
        (err: unknown) => {
          // A released key was dropped on purpose; a failed load leaves the
          // key unheld so the next install-set change retries it.
          if (!held.delete(target.key)) return;
          console.warn("plugin_bundle_load_failed", {
            installId: target.installId,
            error: err instanceof Error ? err.message : String(err),
          });
        },
      );
    }
  }, [loadTargets]);

  // ── Handler lifecycle (shared, ref-counted) ─────────────────────────
  // Surfaces this host holds in the shared cache, by cache key.
  const heldHandlersRef = useRef<Map<string, Record<string, BridgeHandler>>>(new Map());
  const [handlers, setHandlers] = useState<
    ReadonlyMap<string, Record<string, BridgeHandler>>
  >(() => new Map());

  const activePluginIdsKey = useMemo(
    () =>
      Array.from(new Set((slotRows ?? []).map((r) => r.pluginId)))
        .sort()
        .join("|"),
    [slotRows],
  );

  useEffect(() => {
    const held = heldHandlersRef.current;
    const pluginIds = activePluginIdsKey ? activePluginIdsKey.split("|") : [];
    const wanted = new Map(pluginIds.map((id) => [handlerKey(id, deviceId), id]));

    // Let go of plugins that left the set or belong to another drone.
    for (const key of Array.from(held.keys())) {
      if (!wanted.has(key)) {
        releaseHandlers(key);
        held.delete(key);
      }
    }

    // The factory has no immediate side effects (telemetry subscriptions open
    // only when the iframe calls telemetry.subscribe), so this is safe here.
    const next = new Map<string, Record<string, BridgeHandler>>();
    for (const [key, pluginId] of wanted) {
      let surface = held.get(key);
      if (!surface) {
        surface = acquireHandlers(key, () =>
          buildPluginHandlers(pluginId, deviceId, { translate, cloudQuery }),
        );
        held.set(key, surface);
      }
      next.set(pluginId, surface);
    }
    setHandlers(next);
  }, [activePluginIdsKey, deviceId, translate, cloudQuery]);

  // ── Teardown: drop every reference this host holds on unmount ───────
  useEffect(() => {
    const heldBundles = heldBundlesRef.current;
    const heldHandlers = heldHandlersRef.current;
    return () => {
      for (const key of heldBundles.keys()) releaseBundle(key);
      heldBundles.clear();
      for (const key of heldHandlers.keys()) releaseHandlers(key);
      heldHandlers.clear();
    };
  }, []);

  // ── Build the stable, sorted contribution list ──────────────────────
  return useMemo(() => {
    // demo mode does not mount real plugin iframes
    if (isDemoMode()) return EMPTY;
    if (!slotRows) return EMPTY;

    const built: Array<{ contribution: SlottedContribution; order: number }> =
      [];
    for (const row of slotRows) {
      const blobUrl = blobs.get(row.installId);
      if (!blobUrl) continue; // omit until the bundle blob is ready
      const pluginHandlers = handlers.get(row.pluginId);
      if (!pluginHandlers) continue; // omit until handlers are built
      const grantedCapabilities = new Set(row.grantedCaps);
      for (const entry of row.gcsContributes) {
        if (!entryMounts(entry, slot, nodeProfile)) continue;
        built.push({
          order: typeof entry.order === "number" ? entry.order : DEFAULT_ORDER,
          contribution: {
            slot: entry.slot,
            pluginId: row.pluginId,
            panelId: entry.panelId,
            title: entry.title ?? row.name,
            bundleUrl: blobUrl,
            grantedCapabilities,
            handlers: pluginHandlers,
            pluginInstallId: row.installId,
          },
        });
      }
    }

    if (built.length === 0) return EMPTY;
    built.sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return a.contribution.pluginId.localeCompare(b.contribution.pluginId);
    });
    return built.map((b) => b.contribution);
  }, [slotRows, blobs, handlers, slot, nodeProfile]);
}
