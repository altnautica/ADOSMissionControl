/**
 * @module agent/relayed-status-client
 * @description LAN client for a ground station's
 * `GET /api/v1/ground-station/relayed/status` — the compact node-status and
 * identity snapshots the ground station has cached from the drones it relays
 * over the WFB auxiliary lane.
 *
 * Local-first (Rule 39): on an HTTPS origin the call routes through Mission
 * Control's own `/api/lan-pair/relayed-status` server proxy to dodge the
 * browser's mixed-content guard; on HTTP / Electron the direct fetch is kept.
 *
 * The agent route recomputes freshness against its own clock and drops a
 * stale peer's status block itself (see `gs_relayed_status.rs`), so this
 * client trusts `status_fresh` rather than re-deriving it — re-deriving would
 * risk disagreeing with the source of truth about what "fresh" means.
 *
 * Every reply is coerced defensively: a transport failure, a 404 (relay not
 * running), or a malformed body all return an empty peer list rather than
 * throwing, so a poll loop degrades instead of crashing the bridge that
 * drives node enrollment.
 *
 * @license GPL-3.0-only
 */

/** One relayed peer's identity and (when fresh) status, as the route emits it. */
export interface RelayedPeerStatus {
  deviceId: string;
  name?: string;
  profile?: string;
  agentVersion?: string;
  identityAgeS?: number;
  statusFresh: boolean;
  statusAgeS?: number;
  /** Present only while `statusFresh` — an aged-out status is dropped by the
   * route itself, never served stale (Rule 44). */
  status?: {
    /** The honest connected-or-reachable verdict on agents that publish it:
     * true for a live MAVLink heartbeat, and also true for a healthy MSP
     * flight controller (Betaflight/iNav), which never emits one but is
     * reachable and drivable over the byte-transparent proxy. An agent from
     * before the fix falls back to the raw heartbeat-gated field, so an MSP
     * board can still read false on those; there is no way to distinguish
     * the two cases from this snapshot alone. */
    fcConnected?: boolean;
    mavlinkAlive?: boolean;
    fcVariant?: string;
    fcFirmware?: string;
    servicesRunning?: number;
    servicesFailed?: number;
    servicesOther?: number;
    failedServiceNames?: string[];
    cpuPercent?: number;
    memoryPercent?: number;
    diskPercent?: number;
    temperature?: number;
    boardName?: string;
    boardSoc?: string;
    boardTier?: number;
    uptimeSeconds?: number;
    agentVersion?: string;
    cameraState?: string;
    videoState?: string;
  };
}

export interface RelayedStatusResponse {
  peers: RelayedPeerStatus[];
  peerCount: number;
  generatedAtUnix: number;
}

const EMPTY: RelayedStatusResponse = { peers: [], peerCount: 0, generatedAtUnix: 0 };

/** Narrow an unknown JSON value's peer array into typed entries, dropping
 * anything malformed rather than throwing. */
function parsePeers(raw: unknown): RelayedPeerStatus[] {
  if (!raw || typeof raw !== "object") return [];
  const list = (raw as Record<string, unknown>).peers;
  if (!Array.isArray(list)) return [];

  const out: RelayedPeerStatus[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    if (typeof p.device_id !== "string" || p.device_id.length === 0) continue;

    const entry: RelayedPeerStatus = {
      deviceId: p.device_id,
      name: typeof p.name === "string" ? p.name : undefined,
      profile: typeof p.profile === "string" ? p.profile : undefined,
      agentVersion: typeof p.agent_version === "string" ? p.agent_version : undefined,
      identityAgeS:
        typeof p.identity_age_s === "number" ? p.identity_age_s : undefined,
      statusFresh: p.status_fresh === true,
      statusAgeS: typeof p.status_age_s === "number" ? p.status_age_s : undefined,
    };

    const s = p.status;
    if (entry.statusFresh && s && typeof s === "object") {
      // The ground-side sidecar expands the radio-frame's short keys into
      // readable ones before publishing (aux_peers.rs: expand_status). The
      // route serves that expansion verbatim, so this parser reads the
      // long-key form — never the short wire keys, which never escape the
      // radio process.
      const sv = s as Record<string, unknown>;
      entry.status = {
        fcConnected: typeof sv.fc_connected === "boolean" ? sv.fc_connected : undefined,
        mavlinkAlive: typeof sv.mavlink_alive === "boolean" ? sv.mavlink_alive : undefined,
        fcVariant: typeof sv.fc_variant === "string" ? sv.fc_variant : undefined,
        fcFirmware: typeof sv.fc_firmware === "string" ? sv.fc_firmware : undefined,
        servicesRunning: typeof sv.services_running === "number" ? sv.services_running : undefined,
        servicesFailed: typeof sv.services_failed === "number" ? sv.services_failed : undefined,
        servicesOther: typeof sv.services_other === "number" ? sv.services_other : undefined,
        failedServiceNames: Array.isArray(sv.failed_units)
          ? (sv.failed_units as unknown[]).filter(
              (n): n is string => typeof n === "string",
            )
          : undefined,
        cpuPercent: typeof sv.cpu_percent === "number" ? sv.cpu_percent : undefined,
        memoryPercent: typeof sv.memory_percent === "number" ? sv.memory_percent : undefined,
        diskPercent: typeof sv.disk_percent === "number" ? sv.disk_percent : undefined,
        temperature: typeof sv.temperature_c === "number" ? sv.temperature_c : undefined,
        boardName: typeof sv.board_name === "string" ? sv.board_name : undefined,
        boardSoc: typeof sv.board_soc === "string" ? sv.board_soc : undefined,
        boardTier: typeof sv.board_tier === "number" ? sv.board_tier : undefined,
        uptimeSeconds: typeof sv.uptime_seconds === "number" ? sv.uptime_seconds : undefined,
        agentVersion: typeof sv.agent_version === "string" ? sv.agent_version : undefined,
        cameraState: typeof sv.camera_state === "string" ? sv.camera_state : undefined,
        videoState: typeof sv.video_state === "string" ? sv.video_state : undefined,
      };
    }
    out.push(entry);
  }
  return out;
}

function parseResponse(text: string): RelayedStatusResponse {
  try {
    const doc: unknown = JSON.parse(text);
    if (!doc || typeof doc !== "object") return EMPTY;
    const obj = doc as Record<string, unknown>;
    return {
      peers: parsePeers(obj),
      peerCount: typeof obj.peer_count === "number" ? obj.peer_count : 0,
      generatedAtUnix:
        typeof obj.generated_at_unix === "number" ? obj.generated_at_unix : 0,
    };
  } catch {
    return EMPTY;
  }
}

/**
 * Fetch a ground station's relayed-node status. `host` is the ground
 * station's reachable address (IP, mDNS name, or full URL — same shape the
 * pairing probe accepts). Never throws: a 404 (no relay running), a stale
 * key, or a network failure all resolve to the empty response so a poll loop
 * degrades rather than crashes.
 */
export async function fetchRelayedStatus(
  host: string,
  apiKey: string | null,
): Promise<RelayedStatusResponse> {
  const isHttps =
    typeof window !== "undefined" && window.location.protocol === "https:";

  try {
    if (isHttps) {
      const res = await fetch("/api/lan-pair/relayed-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host, apiKey: apiKey ?? undefined }),
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) return EMPTY;
      return parseResponse(await res.text());
    }

    const base = host.startsWith("http") ? host : `http://${host}:8080`;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey) headers["X-ADOS-Key"] = apiKey;
    const res = await fetch(`${base}/api/v1/ground-station/relayed/status`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return EMPTY;
    return parseResponse(await res.text());
  } catch {
    return EMPTY;
  }
}
