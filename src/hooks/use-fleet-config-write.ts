"use client";

/**
 * @module hooks/use-fleet-config-write
 * @description Fans one agent-config write across a selection of nodes and
 * reports a per-node outcome.
 *
 * Why config and not a command: `AGENT_COMMAND_NAMES` is a closed nine-verb
 * catalog the agent enforces with a 400 before any frame leaves the browser, and
 * a formation or swarm-mode change is not one of those nine. The config path
 * already carries all three transports (direct LAN client, the server-side
 * `/api/lan-pair/config` proxy, and the cloud pairing record behind it), so a
 * fleet directive rides it with no agent-side catalog change.
 *
 * Transport is resolved PER NODE, not once: the attached direct client belongs
 * to the focused node alone, so every other member of the selection resolves
 * through its own pairing record. A node with no path is reported as a failed
 * outcome rather than silently skipped — a fleet command that reached 19 of 24
 * drones must say so.
 *
 * Dispatch is concurrent. The confirmation is the caller's job and is taken
 * ONCE for the whole batch (the same shape `dispatchSkillForNodes` proves for
 * the command lane); per-node round trips must not queue behind each other.
 * @license GPL-3.0-only
 */

import { useCallback, useMemo, useState } from "react";

import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { usePairingStore } from "@/stores/pairing-store";
import { isDemoMode } from "@/lib/utils";
import {
  resolveConfigAccess,
  resolveConfigProxyTarget,
  setConfigValueViaAccess,
  type AgentConfigClient,
  type ConfigAccess,
  type PairingRecords,
} from "@/lib/agent/config-access";

/** Everything the per-node transport resolution needs, captured so the
 * resolution stays a pure function of state the caller can hand a test. */
export interface FleetConfigTransport {
  /** The direct agent client, when one is attached. It serves exactly one
   * node — `focusedDeviceId`. */
  client: AgentConfigClient | null;
  focusedDeviceId: string | null;
  records: PairingRecords;
}

/** One node's result. `mode` is the transport that carried (or refused) the
 * write, so a failure report distinguishes "no path" from "the agent said no". */
export interface FleetConfigOutcome {
  deviceId: string;
  mode: ConfigAccess["mode"];
  ok: boolean;
  /** Null on success. */
  error: string | null;
}

export interface FleetConfigResult {
  key: string;
  value: string;
  outcomes: FleetConfigOutcome[];
  applied: number;
  failed: number;
}

const NO_PATH_MESSAGE = "No connection path to this node";

/**
 * The transport for ONE fleet member.
 *
 * The direct client is handed to the focused node only. Reusing it for every
 * node in the selection would write the focused node's config N times and
 * report N successes — the failure mode this function exists to prevent.
 */
export function resolveFleetConfigAccess(
  deviceId: string,
  transport: FleetConfigTransport,
): ConfigAccess {
  const direct =
    transport.client && deviceId === transport.focusedDeviceId
      ? transport.client
      : null;
  return resolveConfigAccess(direct, deviceId, transport.records);
}

/**
 * The nodes a fleet config write can actually reach right now, in the order
 * they were given. Callers render "N of M ready" from this BEFORE taking the
 * operator's confirmation, so the count in the dialog is a pre-commit fact
 * rather than an after-the-fact report.
 */
export function resolveFleetConfigTargets(
  deviceIds: readonly string[],
  transport: FleetConfigTransport,
): string[] {
  return [...new Set(deviceIds)].filter(
    (id) =>
      (transport.client !== null && id === transport.focusedDeviceId) ||
      resolveConfigProxyTarget(id, transport.records) !== null,
  );
}

/**
 * Write one dot-path key across `deviceIds`, concurrently. Never throws: a
 * per-node failure is an outcome, because one unreachable drone must not
 * abort the other twenty-three.
 */
export async function writeConfigForNodes(
  key: string,
  value: string,
  deviceIds: readonly string[],
  transport: FleetConfigTransport,
): Promise<FleetConfigResult> {
  const outcomes = await Promise.all(
    [...new Set(deviceIds)].map(
      async (deviceId): Promise<FleetConfigOutcome> => {
        const access = resolveFleetConfigAccess(deviceId, transport);
        if (access.mode === "none") {
          return {
            deviceId,
            mode: "none",
            ok: false,
            error: NO_PATH_MESSAGE,
          };
        }
        try {
          const res = await setConfigValueViaAccess(access, key, value);
          // The agent answers 200 with an `{error}` body for a rejected
          // value, so a 2xx is not by itself a success.
          if (res && typeof res.error === "string") {
            return { deviceId, mode: access.mode, ok: false, error: res.error };
          }
          return { deviceId, mode: access.mode, ok: true, error: null };
        } catch (err) {
          return {
            deviceId,
            mode: access.mode,
            ok: false,
            error: err instanceof Error ? err.message : "Config write failed",
          };
        }
      },
    ),
  );

  const applied = outcomes.filter((o) => o.ok).length;
  return { key, value, outcomes, applied, failed: outcomes.length - applied };
}

export interface FleetConfigWriter {
  /** The subset of `deviceIds` the config path reaches right now. */
  reachable: (deviceIds: readonly string[]) => string[];
  /** Fan one key across the selection. Resolves with per-node outcomes. */
  writeValue: (
    key: string,
    value: string,
    deviceIds: readonly string[],
  ) => Promise<FleetConfigResult>;
  /** True while a fan-out is in flight, for disabling the action bar. */
  pending: boolean;
}

/**
 * The fleet config writer bound to the live stores. Subscribed (not read
 * imperatively) so a pair or unpair mid-session re-resolves every node's
 * transport without a remount.
 */
export function useFleetConfigWrite(): FleetConfigWriter {
  const client = useAgentConnectionStore((s) => s.client);
  const focusedDeviceId = useAgentConnectionStore((s) => s.nodeDeviceId);
  const localNodes = useLocalNodesStore((s) => s.nodes);
  const pairedDrones = usePairingStore((s) => s.pairedDrones);
  const [pending, setPending] = useState(false);
  const demo = isDemoMode();

  const transport = useMemo<FleetConfigTransport>(
    () => ({
      client,
      focusedDeviceId,
      records: { localNodes, pairedDrones },
    }),
    [client, focusedDeviceId, localNodes, pairedDrones],
  );

  const reachable = useCallback(
    (deviceIds: readonly string[]) => {
      // DEMO-MODE BRANCH (gated on isDemoMode, real fleets unaffected):
      // every simulated node takes a config write, so the pre-commit count
      // the confirm dialog shows is true.
      if (demo) return [...new Set(deviceIds)];
      return resolveFleetConfigTargets(deviceIds, transport);
    },
    [transport, demo],
  );

  const writeValue = useCallback(
    async (key: string, value: string, deviceIds: readonly string[]) => {
      setPending(true);
      try {
        if (demo) {
          // DEMO-MODE BRANCH: the demo config is one shared document (the
          // mock's existing design), so a "fleet" write is one apply rather
          // than N per-node round trips. Loaded on demand so the mock never
          // reaches a production bundle.
          const { setMockConfigValue } = await import("@/mock/agent/config");
          setMockConfigValue(key, value);
          const outcomes: FleetConfigOutcome[] = deviceIds.map(
            (deviceId) => ({
              deviceId,
              mode: "direct" as const,
              ok: true,
              error: null,
            }),
          );
          return { key, value, outcomes, applied: outcomes.length, failed: 0 };
        }
        return await writeConfigForNodes(key, value, deviceIds, transport);
      } finally {
        setPending(false);
      }
    },
    [transport, demo],
  );

  return { reachable, writeValue, pending };
}
