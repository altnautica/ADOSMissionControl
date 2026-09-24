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
 *   - Bundles: the Convex query hands back a short-lived SIGNED URL per
 *     iframe install; a blob URL is null-origin and is what the sandboxed
 *     iframe needs. An inline install (a trusted first-party module) is
 *     always loaded from its node's agent under that node's attestation, in
 *     signed-in mode too. Bundles live in the shared
 *     `plugin-contribution-cache`, loaded once per `(installId, version)`
 *     however many slot hosts ask, and released when the last host lets go.
 *     An iframe contribution is omitted until its blob is ready, so no iframe
 *     ever mounts against an empty src; an inline contribution is listed
 *     while it loads and when it fails, so the slot shows why.
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
  type LoadedBundle,
} from "@/hooks/plugin-contribution-cache";
import { buildPluginHandlers } from "@/lib/plugins/handlers";
import { createConvexRecordsBackend } from "@/lib/plugins/handlers/records";
import type { BridgeHandler } from "@/lib/plugins/bridge";
import type {
  InlineMountState,
  PluginSlotContribution,
} from "@/components/plugins/PluginHostProvider";
import {
  PLUGIN_SLOTS,
  slotOffersOnProfile,
  slotToCapability,
  type GcsContributeRow,
  type PluginSlotName,
  type PairedNodeProfile,
} from "@/lib/plugins/types";
import {
  DEMO_INLINE_FIXTURE_MODULE,
  DEMO_INLINE_FIXTURE_PANEL_ID,
  DEMO_INLINE_FIXTURE_PLUGIN_ID,
} from "@/mock/inline-fixture-plugin";

/** Slot fallback sort hint, matching the slot-13 contract default. */
const DEFAULT_ORDER = 60;

/** A renderable contribution carrying the slot it mounts into. */
type SlottedContribution = PluginSlotContribution & { slot: PluginSlotName };

/** Source-agnostic install row the bundle + handler + builder pipeline reads,
 * unifying the Convex query rows and the local agent-detail rows. */
interface NormalizedRow {
  installId: string;
  pluginId: string;
  version: string;
  name: string;
  grantedCaps: string[];
  gcsContributes: GcsContributeRow[];
  /** Null when the install has no loadable GCS bundle yet (agent-only, or
   * a cloud row whose bundle has not finished uploading). */
  bundle: BundleSource | null;
  /** Why an inline install has no source here (it is shown, not dropped). */
  inlineUnavailable?: string;
}

const EMPTY: ReadonlyArray<SlottedContribution> = Object.freeze([]);

const KNOWN_SLOTS = new Set<string>(PLUGIN_SLOTS);
function isKnownSlot(slot: string): slot is PluginSlotName {
  return KNOWN_SLOTS.has(slot);
}

/** Whether a manifest entry mounts in `slot` (any slot when unset) on a node of
 * `nodeProfile`: a known slot, with a per-node page slot profile-narrowed to
 * the node, matching the header/body filter so an off-profile page never
 * mounts. */
function entryMounts(
  entry: GcsContributeRow,
  slot: PluginSlotName | undefined,
  nodeProfile: PairedNodeProfile | undefined,
): entry is GcsContributeRow & { slot: PluginSlotName } {
  return (
    (!slot || entry.slot === slot) &&
    isKnownSlot(entry.slot) &&
    slotOffersOnProfile(entry.slot, entry.profile, nodeProfile)
  );
}

/** The demo fixture's inline Agent page on a drone: the in-memory module
 * handed straight to the host (no trust gate, no agent). */
function demoInlineContributions(
  deviceId: string | null,
  slot: PluginSlotName | undefined,
  nodeProfile: PairedNodeProfile | undefined,
): ReadonlyArray<SlottedContribution> {
  const entry: GcsContributeRow = {
    slot: "node.agent.page",
    panelId: DEMO_INLINE_FIXTURE_PANEL_ID,
    profile: ["drone"],
  };
  if (deviceId === null || !entryMounts(entry, slot, nodeProfile)) return EMPTY;
  return [
    {
      slot: "node.agent.page",
      pluginId: DEMO_INLINE_FIXTURE_PLUGIN_ID,
      panelId: DEMO_INLINE_FIXTURE_PANEL_ID,
      title: "Inline Fixture",
      bundleUrl: "",
      isolation: "inline",
      inline: {
        status: "ready",
        bundle: {
          kind: "inline",
          module: DEMO_INLINE_FIXTURE_MODULE,
          trust: {
            pluginId: DEMO_INLINE_FIXTURE_PLUGIN_ID,
            version: "0.0.0-demo",
            signerId: "demo",
            entrypoint: "gcs/fixture.mjs",
            paths: [],
          },
          readAsset: () => Promise.reject(new Error("the demo fixture ships no assets")),
        },
      },
      grantedCapabilities: new Set([slotToCapability("node.agent.page")]),
      handlers: {},
      pluginInstallId: DEMO_INLINE_FIXTURE_PLUGIN_ID,
    },
  ];
}

/**
 * Live plugin contributions for a drone (or fleet-wide when `deviceId` is
 * null), optionally narrowed to a single `slot`. `nodeProfile` is the
 * resolved profile of the node these contributions mount on; a per-node page
 * (`node.detail.tab`, `node.agent.page`, `node.surface`) that declares a
 * `profile` narrowing is dropped when the node's profile is not in the set.
 * Other slots ignore `nodeProfile`. Returns a stable memoized array (same
 * identity while the install set, loaded bundles, and built handlers are
 * unchanged) sorted by manifest `order` then `pluginId`. Returns `[]` when
 * unauthenticated, before the query resolves, or while iframe bundles are
 * still loading; demo mode yields only the inline fixture page.
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
  // GCS bundle, so the plugin mounts with no cloud. Null in cloud/demo.
  const localDetail = useLocalAgentPlugins(deviceId);

  // Unify the two sources into one row shape. Everything downstream (bundle
  // lifecycle, handler lifecycle, contribution builder) reads `rows`, so
  // the only difference between cloud and local is the bundle SOURCE. An
  // inline install always loads from its node's agent, whichever source
  // listed it; with no node to load from it is listed as unavailable.
  const rows = useMemo<NormalizedRow[] | null>(() => {
    if (isDemoMode()) return [];
    const inlineSource = (pluginId: string): Pick<NormalizedRow, "bundle" | "inlineUnavailable"> =>
      deviceId === null
        ? { bundle: null, inlineUnavailable: "plugins.inlineNeedsNode" }
        : { bundle: { kind: "node", deviceId, pluginId } };
    if (isAuthenticated) {
      if (!installs) return null;
      return installs.map((r) => ({
        installId: String(r.installId),
        pluginId: r.pluginId,
        version: r.version,
        name: r.name,
        grantedCaps: r.grantedCaps,
        gcsContributes: r.gcsContributes,
        ...(r.gcsIsolation === "inline"
          ? inlineSource(r.pluginId)
          : {
              bundle:
                typeof r.bundleUrl === "string" && r.bundleUrl.length > 0
                  ? { kind: "url" as const, url: r.bundleUrl }
                  : null,
            }),
      }));
    }
    if (!localDetail) return null;
    return localDetail.map((r): NormalizedRow => {
      const base = {
        installId: r.installId,
        pluginId: r.pluginId,
        version: r.version,
        name: r.name,
        grantedCaps: r.grantedCaps,
        gcsContributes: r.gcsContributes,
      };
      if (r.bundle?.kind === "agent") {
        if (r.bundle.isolation === "inline") return { ...base, ...inlineSource(r.pluginId) };
        const { agentUrl, apiKey, entrypoint } = r.bundle;
        return { ...base, bundle: { kind: "agent", agentUrl, apiKey, pluginId: r.pluginId, entrypoint } };
      }
      if (r.bundle?.kind === "archive") {
        const { archiveUrl, entrypoint, pin } = r.bundle;
        return { ...base, bundle: { kind: "archive", archiveUrl, entrypoint, pin, pluginId: r.pluginId } };
      }
      return { ...base, bundle: null };
    });
  }, [isAuthenticated, installs, localDetail, deviceId]);

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
  // The plugin's own cloud records; the backend checks sign-in per call.
  const recordsBackend = useMemo(() => createConvexRecordsBackend(convex), [convex]);

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

  // ── Bundle lifecycle (shared, ref-counted) ──────────────────────────
  // Keys this host holds in the shared cache, mapped to their install id.
  const heldBundlesRef = useRef<Map<string, string>>(new Map());
  const [loaded, setLoaded] = useState<ReadonlyMap<string, LoadedBundle>>(() => new Map());
  // Inline installs whose load failed, by install id: shown with a retry.
  const [inlineErrors, setInlineErrors] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  // Bumped by a retry so the load effect re-acquires what failed.
  const [retryNonce, setRetryNonce] = useState(0);
  const retry = useCallback(() => setRetryNonce((n) => n + 1), []);

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
      const next = new Map<string, LoadedBundle>();
      for (const [key, installId] of held) {
        const view = peekBundle(key);
        if (view) next.set(installId, view);
      }
      setLoaded(next);
    };
    publish();
    for (const target of loadTargets) {
      if (held.has(target.key)) continue;
      held.set(target.key, target.installId);
      setInlineErrors((prev) => {
        if (!prev.has(target.installId)) return prev;
        const next = new Map(prev);
        next.delete(target.installId);
        return next;
      });
      acquireBundle(target.key, target.bundle).then(
        () => {
          if (held.has(target.key)) publish();
        },
        (err: unknown) => {
          // A released key was dropped on purpose; a failed load leaves the
          // key unheld so a retry or the next install-set change reloads it.
          if (!held.delete(target.key)) return;
          const message = err instanceof Error ? err.message : String(err);
          if (target.bundle.kind === "node") {
            setInlineErrors((prev) => new Map(prev).set(target.installId, message));
          }
          console.warn("plugin_bundle_load_failed", { installId: target.installId, error: message });
        },
      );
    }
  }, [loadTargets, retryNonce]);

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
    // only when the plugin calls telemetry.subscribe), so this is safe here.
    const next = new Map<string, Record<string, BridgeHandler>>();
    for (const [key, pluginId] of wanted) {
      let surface = held.get(key);
      if (!surface) {
        surface = acquireHandlers(key, () =>
          buildPluginHandlers(pluginId, deviceId, {
            translate,
            cloudQuery,
            records: recordsBackend,
          }),
        );
        held.set(key, surface);
      }
      next.set(pluginId, surface);
    }
    setHandlers(next);
  }, [activePluginIdsKey, deviceId, translate, cloudQuery, recordsBackend]);

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
    if (isDemoMode()) return demoInlineContributions(deviceId, slot, nodeProfile);
    if (!slotRows) return EMPTY;

    const built: Array<{ contribution: SlottedContribution; order: number }> = [];
    for (const row of slotRows) {
      const view = loaded.get(row.installId);
      const pluginHandlers = handlers.get(row.pluginId);
      if (!pluginHandlers) continue; // omit until handlers are built
      // Inline when its source says so, or its (archive) bundle loaded inline.
      let inlineState: InlineMountState | undefined;
      if (view?.kind === "inline") {
        inlineState = { status: "ready", bundle: view };
      } else if (row.inlineUnavailable !== undefined) {
        inlineState = { status: "error", message: t(row.inlineUnavailable), retry };
      } else if (row.bundle?.kind === "node") {
        const error = inlineErrors.get(row.installId);
        inlineState =
          error !== undefined ? { status: "error", message: error, retry } : { status: "loading" };
      } else if (view?.kind !== "frame") {
        continue; // omit an iframe until its blob is ready
      }
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
            bundleUrl: view?.kind === "frame" ? view.blobUrl : "",
            ...(inlineState ? { isolation: "inline" as const, inline: inlineState } : {}),
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
  }, [slotRows, loaded, handlers, inlineErrors, retry, slot, nodeProfile, deviceId, t]);
}
