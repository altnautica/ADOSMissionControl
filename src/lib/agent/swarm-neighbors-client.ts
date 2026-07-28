/**
 * @module agent/swarm-neighbors-client
 * @description LAN client for a ground station's `GET /api/swarm/neighbors` —
 * the fleet's decoded swarm-bus beacon table, one entry per slot the node has
 * heard from.
 *
 * Local-first (Rule 39): on an HTTPS origin the call routes through Mission
 * Control's own `/api/lan-pair/swarm-neighbors` server proxy to dodge the
 * browser's mixed-content guard; on HTTP / Electron the direct fetch is kept.
 * Same split `relayed-status-client` uses, for the same reason.
 *
 * The agent computes `age_ms` against its own clock, so this client trusts it
 * rather than re-deriving freshness from a GCS timestamp — the two clocks are
 * not synchronised and re-deriving would disagree with the source of truth.
 *
 * A transport failure, a 404 (no swarm bus running on this build), or a
 * malformed body all return `null` rather than throwing. `null` means "no
 * answer", which is what makes the bridge back off; an empty `rows` array
 * means "answered, and the fleet is silent". Those are different facts and the
 * bridge acts differently on each, so they must not collapse into one value.
 *
 * @license GPL-3.0-only
 */

import type {
  SwarmBeaconCounters,
  SwarmBeaconRow,
  SwarmModePrecedence,
} from "@/stores/swarm-beacon-store";

/** One answered poll, already mapped into store rows. */
export interface SwarmNeighborsSnapshot {
  /**
   * The reporting node's fleet, or null when its swarm bus is not running (no
   * radio, a profile that does not run it, an SBC mid-boot). The route reports
   * null rather than the config defaults 1/0 precisely so an unprovisioned
   * node is distinguishable from a healthy fleet-1 node that has simply heard
   * nobody. A null here means "answered, but there is no fleet identity to
   * record" — the bridge must not write it into the store.
   */
  fleetId: number | null;
  /** The REPORTING node's own slot — 0 for a ground station, null when the
   * bus is not running. Never defaulted to 0: slot 0 is SLOT_GROUND, a
   * meaningful value, so inventing it would claim this node is the ground
   * station of a fleet it has no identity in. */
  slot: number | null;
  rows: SwarmBeaconRow[];
  counters: SwarmBeaconCounters;
}

const MODE_PRECEDENCE: readonly SwarmModePrecedence[] = [
  "hard-separation",
  "operator",
  "formation",
  "flocking",
  "hold",
];

const ZERO_COUNTERS: SwarmBeaconCounters = {
  beaconsTx: 0,
  beaconsRx: 0,
  beaconsBadMagic: 0,
  beaconsBadTag: 0,
  beaconsStaleDropped: 0,
  neighborsNow: 0,
};

function num(raw: unknown, fallback: number): number {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
}

/**
 * Map one wire neighbour into a store row, or null when it carries no usable
 * slot. `device_id` and `rssi_dbm` are nullable ON THE WIRE and stay null here:
 * an unknown device id must not become an empty string, and a missing
 * radiotap RSSI must not become 0 dBm (which would render as a perfect link).
 */
function parseNeighbor(
  raw: unknown,
  receivedAtMs: number,
): SwarmBeaconRow | null {
  if (!raw || typeof raw !== "object") return null;
  const n = raw as Record<string, unknown>;
  if (typeof n.slot !== "number" || !Number.isFinite(n.slot)) return null;

  const precedence = MODE_PRECEDENCE.includes(
    n.mode_precedence as SwarmModePrecedence,
  )
    ? (n.mode_precedence as SwarmModePrecedence)
    : "hold";

  return {
    slot: n.slot,
    deviceId: typeof n.device_id === "string" ? n.device_id : null,
    seqMs: num(n.seq_ms, 0),
    lat: num(n.lat, 0),
    lon: num(n.lon, 0),
    altM: num(n.alt_m, 0),
    vxMs: num(n.vx_ms, 0),
    vyMs: num(n.vy_ms, 0),
    vzMs: num(n.vz_ms, 0),
    headingDeg: num(n.heading_deg, 0),
    armed: n.armed === true,
    guided: n.guided === true,
    emergency: n.emergency === true,
    gpsOk: n.gps_ok === true,
    hero: n.hero === true,
    modePrecedence: precedence,
    ageMs: num(n.age_ms, 0),
    rssiDbm: typeof n.rssi_dbm === "number" ? n.rssi_dbm : null,
    receivedAtMs,
  };
}

/**
 * Narrow an unknown `GET /api/swarm/neighbors` body into a snapshot. Exported
 * for unit tests and reused by the bridge.
 *
 * Returns null only for a body that is not a swarm reply at all. A well-formed
 * DEGRADED reply — `fleet_id: null`, `slot: null`, `neighbors: []`, counters
 * all zero, which the route serves with HTTP 200 when the bus is not running —
 * parses successfully with a null `fleetId`. Those are different facts: null
 * here means the host never answered and the caller should back off from a
 * transport that is not working, whereas a degraded body means the host is
 * healthy and has nothing to report.
 */
export function parseSwarmNeighbors(
  raw: unknown,
  receivedAtMs: number,
): SwarmNeighborsSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const doc = raw as Record<string, unknown>;
  // Present-and-null is valid; absent or a non-number is not a swarm reply.
  const fleetId =
    doc.fleet_id === null
      ? null
      : typeof doc.fleet_id === "number"
        ? doc.fleet_id
        : undefined;
  if (fleetId === undefined) return null;
  if (!Array.isArray(doc.neighbors)) return null;

  const rows: SwarmBeaconRow[] = [];
  for (const entry of doc.neighbors) {
    const row = parseNeighbor(entry, receivedAtMs);
    if (row) rows.push(row);
  }

  const c =
    doc.counters && typeof doc.counters === "object"
      ? (doc.counters as Record<string, unknown>)
      : {};

  return {
    fleetId,
    slot: typeof doc.slot === "number" ? doc.slot : null,
    rows,
    counters: {
      beaconsTx: num(c.beacons_tx, ZERO_COUNTERS.beaconsTx),
      beaconsRx: num(c.beacons_rx, ZERO_COUNTERS.beaconsRx),
      beaconsBadMagic: num(c.beacons_bad_magic, ZERO_COUNTERS.beaconsBadMagic),
      beaconsBadTag: num(c.beacons_bad_tag, ZERO_COUNTERS.beaconsBadTag),
      beaconsStaleDropped: num(
        c.beacons_stale_dropped,
        ZERO_COUNTERS.beaconsStaleDropped,
      ),
      neighborsNow: num(c.neighbors_now, ZERO_COUNTERS.neighborsNow),
    },
  };
}

/**
 * Poll one ground station's swarm neighbour table. `host` is the reachable
 * address (IP, mDNS name, or full URL — the shape the pairing probe accepts).
 * Never throws; returns null when the node did not answer usefully.
 */
export async function fetchSwarmNeighbors(
  host: string,
  apiKey: string | null,
  receivedAtMs: number = Date.now(),
): Promise<SwarmNeighborsSnapshot | null> {
  const isHttps =
    typeof window !== "undefined" && window.location.protocol === "https:";

  try {
    if (isHttps) {
      const res = await fetch("/api/lan-pair/swarm-neighbors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host, apiKey: apiKey ?? undefined }),
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return null;
      return parseSwarmNeighbors(await res.json(), receivedAtMs);
    }

    const base = host.startsWith("http") ? host : `http://${host}:8080`;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey) headers["X-ADOS-Key"] = apiKey;
    const res = await fetch(`${base}/api/swarm/neighbors`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    return parseSwarmNeighbors(await res.json(), receivedAtMs);
  } catch {
    return null;
  }
}
