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
    /** Raw "agent considers a flight controller connected" — heartbeat-gated,
     * so an MSP flight controller reads false here even when it is reachable.
     * The compact snapshot does not yet carry the agent's honest `fcReachable`
     * verdict; treat this field with the same caveat `fcConnected` carries
     * everywhere else in the codebase. */
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
      const sv = s as Record<string, unknown>;
      entry.status = {
        fcConnected: typeof sv.fc === "boolean" ? sv.fc : undefined,
        mavlinkAlive: typeof sv.fa === "boolean" ? sv.fa : undefined,
        fcVariant: typeof sv.fv === "string" ? sv.fv : undefined,
        fcFirmware: typeof sv.ff === "string" ? sv.ff : undefined,
        servicesRunning: typeof sv.sr === "number" ? sv.sr : undefined,
        servicesFailed: typeof sv.sf === "number" ? sv.sf : undefined,
        servicesOther: typeof sv.so === "number" ? sv.so : undefined,
        failedServiceNames: Array.isArray(sv.sn)
          ? (sv.sn as unknown[]).filter((n): n is string => typeof n === "string")
          : undefined,
        cpuPercent: typeof sv.cp === "number" ? sv.cp : undefined,
        memoryPercent: typeof sv.mp === "number" ? sv.mp : undefined,
        diskPercent: typeof sv.dp === "number" ? sv.dp : undefined,
        temperature: typeof sv.tc === "number" ? sv.tc : undefined,
        boardName: typeof sv.bn === "string" ? sv.bn : undefined,
        boardSoc: typeof sv.bs === "string" ? sv.bs : undefined,
        boardTier: typeof sv.bt === "number" ? sv.bt : undefined,
        uptimeSeconds: typeof sv.up === "number" ? sv.up : undefined,
        agentVersion: typeof sv.ver === "string" ? sv.ver : undefined,
        cameraState: typeof sv.cs === "string" ? sv.cs : undefined,
        videoState: typeof sv.vs === "string" ? sv.vs : undefined,
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
