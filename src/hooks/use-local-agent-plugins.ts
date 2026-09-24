"use client";

/**
 * @module use-local-agent-plugins
 * @description The local-first source of truth for a node's installed
 * plugin contributions. When the operator is NOT signed in to the cloud
 * (local-first), the Convex contribution queries are skipped and
 * this hook stands in: it resolves the LAN-paired agent for `deviceId`
 * (host + apiKey from `local-nodes-store`), reads what that agent reports
 * installed and live (`GET /api/plugins`, via `useNodePluginList`), and
 * fetches each live plugin's authoritative detail from the agent's
 * `GET /api/plugins/{id}` — exactly the role Convex plays in cloud mode.
 * A plugin installed by the agent installer or the agent CLI mounts like
 * one installed from this browser.
 *
 * The agent's detail carries the live install `status`, the granted
 * capabilities, and the full `gcs.contributes` block (panels / overlays /
 * notifications / skills). This hook normalizes the raw manifest dicts
 * into the same shapes the cloud contribution producers already consume
 * (`{ slot, panelId, ... }` slot entries, camelCase flight-skill rows), so
 * the three mount hooks branch onto it with no shape drift.
 *
 * Bundle bytes are fetched separately by the body producer
 * (`use-plugin-contributions`) via `getGcsBundle`; this hook hands back the
 * `agentUrl` / `apiKey` / `entrypoint` / `isolation` it needs to do so.
 *
 * Returns `null` while loading (or when not in local mode), and an array
 * (possibly empty) of the node's enabled / running plugins once the agent
 * has answered.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { isDemoMode } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { NODE_PLUGIN_LIST_POLL_MS, useNodePluginList } from "@/hooks/use-node-plugin-list";
import {
  useLocalPluginInstallsStore,
  type LocalPluginInstall,
} from "@/stores/local-plugin-installs-store";
import { PluginAgentClient } from "@/lib/agent/plugin-client";
import type { ArchivePin } from "@/lib/plugins/archive-pin";
import { parseParameterContributions } from "@/lib/plugins/parameters/parse";
import { parseTabContributions } from "@/lib/plugins/contributions/parse";
import { parseNodePageContributions } from "@/lib/plugins/contributions/node-pages";
import type { PluginParameter } from "@/lib/plugins/parameters/schema";
import type {
  GcsContributeRow,
  GcsIsolation,
  PairedNodeProfile,
} from "@/lib/plugins/types";

/** One normalized slot contribution, matching the cloud `gcsContributes`
 * row shape so the body + header hooks consume it unchanged. */
export type LocalAgentGcsContribution = GcsContributeRow;

/** One normalized flight-skill row, matching the camelCase shape the
 * skill hook reads (manifest `arm_requirement`/`activation.config_key`/
 * `state.topic` flattened + renamed). */
export interface LocalAgentSkillRow {
  id?: string;
  label?: string;
  icon?: string;
  category?: "behavior" | "camera" | "navigation" | "utility";
  toggle?: boolean;
  confirm?: boolean;
  armRequirement?: "any" | "armed" | "disarmed" | null;
  configKey?: string;
  stateTopic?: string;
  defaultBinding?: { key?: string | null; gamepadButton?: number | null };
}

/** One normalized target-action row, matching the camelCase shape the
 * target-action hook reads off an install row (manifest
 * `applies_to_class`/`config_key`/`config_value`/`default_key` renamed). */
export interface LocalAgentTargetActionRow {
  id?: string;
  label?: string;
  icon?: string;
  order?: number;
  appliesToClass?: string;
  designate?: boolean;
  configKey?: string;
  configValue?: boolean;
  defaultKey?: string;
}

/** Where this install's GCS bundle is fetched from when mounting
 * local-first. `agent` = the LAN-paired drone that unpacked the archive
 * serves it (an iframe bundle, or an inline module loaded under the node's
 * attestation); `archive` = a fleet / GCS-only plugin whose bundle comes from
 * the published archive (via the same-origin proxy + client-side extract),
 * with no drone involved. */
export type LocalAgentBundleSource =
  | {
      kind: "agent";
      agentUrl: string;
      apiKey: string;
      entrypoint: string;
      isolation: GcsIsolation;
    }
  | { kind: "archive"; archiveUrl: string; entrypoint: string; pin: ArchivePin };

/** Authoritative per-plugin detail for one locally-installed plugin. */
export interface LocalAgentPluginDetail {
  /** Synthetic stable id (`${deviceId ?? "fleet"}::${pluginId}`) for keying. */
  installId: string;
  pluginId: string;
  version: string;
  name: string;
  /** Live agent install status (enabled / running). */
  status: string;
  /** Capability ids the agent reports as granted. */
  grantedCaps: string[];
  /** Slot contributions (panels + overlays + notifications), normalized. */
  gcsContributes: LocalAgentGcsContribution[];
  /** Declarative parameter contributions the native panel renders. */
  gcsParameters: PluginParameter[];
  /** Flight-skill contributions, normalized to the cloud row shape. */
  flightSkills: LocalAgentSkillRow[];
  /** Target-action contributions, normalized to the reader's row shape. */
  targetActions: LocalAgentTargetActionRow[];
  /** The GCS iframe entrypoint, or null for an agent-only plugin. */
  entrypoint: string | null;
  /** Where the producer fetches the iframe bundle from, or null when the
   * plugin ships no GCS half (agent-only). */
  bundle: LocalAgentBundleSource | null;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Map a raw manifest panel/overlay/notification dict to the normalized
 * slot-entry shape. Returns null when it lacks a usable slot + id. */
function mapSlotEntry(raw: unknown): LocalAgentGcsContribution | null {
  if (!isObj(raw)) return null;
  const slot = str(raw.slot);
  const panelId = str(raw.id);
  if (!slot || !panelId) return null;
  return {
    slot,
    panelId,
    title: str(raw.title),
    icon: str(raw.icon),
    order: typeof raw.order === "number" ? raw.order : undefined,
  };
}

/** Map a raw manifest skill dict to the normalized camelCase row. */
function mapSkill(raw: unknown): LocalAgentSkillRow | null {
  if (!isObj(raw)) return null;
  const activation = isObj(raw.activation) ? raw.activation : {};
  const state = isObj(raw.state) ? raw.state : {};
  const db = isObj(raw.default_binding) ? raw.default_binding : undefined;
  const arm = raw.arm_requirement;
  return {
    id: str(raw.id),
    label: str(raw.label),
    icon: str(raw.icon),
    category:
      raw.category === "behavior" ||
      raw.category === "camera" ||
      raw.category === "navigation" ||
      raw.category === "utility"
        ? raw.category
        : undefined,
    toggle: raw.toggle === true,
    confirm: raw.confirm === true,
    armRequirement:
      arm === "armed" || arm === "disarmed" || arm === "any" ? arm : null,
    configKey: str(activation.config_key),
    stateTopic: str(state.topic),
    defaultBinding: db
      ? {
          key: typeof db.key === "string" ? db.key : null,
          gamepadButton:
            typeof db.gamepadButton === "number"
              ? db.gamepadButton
              : typeof db.gamepad_button === "number"
                ? db.gamepad_button
                : null,
        }
      : undefined,
  };
}

/** Map a raw manifest target-action dict to the normalized camelCase row.
 * Reads the snake_case manifest keys (with a camelCase fallback) so the
 * agent's `/plugins` detail and a cloud install row land in one shape. */
function mapTargetAction(raw: unknown): LocalAgentTargetActionRow | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id);
  if (!id) return null;
  const configValue = raw.config_value ?? raw.configValue;
  return {
    id,
    label: str(raw.label),
    icon: str(raw.icon),
    order: typeof raw.order === "number" ? raw.order : undefined,
    appliesToClass: str(raw.applies_to_class ?? raw.appliesToClass),
    designate: raw.designate === true,
    configKey: str(raw.config_key ?? raw.configKey),
    configValue: typeof configValue === "boolean" ? configValue : undefined,
    defaultKey: str(raw.default_key ?? raw.defaultKey),
  };
}

/**
 * Map a fleet / GCS-only local install record (`deviceId === null`) to the
 * normalized detail shape, straight from `local-plugin-installs-store`.
 * Unlike a per-node install, a fleet plugin has no LAN agent to query — its
 * authoritative detail (contributes, granted caps, version) was captured into
 * the store at install time, and its bundle comes from the published archive.
 */
function fleetRecordToDetail(install: LocalPluginInstall): LocalAgentPluginDetail {
  const { archiveUrl, entrypoint, pin } = install.bundle;
  return {
    installId: `fleet::${install.pluginId}`,
    pluginId: install.pluginId,
    version: install.version,
    name: install.name,
    // A local install record carries no live agent status; the operator just
    // installed + approved it, so it is live on this GCS (the cloud path
    // gets its status from the install row instead).
    status: "enabled",
    grantedCaps: install.grantedCaps,
    gcsContributes: install.gcsContributes,
    gcsParameters: install.gcsParameters ?? [],
    flightSkills: [],
    targetActions: [],
    entrypoint,
    bundle: { kind: "archive", archiveUrl, entrypoint, pin },
  };
}

/**
 * Local-first plugin detail for `deviceId`. Returns `null` when not in
 * local mode (signed in, or demo) or while the agent fetch is in flight;
 * an array (possibly empty) once resolved.
 *
 *   - `deviceId` set → per-node: the node's own install list names what is
 *     installed and live; each live plugin's authoritative detail comes from
 *     the same agent.
 *   - `deviceId === null` → fleet / GCS-only: read the fleet installs straight
 *     from `local-plugin-installs-store` (their detail was captured at install
 *     time; their bundle comes from the published archive), so a GCS-level
 *     plugin installed local-first mounts into the fleet slots with
 *     no cloud and no drone.
 */
export function useLocalAgentPlugins(
  deviceId: string | null,
): LocalAgentPluginDetail[] | null {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const node = useLocalNodesStore((s) =>
    deviceId ? s.nodes.find((n) => n.deviceId === deviceId) : undefined,
  );
  const localInstalls = useLocalPluginInstallsStore((s) => s.installs);

  const localMode = !isAuthenticated && !isDemoMode();

  // Fleet (null-device) local-first source: GCS-level plugins installed over
  // the LAN with no drone. Resolved synchronously from the install store —
  // there is no agent to query. Returns null in cloud/demo so the cloud
  // producer wins, and `[]` when local-first with no fleet installs.
  const fleetRows = useMemo<LocalAgentPluginDetail[] | null>(() => {
    if (!localMode || deviceId !== null) return null;
    return localInstalls.filter((i) => i.deviceId === null).map(fleetRecordToDetail);
  }, [localMode, deviceId, localInstalls]);

  // Active only when local-first per-node: signed out, not demo, a real
  // device, and we hold a LAN key for it. Otherwise the cloud producers own
  // the surface (or the fleet branch above handles the null-device case).
  const active =
    localMode &&
    Boolean(deviceId) &&
    Boolean(node?.hostname) &&
    Boolean(node?.apiKey);

  const agentUrl = node?.hostname ?? "";
  const apiKey = node?.apiKey ?? "";

  // What the node itself reports installed. Only an enabled or running
  // install contributes (the cloud `listForDeviceWithDetail` filter), so
  // only those are fetched. Null until the node answers.
  const nodeList = useNodePluginList(active ? deviceId : null);
  const liveInstalls = useMemo(
    () =>
      nodeList?.filter((i) => i.status === "enabled" || i.status === "running") ??
      null,
    [nodeList],
  );
  // A detail is re-read when the live set or a version changes, not on every
  // poll of the list.
  const fetchKey = useMemo(() => {
    if (!active || liveInstalls === null) return "";
    const ids = liveInstalls.map((i) => `${i.plugin_id}@${i.version}`).sort();
    return `${deviceId}|${agentUrl}|${ids.join(",")}`;
  }, [active, liveInstalls, deviceId, agentUrl]);

  // Rows are held with the key they were read for, so a stale read never
  // renders under a new node or a new live set.
  const [read, setRead] = useState<{
    key: string;
    rows: LocalAgentPluginDetail[];
  } | null>(null);
  // Bumped to re-read a detail that failed, on the same fixed interval as
  // the list poll.
  const [retry, setRetry] = useState(0);
  // Hold the latest apiKey without re-running the fetch when only the key
  // identity changes (it rarely does); the fetchKey gates real reloads.
  const apiKeyRef = useRef(apiKey);
  apiKeyRef.current = apiKey;

  useEffect(() => {
    if (!fetchKey || !deviceId || !liveInstalls) return;
    let cancelled = false;
    let stopRetry = () => {};
    const client = new PluginAgentClient(agentUrl, apiKeyRef.current);

    void Promise.all(
      liveInstalls.map(async ({ plugin_id: pluginId }): Promise<LocalAgentPluginDetail | null> => {
        try {
          const detail = await client.get(pluginId);
          const gcs = detail.manifest.gcs ?? null;
          // The `tabs[]` array carries the per-tab `profile` narrowing; the
          // node.detail.tab slot itself comes through `panels`. Build a
          // panelId → profile map so a tab slot entry gets its profile.
          const tabProfileById = new Map<string, PairedNodeProfile[]>();
          for (const tab of parseTabContributions(gcs?.contributes.tabs) ?? []) {
            if (tab.profile) tabProfileById.set(tab.panelId, tab.profile);
          }
          const slotEntries: LocalAgentGcsContribution[] = [];
          if (gcs) {
            for (const arr of [
              gcs.contributes.panels,
              gcs.contributes.overlays,
              gcs.contributes.notifications,
            ]) {
              for (const raw of arr ?? []) {
                const m = mapSlotEntry(raw);
                if (!m) continue;
                if (m.slot === "node.detail.tab") {
                  const profile = tabProfileById.get(m.panelId);
                  if (profile) m.profile = profile;
                }
                slotEntries.push(m);
              }
            }
          }
          slotEntries.push(...parseNodePageContributions(gcs?.contributes));
          const skills: LocalAgentSkillRow[] = [];
          for (const raw of gcs?.contributes.skills ?? []) {
            const m = mapSkill(raw);
            if (m) skills.push(m);
          }
          const targetActions: LocalAgentTargetActionRow[] = [];
          for (const raw of gcs?.contributes.target_actions ?? []) {
            const m = mapTargetAction(raw);
            if (m) targetActions.push(m);
          }
          const parameters =
            parseParameterContributions(gcs?.contributes.parameters) ?? [];
          const entrypoint = gcs?.entrypoint ?? null;
          return {
            installId: `${deviceId}::${pluginId}`,
            pluginId,
            version: detail.manifest.version,
            name: detail.manifest.name,
            status: detail.install.status,
            grantedCaps: detail.granted_capabilities ?? [],
            gcsContributes: slotEntries,
            gcsParameters: parameters,
            flightSkills: skills,
            targetActions,
            entrypoint,
            bundle: entrypoint
              ? {
                  kind: "agent",
                  agentUrl,
                  apiKey: apiKeyRef.current,
                  entrypoint,
                  isolation: gcs?.isolation === "inline" ? "inline" : "iframe",
                }
              : null,
          };
        } catch {
          // An unreadable detail (the plugin removed between the list and
          // this read, or a dropped request) is skipped, not fatal to the
          // others, and re-read on the next retry tick.
          return null;
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      setRead({
        key: fetchKey,
        rows: results.filter((r): r is LocalAgentPluginDetail => r !== null),
      });
      if (results.includes(null)) {
        const retryTimer = setTimeout(() => setRetry((n) => n + 1), NODE_PLUGIN_LIST_POLL_MS);
        stopRetry = () => clearTimeout(retryTimer);
      }
    });

    return () => {
      cancelled = true;
      stopRetry();
    };
    // fetchKey captures (deviceId, agentUrl, the live set); apiKey via ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey, retry]);

  // Fleet (null-device) resolves synchronously from the store; the per-node
  // branch resolves via the async agent reads above.
  if (deviceId === null) return fleetRows;
  if (!fetchKey) return null;
  if (liveInstalls?.length === 0) return [];
  return read !== null && read.key === fetchKey ? read.rows : null;
}
