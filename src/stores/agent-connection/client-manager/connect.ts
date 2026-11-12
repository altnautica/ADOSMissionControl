import { AgentClient } from "@/lib/agent/client";
import { relayRefusalFrom, type RelayRefusal } from "@/lib/agent/agent-client/transport";
import type { AgentStatus, LanStatusFull } from "@/lib/agent/types";
import { inferCapabilities } from "@/lib/agent/infer-capabilities";
import { useAgentSystemStore } from "../../agent-system-store";
import { useAgentPeripheralsStore } from "../../agent-peripherals-store";
import { useAgentPluginInventoryStore } from "../../agent-plugin-inventory-store";
import { useFleetNetworkStore } from "../../fleet-network-store";
import { useVideoStore } from "../../video-store";
import { resolveAgentWhepUrl } from "@/lib/video/rewrite-whep-host";
import { useAgentCapabilitiesStore } from "../../agent-capabilities-store";
import { useLocalNodesStore } from "../../local-nodes-store";
import { usePairingStore } from "../../pairing-store";
import { useCommandFleetStore } from "../../command-fleet-store";
import { probeAgent } from "@/lib/agent/local-pair-client";
import { nodeIdForDevice } from "@/lib/agent/node-id";
import { applyFullStatus } from "../apply-full-status";
import { nextPollDelay, POLL_BASE_MS, POLL_BASE_RELAY_MS } from "../poll-backoff";
import type {
  ClientManagerSlice,
  AgentConnectionSliceCreator,
  StalePairingInfo,
} from "../types";
import { buildIpv4Fallback } from "./ipv4-fallback";
import { isCurrent, nextGeneration } from "./generation";
import { agentMavlinkWsUrl } from "./mavlink-url";

type Slice = AgentConnectionSliceCreator<ClientManagerSlice>;
export type SliceSet = Parameters<Slice>[0];
export type SliceGet = Parameters<Slice>[1];

// Poll-cadence math (base/backoff/jitter) lives in the store-free
// ./poll-backoff module so it can be imported and tested without constructing
// the agent-connection store.

/** Relay connects cross a radio that drops ~1 request in 3, and unlike the LAN
 *  path there is no ipv4/mDNS cascade to fall back on — one lost datagram would
 *  otherwise doom the whole session. */
async function retryGetStatus(
  client: AgentClient,
  attempts: number,
  gapMs: number,
): Promise<AgentStatus> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await client.getStatus();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) {
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, gapMs);
        await promise;
      }
    }
  }
  throw lastErr;
}

/** Body of the slice's `connect` action. */
export async function connectAgent(
  set: SliceSet,
  get: SliceGet,
  ...[url, apiKey, deviceId, opts]: Parameters<ClientManagerSlice["connect"]>
): Promise<void> {
  const resolvedKey = apiKey ?? get().apiKey;
  const generation = nextGeneration();
  const superseded = () => !isCurrent(generation);
  // The relay's own refusal on the latest attempt (ticket, or the drone's
  // API behind the relay), surfaced with the failure so the node can say
  // why rather than only "offline".
  let relayRefusal: RelayRefusal | null = null;

  // Attempt a real-agent connect at the given URL. Returns null when the
  // connect is finished (success: state is set and polling started; or
  // superseded by a newer connect/disconnect, which then owns the state);
  // returns the error message string on failure so the caller can decide
  // whether to try a fallback.
  async function attempt(attemptUrl: string): Promise<string | null> {
    let client: AgentClient;
    if (attemptUrl === "mock://demo") {
      const { MockAgentClient } = await import("@/mock/mock-agent");
      if (superseded()) return null;
      client = new MockAgentClient() as unknown as AgentClient;
    } else {
      client = new AgentClient(attemptUrl, resolvedKey, {
        relay: opts?.relay ?? false,
      });
    }
    set({
      agentUrl: attemptUrl,
      apiKey: resolvedKey,
      client,
      connectionError: null,
      relay: opts?.relay ?? false,
      relayRefusal: null,
    });
    try {
      // The relay lane loses uplink datagrams outright, so the single probe
      // that decides the whole session gets retries it cannot get from the
      // ipv4/mDNS cascade below (which never engages for a relay URL).
      const status = opts?.relay
        ? await retryGetStatus(client, 3, 400)
        : await client.getStatus();
      if (superseded()) return null;
      // The device id this connection is registered under. Starts as the id
      // the caller asked for; the identity gate below heals it to the
      // agent's live id when a re-flashed box answers our key.
      let connectId = deviceId ?? null;
      // Identity gate + self-heal: the agent at this host accepted our key
      // (the authenticated status call above succeeded), so it IS our paired
      // box — a stranger on a DHCP-reused IP would have rejected that call.
      // If it now reports a DIFFERENT device id it was re-flashed (a new
      // machine-id-derived id), so migrate the card to the live identity and
      // keep the connection instead of orphaning it behind a hard mismatch.
      // `/api/pairing/info` is the source of truth for identity and resolves
      // even when a stale key would not validate.
      if (
        attemptUrl !== "mock://demo" &&
        deviceId &&
        typeof client.getPairingInfo === "function"
      ) {
        let answeredId: string | null = null;
        try {
          const info = await client.getPairingInfo();
          answeredId =
            typeof info?.device_id === "string" && info.device_id.length > 0
              ? info.device_id
              : null;
        } catch {
          answeredId = null; // indeterminate — fall through and connect
        }
        if (superseded()) return null;
        if (answeredId && answeredId !== deviceId) {
          const ln = useLocalNodesStore.getState();
          if (ln.nodes.some((n) => n.deviceId === deviceId)) {
            ln.migrateNode(deviceId, answeredId, { lastSeenAt: Date.now() });
            const ps = usePairingStore.getState();
            if (ps.selectedPairedId === nodeIdForDevice(deviceId)) {
              ps.selectPairedDrone(nodeIdForDevice(answeredId));
            }
            // Drop the status row keyed by the old id so the overview tile
            // re-keys under the live id on the next poll.
            useCommandFleetStore.getState().removeCloudStatuses([deviceId]);
          }
          connectId = answeredId;
        }
      }
      set({ connected: true, stalePairing: null, mavlinkPairRequired: false, relayRefusal: null });
      if (!opts?.relay) {
        // Under relay `attemptUrl`'s hostname is the GROUND STATION, so this
        // would point AgentMavlinkBridge at the ground station's own FC lane
        // while RelayedMavlinkBridge already owns the drone's session. Leave
        // `mavlinkUrl` untouched — the relay bridge manages its own.
        const mavWsUrl = agentMavlinkWsUrl(attemptUrl);
        if (mavWsUrl) set({ mavlinkUrl: mavWsUrl });
      }
      const nodeDeviceId = connectId ?? get().nodeDeviceId;
      set({ nodeDeviceId });
      useAgentSystemStore.getState().setStatus(status);
      useAgentSystemStore.getState().fetchServices();
      useAgentSystemStore.getState().fetchResources();
      useAgentSystemStore.getState().fetchLogs();
      // Only the demo client serves a capability document; a real agent's
      // capabilities are inferred from its status below.
      const getCapabilities = "getCapabilities" in client ? client.getCapabilities : undefined;
      let capsLoaded = false;
      if (typeof getCapabilities === "function") {
        try {
          const caps: unknown = await getCapabilities.call(client);
          if (superseded()) return null;
          if (caps && typeof caps === "object") {
            useAgentCapabilitiesStore
              .getState()
              .setCapabilities(
                caps as Record<string, unknown>,
                nodeDeviceId,
              );
            capsLoaded = true;
          }
        } catch { /* capabilities optional */ }
      }
      if (superseded()) return null;
      if (!capsLoaded) {
        const peripherals = useAgentPeripheralsStore.getState().peripherals;
        // `/api/status` declares the board's NPU at the top level.
        const declared: Record<string, unknown> = { ...status };
        const inferred = inferCapabilities(status, peripherals, {
          npuTops: typeof declared.npuTops === "number" ? declared.npuTops : undefined,
          hasAccelerator:
            typeof declared.hasAccelerator === "boolean"
              ? declared.hasAccelerator
              : undefined,
        });
        if (inferred)
          useAgentCapabilitiesStore
            .getState()
            .setCapabilities(inferred, nodeDeviceId);
      }
      get().startPolling();
      return null;
    } catch (err) {
      if (superseded()) return null;
      relayRefusal = opts?.relay ? relayRefusalFrom(err) : null;
      return err instanceof Error ? err.message : "Connection failed";
    }
  }

  // Commit a failed connect to state, classifying WHY a locally-paired card
  // could not connect. If the box at the card's host is reachable but is no
  // longer the agent we paired (re-flashed → new device id, or unpaired), set
  // `stalePairing` so the empty state offers a truthful re-pair / remove
  // instead of the misleading "connect a flight controller" (USB) prompt. A
  // plain unreachable box stays a transient offline (stalePairing = null).
  async function surfaceFailure(errMsg: string): Promise<void> {
    const base = {
      connected: false,
      connectionError: errMsg,
      client: null,
      agentUrl: null,
      relayRefusal,
    } as const;
    const node = useLocalNodesStore
      .getState()
      .nodes.find((n) => n.hostname === url || n.deviceId === deviceId);
    if (!node) {
      set({ ...base, stalePairing: null });
      return;
    }
    const candidates = [
      node.hostname,
      node.ipv4 != null ? buildIpv4Fallback(node.hostname, node.ipv4) : null,
    ].filter((h): h is string => !!h);
    let stale: StalePairingInfo | null = null;
    for (const host of candidates) {
      try {
        const info = await probeAgent(host);
        if (deviceId && info.deviceId && info.deviceId !== deviceId) {
          stale = {
            reason: "reidentified",
            host: node.hostname,
            deviceId,
            liveDeviceId: info.deviceId,
          };
        } else if (info.paired === false) {
          stale = {
            reason: "unpaired",
            host: node.hostname,
            deviceId: deviceId ?? node.deviceId,
            liveDeviceId: info.deviceId || null,
          };
        }
        break; // reachable — don't try the fallback host
      } catch {
        // Unreachable on this candidate; try the next, else stay transient.
      }
    }
    if (superseded()) return;
    set({ ...base, stalePairing: stale });
  }

  // Prefer a known IPv4 for a `.local` agent host. Resolving `.local` in the
  // browser tries AAAA/IPv6 first and hangs ~5s on a box with no usable IPv6,
  // which also poisons the browser-direct video (WHEP) + MAVLink-WS dials that
  // take their host from `agentUrl`. Connecting by IPv4 makes `agentUrl` the
  // IPv4 so every derived URL is fast; the `.local` URL stays as a fallback
  // (mDNS can self-heal a stale IPv4 after a DHCP change).
  const ipv4First = (() => {
    const node = useLocalNodesStore
      .getState()
      .nodes.find((n) => n.hostname === url);
    return node?.ipv4 != null ? buildIpv4Fallback(url, node.ipv4) : null;
  })();

  const firstError = await attempt(ipv4First ?? url);
  if (firstError === null) return; // success

  if (ipv4First) {
    // IPv4 failed (e.g. a stale lease after DHCP moved the box, or it now
    // answers for a different drone). Fall back to the `.local` URL, which
    // re-resolves via mDNS.
    const lanError = await attempt(url);
    if (lanError === null) return;
    await surfaceFailure(`${firstError} (also tried ${url}: ${lanError})`);
    return;
  }

  // No known IPv4 — the first attempt WAS the `.local` URL. If this URL
  // corresponds to a LAN-paired node, ask the server-side mDNS browse for the
  // device's IPv4 and try that once before surfacing the error. The browser
  // can fail to resolve .local hostnames even when the agent is reachable.
  let local = useLocalNodesStore
    .getState()
    .nodes.find((n) => n.hostname === url);
  let fallbackUrl =
    local?.ipv4 != null ? buildIpv4Fallback(url, local.ipv4) : null;

  // Backfill: pre-schema-v2 pair entries don't carry an `ipv4`. If
  // the failure left us without a fallback target but we DO have a
  // local node entry, ask the server-side mDNS browse for the
  // device's IPv4 and try it. Successful backfills are persisted
  // so subsequent clicks skip the failed round-trip.
  if (!fallbackUrl && local) {
    try {
      const expectedHost = new URL(url).hostname.replace(/\.$/, "");
      const expectedMdns = (local.mdnsHost ?? "").replace(/\.$/, "");
      // The discover route blocks server-side for a few seconds; cap the
      // client side so a stalled mDNS socket can't hold the connect
      // fallback open with no deadline (the catch falls through to
      // surfacing firstError).
      const r = await fetch("/api/lan-pair/discover", {
        signal: AbortSignal.timeout(5000),
      });
      if (r.ok) {
        const data = (await r.json()) as {
          agents?: Array<{ host: string; ipv4?: string }>;
        };
        const match = data.agents?.find(
          (a) => a.host === expectedHost || a.host === expectedMdns,
        );
        if (match?.ipv4) {
          useLocalNodesStore
            .getState()
            .addNode({ ...local, ipv4: match.ipv4 });
          local = useLocalNodesStore
            .getState()
            .nodes.find((n) => n.deviceId === local!.deviceId);
          fallbackUrl = buildIpv4Fallback(url, match.ipv4);
        }
      }
    } catch { /* discover failed; surface firstError below */ }
    if (superseded()) return;
  }

  if (fallbackUrl) {
    const secondError = await attempt(fallbackUrl);
    if (superseded()) return;
    if (secondError === null) {
      // Persist the working URL back to the store so future clicks
      // hit it directly without paying the failed-mDNS round-trip.
      useLocalNodesStore.getState().addNode({
        ...local!,
        hostname: fallbackUrl,
        lastSeenAt: Date.now(),
      });
      return;
    }
    // Both attempts failed. Surface the second (more informative)
    // error, which describes the IPv4 attempt.
    await surfaceFailure(
      `${firstError} (also tried ${fallbackUrl}: ${secondError})`,
    );
    return;
  }

  // No fallback available — surface the original error.
  await surfaceFailure(firstError);
}
