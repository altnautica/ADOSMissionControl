"use client";

/**
 * @module DronePluginsList
 * @description The list body of the per-drone Plugins tab. Renders one
 * `<DronePluginCard>` per install row scoped to this drone. Three sources
 * merge by plugin id, first wins: the Convex install table
 * (`cmdPlugins:listForDevice`), the node's own install list over the LAN
 * (`GET /api/plugins`) when it is LAN-paired, and the heartbeat inventory.
 * In demo mode it surfaces fixture installs from `mock-plugins.ts`.
 *
 * "Loading" renders only while the Convex query is genuinely in flight and no
 * other source has produced a card. A skipped query (no deployment, local-only
 * mode) or a failed one counts as an empty Convex list, so a LAN-only GCS
 * lists what the node has installed instead of loading forever.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "../../../../convex/_generated/api";

import { isDemoMode } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";
import { useConvexSkipQueryState } from "@/hooks/use-convex-skip-query";
import {
  PluginAgentClient,
  type PluginAgentManifestDetail,
} from "@/lib/agent/plugin-client";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { useLocalPluginInstallsStore } from "@/stores/local-plugin-installs-store";
import {
  getDemoDronePluginSummaries,
  getDemoDronePluginInstalls,
} from "@/mock/mock-plugins";
import type {
  PluginInstallStatus,
  PluginSource,
} from "@/lib/plugins/types";
import { useAgentPluginInventoryStore } from "@/stores/agent-plugin-inventory-store";

import {
  DronePluginCard,
  type DronePluginCardData,
} from "./DronePluginCard";

interface DronePluginsListProps {
  /** Drone the list is scoped to. */
  agentId: string;
  /** Optional class on the list wrapper. */
  className?: string;
  /** Render fallback when the list is empty. */
  emptyState?: React.ReactNode;
}

/** Hard ceiling on inventory entries that survive the heartbeat
 *  poisoning filter. A real drone has dozens at most; anything
 *  beyond this is either misconfigured or hostile. */
const INVENTORY_RENDER_CAP = 50;

/** Reverse-DNS-style plugin id (matches the agent-side validator).
 *  Anchored on both ends so a tampered heartbeat cannot smuggle
 *  HTML, control characters, or shell metacharacters into the
 *  rendered name. */
const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9._-]{1,127}$/;

const PLUGIN_SOURCES: readonly PluginSource[] = [
  "local_file",
  "git_url",
  "registry",
  "builtin",
  "agent_webapp",
];

type LanInstall = PluginAgentManifestDetail["install"];

const NO_LAN_INSTALLS: LanInstall[] = [];

/** The node's own install list over the LAN, when it is LAN-paired. Empty
 * until it answers, on a failed read, or for a node with no LAN pairing.
 * Re-read when a local install for this node lands. */
function useLanInstalls(deviceId: string): LanInstall[] {
  const node = useLocalNodesStore((s) =>
    s.nodes.find((n) => n.deviceId === deviceId),
  );
  const agentUrl = node?.hostname ?? null;
  const apiKey = node?.apiKey ?? null;
  const localInstalls = useLocalPluginInstallsStore((s) => s.installs);
  const installKey = useMemo(
    () =>
      localInstalls
        .filter((i) => i.deviceId === deviceId)
        .map((i) => i.pluginId)
        .sort()
        .join(","),
    [localInstalls, deviceId],
  );
  const [read, setRead] = useState<{ key: string; rows: LanInstall[] } | null>(
    null,
  );
  const key = `${deviceId}|${agentUrl ?? ""}`;

  useEffect(() => {
    if (isDemoMode() || !agentUrl || !apiKey) return;
    let current = true;
    new PluginAgentClient(agentUrl, apiKey)
      .list()
      .then(({ installs }) => {
        if (current) setRead({ key, rows: installs });
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [key, agentUrl, apiKey, installKey]);

  // A list read from another node never renders here.
  return read !== null && read.key === key ? read.rows : NO_LAN_INSTALLS;
}

export function DronePluginsList({
  agentId,
  className,
  emptyState,
}: DronePluginsListProps) {
  const t = useTranslations("dronePlugins");

  // Run the Convex listForDevice query unconditionally (modulo demo
  // mode + a real agentId). The query already returns an empty list
  // for unauthenticated callers, which is the correct UX for LAN-only
  // mode where the operator has no Convex identity but still needs
  // the empty-state to surface instead of a perpetual loading spinner.
  // Cloud-relay sessions with a real auth identity still get their
  // proper install list.
  const { data: installs, state: installsState } = useConvexSkipQueryState(
    api.cmdPlugins.listForDevice,
    {
      args: { deviceId: agentId },
      enabled: Boolean(agentId) && !isDemoMode(),
    },
  );
  const lanInstalls = useLanInstalls(agentId);

  // Webapp-side installs the agent reported via heartbeat. The Convex
  // table stays the authority; this surfaces only entries that the
  // GCS-side query did not yet see (the operator installed straight
  // from the agent dashboard at port 8080 with no cloud account).
  const inventory = useAgentPluginInventoryStore(
    (s) => s.byDevice[agentId],
  );

  // In demo mode the list reads from a static fixture set so the per-
  // drone tab is observable without Convex. The mock module exposes a
  // shape compatible with the production card.
  const cards = useMemo<DronePluginCardData[]>(() => {
    if (isDemoMode()) {
      const summaries = getDemoDronePluginSummaries(agentId);
      const rows = getDemoDronePluginInstalls(agentId);
      return summaries.map((s, i) => ({
        ...s,
        installId: rows[i]?.installId ?? `demo-install-${i}`,
        deviceId: agentId,
      }));
    }
    const convexRows = installs ?? [];
    const fromConvex: DronePluginCardData[] = convexRows.map((row) => ({
      pluginId: row.pluginId,
      version: row.version,
      name: row.name,
      source: row.source,
      signerId: row.signerId,
      status: row.status,
      halves: row.halves,
      installId: String(row._id),
      // The query selects this drone's rows, so the card's device is the list's.
      deviceId: agentId,
    }));
    // Merge agent-reported inventory entries that the Convex query
    // did not return. These are typically webapp installs done on
    // the drone itself before the GCS knew about them. The cap and
    // the plugin_id regex bound the surface area against a heartbeat
    // that an attacker-controlled relay tampered with: anything
    // beyond INVENTORY_RENDER_CAP entries or any id that does not
    // match the canonical reverse-DNS plugin namespace gets dropped
    // before it reaches the render path.
    const seen = new Set(fromConvex.map((c) => c.pluginId));
    // The node's own install list: authoritative for what is on the node,
    // but carries none of the GCS-side install metadata.
    const fromLan: DronePluginCardData[] = [];
    for (const install of lanInstalls) {
      if (!PLUGIN_ID_RE.test(install.plugin_id) || seen.has(install.plugin_id)) {
        continue;
      }
      seen.add(install.plugin_id);
      const source = PLUGIN_SOURCES.find((s) => s === install.source);
      fromLan.push({
        pluginId: install.plugin_id,
        version: install.version,
        name: install.plugin_id,
        source: source ?? "agent_webapp",
        signerId: install.signer_id ?? undefined,
        status: install.status as PluginInstallStatus,
        halves: ["agent"],
        installId: `lan:${install.plugin_id}`,
        deviceId: agentId,
      });
    }
    const fromAgent: DronePluginCardData[] = (inventory ?? [])
      .filter(
        (entry) =>
          entry.plugin_id &&
          PLUGIN_ID_RE.test(entry.plugin_id) &&
          !seen.has(entry.plugin_id),
      )
      .slice(0, INVENTORY_RENDER_CAP)
      .map((entry) => ({
        pluginId: entry.plugin_id,
        version: entry.version ?? "—",
        name: entry.plugin_id,
        // Webapp installs report no GCS-side metadata. The status pill
        // still renders from ``status`` so the operator sees what the
        // agent reports.
        source: "agent_webapp" as PluginSource,
        signerId: undefined,
        status: (entry.status ?? "unknown") as PluginInstallStatus,
        halves: ["agent"] as Array<"agent" | "gcs">,
        installId: `agent:${entry.plugin_id}`,
        deviceId: agentId,
        // Model-delivery outcome the agent reported for this plugin's
        // declared models (resolved / needs-model / verify-failed).
        modelStatus: entry.model_status ?? undefined,
        // Per-service readiness the agent reported for this plugin's
        // declared services (ready / not-ready with a reason).
        serviceStatus: entry.service_status ?? undefined,
      }));
    return [...fromConvex, ...fromLan, ...fromAgent];
  }, [agentId, installs, lanInstalls, inventory]);

  // Loading only while the Convex query is in flight and nothing else has
  // produced a card: a skipped or failed query is an empty Convex list.
  if (installsState === "loading" && cards.length === 0) {
    return (
      <p className="py-8 text-center text-xs text-text-tertiary">
        {t("loading")}
      </p>
    );
  }

  if (cards.length === 0) {
    return <>{emptyState}</>;
  }

  return (
    <PluginCardList cards={cards} className={className} />
  );
}

const RING_CLASSES = ["ring-2", "ring-accent-primary/60", "rounded-lg"];

/** Renders the card list and reveals the plugin a deep-link (e.g. a
 * plugin-owned camera's "Managed by" link) asked to surface, scrolling it into
 * view and briefly highlighting it. */
function PluginCardList({
  cards,
  className,
}: {
  cards: DronePluginCardData[];
  className?: string;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const pendingPluginId = useUiStore((s) => s.pendingPluginId);
  const setPendingPluginId = useUiStore((s) => s.setPendingPluginId);
  // The ring's removal outlives the effect run that adds it: clearing
  // `pendingPluginId` re-runs the effect straight away, and a cleanup there
  // cancelled the removal and left the ring on for good. Cleared on unmount.
  const ring = useRef<{ el: HTMLElement; timer: ReturnType<typeof setTimeout> } | null>(null);

  useEffect(
    () => () => {
      if (ring.current) clearTimeout(ring.current.timer);
    },
    [],
  );

  useEffect(() => {
    if (!pendingPluginId) return;
    const el = Array.from(listRef.current?.children ?? []).find(
      (c) => (c as HTMLElement).dataset.pluginId === pendingPluginId,
    ) as HTMLElement | undefined;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    if (ring.current) {
      clearTimeout(ring.current.timer);
      ring.current.el.classList.remove(...RING_CLASSES);
    }
    el.classList.add(...RING_CLASSES);
    setPendingPluginId(null);
    ring.current = {
      el,
      timer: setTimeout(() => {
        el.classList.remove(...RING_CLASSES);
        ring.current = null;
      }, 2000),
    };
  }, [pendingPluginId, cards, setPendingPluginId]);

  return (
    <ul
      ref={listRef}
      data-testid="drone-plugins-list"
      className={className ?? "flex flex-col gap-2"}
    >
      {cards.map((c) => (
        <li key={c.installId} data-plugin-id={c.pluginId}>
          <DronePluginCard install={c} />
        </li>
      ))}
    </ul>
  );
}
