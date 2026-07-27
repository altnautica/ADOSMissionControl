/**
 * @module AgentConnectionClientManagerSlice
 * @description Client lifecycle: AgentClient construction, polling loop with
 * tab-visibility pause, consolidated-endpoint preference with parallel
 * fallback, and full disconnect that clears every dependent store.
 * @license GPL-3.0-only
 */

import { AgentClient, normaliseSystemResources } from "@/lib/agent/client";
import type {
  AgentStatus,
  FullStatusResponse,
  ServiceInfo,
} from "@/lib/agent/types";
import { inferCapabilities } from "@/lib/agent/infer-capabilities";
import { useAgentSystemStore } from "../agent-system-store";
import { useAgentPeripheralsStore } from "../agent-peripherals-store";
import { useAgentPluginInventoryStore } from "../agent-plugin-inventory-store";
import { useFleetNetworkStore } from "../fleet-network-store";
import { useVideoStore } from "../video-store";
import { resolveAgentWhepUrl } from "@/lib/video/rewrite-whep-host";
import { useAgentCapabilitiesStore } from "../agent-capabilities-store";
import { normalizeRadio } from "../agent-capabilities/normalizer";
import { useLocalNodesStore } from "../local-nodes-store";
import { usePairingStore } from "../pairing-store";
import { useCommandFleetStore } from "../command-fleet-store";
import { probeAgent } from "@/lib/agent/local-pair-client";
import { nodeIdForDevice } from "@/lib/agent/node-id";
import { nextPollDelay, POLL_BASE_MS, POLL_BASE_RELAY_MS } from "./poll-backoff";
import type {
  ClientManagerSlice,
  AgentConnectionSliceCreator,
  StalePairingInfo,
} from "./types";

/** Build an `http://<ipv4>:<port>` URL from a base URL by swapping the
 * hostname. Returns null if the input URL or the IPv4 candidate is
 * unusable. */
function buildIpv4Fallback(baseUrl: string, ipv4: string): string | null {
  if (!ipv4 || !/^\d+\.\d+\.\d+\.\d+$/.test(ipv4)) return null;
  try {
    const u = new URL(baseUrl);
    if (u.hostname === ipv4) return null; // same address — no fallback gain
    u.hostname = ipv4;
    return u.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

// Module-level cleanup function for the tab visibility listener. Lives outside
// the store because Zustand's strict typing doesn't allow ad-hoc extra fields.
let _visibilityCleanup: (() => void) | undefined;

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

export const clientManagerSlice: AgentConnectionSliceCreator<
  ClientManagerSlice
> = (set, get) => ({
  async connect(url, apiKey, deviceId, opts) {
    const resolvedKey = apiKey ?? get().apiKey;

    // Attempt a real-agent connect at the given URL. Returns null on
    // success (state is set and polling started); returns the error
    // message string on failure so the caller can decide whether to
    // try a fallback.
    async function attempt(attemptUrl: string): Promise<string | null> {
      let client: AgentClient;
      if (attemptUrl === "mock://demo") {
        const { MockAgentClient } = await import("@/mock/mock-agent");
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
      });
      try {
        // The relay lane loses uplink datagrams outright, so the single probe
        // that decides the whole session gets retries it cannot get from the
        // ipv4/mDNS cascade below (which never engages for a relay URL).
        const status = opts?.relay
          ? await retryGetStatus(client, 3, 400)
          : await client.getStatus();
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
        set({ connected: true, stalePairing: null });
        if (!opts?.relay) {
          // Under relay `attemptUrl`'s hostname is the GROUND STATION, so this
          // would point AgentMavlinkBridge at the ground station's own FC lane
          // while RelayedMavlinkBridge already owns the drone's session. Leave
          // `mavlinkUrl` untouched — the relay bridge manages its own.
          try {
            const agentUrlObj = new URL(attemptUrl);
            const mavWsUrl = `ws://${agentUrlObj.hostname}:8765/`;
            set({ mavlinkUrl: mavWsUrl });
          } catch { /* ignore invalid URL */ }
        }
        set({ nodeDeviceId: connectId ?? get().nodeDeviceId });
        useAgentSystemStore.getState().setStatus(status);
        useAgentSystemStore.getState().fetchServices();
        useAgentSystemStore.getState().fetchResources();
        useAgentSystemStore.getState().fetchLogs();
        const clientWithCaps = client as unknown as {
          getCapabilities?: () => Promise<unknown>;
        };
        let capsLoaded = false;
        if (typeof clientWithCaps.getCapabilities === "function") {
          try {
            const caps = await clientWithCaps.getCapabilities();
            if (caps && typeof caps === "object") {
              useAgentCapabilitiesStore
                .getState()
                .setCapabilities(caps as Record<string, unknown>);
              capsLoaded = true;
            }
          } catch { /* capabilities optional */ }
        }
        if (!capsLoaded) {
          const peripherals = useAgentPeripheralsStore.getState().peripherals;
          const inferred = inferCapabilities(status, peripherals);
          if (inferred)
            useAgentCapabilitiesStore.getState().setCapabilities(inferred);
        }
        get().startPolling();
        return null;
      } catch (err) {
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
    }

    if (fallbackUrl) {
      const secondError = await attempt(fallbackUrl);
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
  },

  disconnect() {
    get().stopPolling();
    set({
      connected: false,
      client: null,
      agentUrl: null,
      apiKey: null,
      connectionError: null,
      cloudMode: false,
      cloudDeviceId: null,
      nodeDeviceId: null,
      mqttConnected: false,
      lastCloudUpdate: null,
      pollInterval: null,
      mavlinkUrl: null,
      consecutiveFailures: 0,
      stalePairing: null,
      controlRttMs: null,
      relay: false,
    });
    // Clear all other stores so a freshly-focused agent never shows the
    // previous one's data. Capabilities gate the radio/vision tabs and video
    // feeds the overview card, so both must reset on switch.
    useAgentSystemStore.getState().clear();
    useAgentPeripheralsStore.getState().clear();
    useAgentPluginInventoryStore.getState().clear();
    useFleetNetworkStore.getState().clear();
    useAgentCapabilitiesStore.getState().clear();
    useVideoStore.getState().setAgentVideoStatus("unknown", null);
  },

  startPolling() {
    get().stopPolling();

    // Track whether the consolidated endpoint is available (newer agents).
    // Once confirmed, skip the 4-request fallback path.
    let useFullEndpoint: boolean | null = null; // null = untried

    // The loop self-reschedules only after `poll` settles, so a slow/hung
    // poll can never overlap the next tick. `inFlight` is a second guard for
    // the immediate re-poll paths (tab-visibility) that fire `poll()`
    // outside the scheduler. `stopped` lets teardown halt rescheduling even
    // if a poll is mid-flight.
    let inFlight = false;
    let stopped = false;

    const poll = async () => {
      // Pause polling when browser tab is hidden to save bandwidth/battery.
      if (typeof document !== "undefined" && document.hidden) return;

      const client = get().client;
      if (!client) return;

      // Drop overlapping invocations rather than stacking pending sockets.
      if (inFlight) return;
      inFlight = true;

      try {
        // Try consolidated endpoint first (1 request instead of 4).
        if (useFullEndpoint !== false && typeof client.getFullStatus === "function") {
          // Time the request as the control-plane RTT surface. The LAN-direct
          // status round-trip is the cheapest always-available timing signal;
          // it is FC-independent (transport latency to the agent, not to the
          // flight controller). Cloud-relay mode has no client, so this only
          // ever runs on the LAN-direct path.
          const rttStart =
            typeof performance !== "undefined" ? performance.now() : Date.now();
          // `getFullStatus` resolves null ONLY for an agent that predates the
          // endpoint; a timeout / relay 504 / network error throws. Treating a
          // throw as "unsupported" would latch the 4-request fallback on for
          // the connection's life on one lost datagram, so it stays a plain
          // failed poll and the next tick retries the consolidated endpoint.
          let full: FullStatusResponse | null;
          try {
            full = await client.getFullStatus();
          } catch {
            get().noteFetchFailure();
            return;
          }
          if (full) {
            const rttEnd =
              typeof performance !== "undefined" ? performance.now() : Date.now();
            get().setControlRttMs(Math.max(0, Math.round(rttEnd - rttStart)));
            useFullEndpoint = true;
            // Map consolidated response to the same stores as the 4-endpoint path.
            const status = {
              version: full.version,
              uptime_seconds: full.uptime_seconds,
              board: full.board,
              health: full.health,
              fc_connected: full.fc_connected,
              fc_port: full.fc_port,
              fc_baud: full.fc_baud,
              // Gated MAVLink truth + the diagnostic hint so the LAN-direct path
              // renders the same honest FC state and actionable remediation the
              // cloud path does. getFullStatus already normalised the agent's
              // camelCase wire to these snake-case fields at the fetch boundary;
              // spread-undefined keeps absent fields off the object so
              // AgentStatusCard falls back to fc_connected.
              ...(typeof full.transport_open === "boolean" && {
                transport_open: full.transport_open,
              }),
              ...(typeof full.mavlink_alive === "boolean" && {
                mavlink_alive: full.mavlink_alive,
              }),
              ...(typeof full.heartbeat_age_s !== "undefined" && {
                heartbeat_age_s: full.heartbeat_age_s,
              }),
              ...(typeof full.fc_source === "string" && {
                fc_source: full.fc_source,
              }),
              ...(typeof full.fc_link_hint === "string" && {
                fc_link_hint: full.fc_link_hint,
              }),
              // The FC firmware identity the agent derived from the USB
              // descriptor. Carried so the LAN-direct path can (a) pick the MSP
              // adapter for a Betaflight/iNav FC and (b) treat a reachable MSP FC
              // as connectable even though it never emits a MAVLink heartbeat
              // (fc_connected stays false for MSP). Without these the LAN status
              // dropped the variant, so an MSP FC fell back to the MAVLink adapter
              // and never auto-connected.
              ...(typeof full.fc_variant === "string" && {
                fc_variant: full.fc_variant,
              }),
              ...(typeof full.fc_firmware === "string" && {
                fc_firmware: full.fc_firmware,
              }),
            };
            useAgentSystemStore.getState().setStatus(status as AgentStatus);
            if (full.services) {
              // Map the consolidated service shape (`state` + camelCase
              // metric fields) into the canonical ServiceInfo the rest
              // of the GCS consumes (`status` + snake_case fields).
              // Defensive on each field so a partial agent response
              // never produces NaN.toFixed() crashes downstream.
              type RawService = {
                name?: unknown;
                state?: unknown;
                pid?: unknown;
                cpu_percent?: unknown;
                cpuPercent?: unknown;
                memory_mb?: unknown;
                memoryMb?: unknown;
                uptime_seconds?: unknown;
                uptimeSeconds?: unknown;
                category?: unknown;
              };
              const mapped: ServiceInfo[] = (full.services as RawService[]).map((s) => ({
                name: typeof s.name === "string" ? s.name : "unknown",
                status: (typeof s.state === "string"
                  ? s.state
                  : "stopped") as ServiceInfo["status"],
                pid: typeof s.pid === "number" ? s.pid : null,
                cpu_percent:
                  typeof s.cpu_percent === "number"
                    ? s.cpu_percent
                    : typeof s.cpuPercent === "number"
                      ? s.cpuPercent
                      : 0,
                memory_mb:
                  typeof s.memory_mb === "number"
                    ? s.memory_mb
                    : typeof s.memoryMb === "number"
                      ? s.memoryMb
                      : 0,
                uptime_seconds:
                  typeof s.uptime_seconds === "number"
                    ? s.uptime_seconds
                    : typeof s.uptimeSeconds === "number"
                      ? s.uptimeSeconds
                      : 0,
                category:
                  typeof s.category === "string"
                    ? (s.category as ServiceInfo["category"])
                    : undefined,
              }));
              useAgentSystemStore.setState({ services: mapped });
            }
            if (full.resources) {
              // /api/status/full returns ONLY percentages (no
              // memory_used_mb / disk_used_gb / etc.) on current
              // agents. Normalise via the same helper the per-endpoint
              // path uses so consumers always see the full shape with
              // 0-defaulted fields instead of `undefined`.
              useAgentSystemStore.setState({
                resources: normaliseSystemResources(
                  full.resources as Record<string, unknown>,
                ),
                lastUpdatedAt: Date.now(),
                stale: false,
              });
            }
            if (full.video && typeof full.video.state === "string") {
              // The agent bakes whep_url from the request Host header (may be
              // an mDNS name the browser's WebRTC layer can't reach) and the
              // drone-profile block omits it entirely while mediamtx readiness
              // is transient. Re-point a supplied URL, or synthesize one, from
              // the host we are already polling successfully (proven reachable)
              // so LAN-direct video connects instead of an empty cascade.
              const whep = resolveAgentWhepUrl(
                full.video.whep_url,
                full.video.state,
                get().agentUrl,
              );
              useVideoStore
                .getState()
                .setAgentVideoStatus(full.video.state, whep);
            }
            // Populate capabilities from consolidated response or infer from legacy data.
            // FullStatusResponse.capabilities is optional (older agents omit it).
            // Several air-side status fields (camera discovery/recovery, per-leg
            // video streams, the CRSF control lane) are SIBLINGS of `capabilities`
            // in the consolidated status rather than nested inside it, so fold them
            // into the object handed to setCapabilities. Folding them in (rather
            // than a follow-up setState) means setCapabilities' single setState
            // carries them, so each reaches the store atomically with the rest of
            // the snapshot — no null-then-real write that flickers a dependent tab.
            const statusExtras: Record<string, unknown> = {};
            if (typeof full.cameraState !== "undefined") {
              statusExtras.cameraState = full.cameraState;
            }
            if (typeof full.cameraUsbRecovery !== "undefined") {
              statusExtras.cameraUsbRecovery = full.cameraUsbRecovery;
            }
            // Per-leg video streams: re-point each leg's WHEP host to the one we
            // poll successfully (proven reachable, dodging an unreachable mDNS
            // name), so the cockpit stream switcher connects LAN-direct.
            if (full.video?.streams?.length) {
              statusExtras.videoStreams = full.video.streams
                .map((leg) => ({
                  id: leg.id,
                  role: leg.role,
                  codec: leg.codec,
                  live: leg.live,
                  whepUrl: resolveAgentWhepUrl(leg.whep, "running", get().agentUrl),
                }))
                .filter((leg) => leg.id && leg.whepUrl);
            }
            // CRSF / ExpressLRS control-lane snapshot. The agent folds the lane's
            // crsf-stats sidecar into /api/status/full verbatim (raw snake_case),
            // PROFILE-AGNOSTIC — a drone running the ELRS relay lane carries it
            // exactly like a ground station — and omits the key when the lane is
            // down or its sidecar is stale. Folding the raw block in here (rather
            // than the old dedicated ground-station-only fetch that ran AFTER the
            // main set, gated on the ground-station profile) means setCapabilities'
            // single setState resolves crsf atomically: a drone relay now surfaces
            // the lane over the local-first LAN path, and there is no null-then-real
            // window between the capability write and a follow-up crsf fetch. An
            // absent key normalizes to null inside setCapabilities, so a node with
            // no lane clears the field rather than pinning a stale reading (Rule 44).
            if (full.crsf && typeof full.crsf === "object") {
              statusExtras.crsf = full.crsf;
            }
            if (full.capabilities) {
              // Agent has capabilities API; normalize and store (handles shape differences).
              useAgentCapabilitiesStore.getState().setCapabilities({
                ...(full.capabilities as Record<string, unknown>),
                ...statusExtras,
              });
            } else {
              // Agent doesn't have capabilities API; infer from board SoC + peripherals.
              const peripherals = useAgentPeripheralsStore.getState().peripherals;
              const inferred = inferCapabilities(
                status as AgentStatus,
                peripherals,
                undefined,
                full.profile,
              );
              if (inferred) {
                useAgentCapabilitiesStore.getState().setCapabilities({
                  ...(inferred as unknown as Record<string, unknown>),
                  ...statusExtras,
                });
              } else if (Object.keys(statusExtras).length > 0) {
                useAgentCapabilitiesStore.getState().setCapabilities(statusExtras);
              }
            }
            // Fallback: if capabilities store still has no cameras but we know board SoC,
            // re-infer on every poll to pick up peripherals that loaded after first poll.
            const capState = useAgentCapabilitiesStore.getState();
            if (capState.cameras.length === 0 && (status as AgentStatus)?.board?.soc) {
              const peripherals = useAgentPeripheralsStore.getState().peripherals;
              if (peripherals.length > 0) {
                const inferred = inferCapabilities(
                  status as AgentStatus,
                  peripherals,
                  undefined,
                  full.profile,
                );
                if (inferred && inferred.cameras.length > 0) {
                  useAgentCapabilitiesStore.getState().setCapabilities(inferred);
                }
              }
            }
            // Radio snapshot over the LAN-direct path. The consolidated
            // status carries the same camelCase radio block the cloud
            // heartbeat does (RSSI/SNR/noise/loss/MCS/FEC + receive-
            // liveness). Shallow-merge only the radio field so this never
            // clobbers profile/cameras set by setCapabilities above.
            if (full.radio && typeof full.radio === "object") {
              useAgentCapabilitiesStore.setState({
                radio: normalizeRadio(full.radio),
              });
            }
            // Native-vs-packaged runtime mode over the LAN-direct path.
            // The consolidated status carries the same aggregate the
            // cloud heartbeat does. Clamp to the known union and merge
            // only this field so it never clobbers the deeper capability
            // shape set above.
            if (
              full.runtimeMode === "native" ||
              full.runtimeMode === "hybrid" ||
              full.runtimeMode === "packaged"
            ) {
              useAgentCapabilitiesStore.setState({
                runtimeMode: full.runtimeMode,
              });
            }
            get().noteFetchSuccess();
            return;
          }
          // The consolidated endpoint is one radio round trip; the fallback is
          // four concurrent ones on a half-duplex lane. Never trade down here —
          // retry the full endpoint on the next tick instead. The latch below
          // is deliberately left unset so that retry actually happens.
          if (get().relay) {
            get().noteFetchFailure();
            return;
          }
          // 404 or null = agent doesn't support it.
          useFullEndpoint = false;
        }

        // Fallback: parallel requests for older agents. Each fetcher swallows
        // its own error and reports whether it landed, so the tick's verdict is
        // "did anything come back" rather than the unconditional success the
        // self-catching promises used to imply — which reset the failure count
        // every tick and made the offline threshold unreachable.
        const results = await Promise.all([
          useAgentSystemStore.getState().fetchStatus(),
          useAgentSystemStore.getState().fetchServices(),
          useAgentSystemStore.getState().fetchResources(),
        ]);

        // Video status (may not exist on all agents). Under relay the
        // consolidated response already carries `full.video`, so this extra
        // round trip would only buy airtime contention.
        if (!get().relay && typeof client.getVideoStatus === "function") {
          client.getVideoStatus().then((video) => {
            if (video) {
              const deps = video.dependencies
                ? Object.fromEntries(
                    Object.entries(video.dependencies).map(([k, v]) => [k, { found: v.found }]),
                  )
                : undefined;
              useVideoStore
                .getState()
                .setAgentVideoStatus(
                  video.state,
                  resolveAgentWhepUrl(video.whep_url, video.state, get().agentUrl),
                  deps,
                );
            }
          }).catch(() => {});
        }
        if (results.some(Boolean)) get().noteFetchSuccess();
        else get().noteFetchFailure();
      } catch {
        get().noteFetchFailure();
      } finally {
        inFlight = false;
      }
    };

    // One scheduled tick: run the poll, then arm the next one from the
    // failure-derived delay. Self-rescheduling (vs a flat setInterval)
    // guarantees a slow poll never overlaps its successor and that a dead
    // host backs off instead of being hammered at the base cadence.
    const tick = async () => {
      if (stopped) return;
      await poll();
      if (stopped) return;
      const delay = nextPollDelay(
        get().consecutiveFailures,
        get().relay ? POLL_BASE_RELAY_MS : POLL_BASE_MS,
      );
      const handle = setTimeout(tick, delay);
      set({ pollInterval: handle });
    };

    // Run the first poll immediately, then let the loop self-reschedule.
    void tick();

    // Pause/resume on tab visibility change.
    if (typeof document !== "undefined") {
      const onVisibility = () => {
        if (!document.hidden) {
          // Tab became visible: poll immediately for fresh data. The
          // in-flight guard keeps this from doubling up with a tick.
          void poll();
        }
      };
      document.addEventListener("visibilitychange", onVisibility);
      // Store the cleanup function. Flipping `stopped` here too means a
      // pending in-flight poll can no longer arm a successor after teardown.
      _visibilityCleanup = () => {
        stopped = true;
        document.removeEventListener("visibilitychange", onVisibility);
      };
    } else {
      // No document (SSR/Node): teardown still needs to stop rescheduling.
      _visibilityCleanup = () => {
        stopped = true;
      };
    }
  },

  stopPolling() {
    const { pollInterval } = get();
    if (pollInterval) {
      // The handle is a self-rescheduling setTimeout, not a setInterval.
      clearTimeout(pollInterval);
      set({ pollInterval: null });
    }
    // Clean up visibility listener and flip the loop's stop flag so a poll
    // mid-flight cannot arm the next tick after teardown.
    if (_visibilityCleanup) {
      _visibilityCleanup();
      _visibilityCleanup = undefined;
    }
  },

  clear() {
    get().disconnect();
  },
});
