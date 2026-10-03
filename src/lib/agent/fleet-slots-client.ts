/**
 * @module agent/fleet-slots-client
 * @description LAN client for a ground station's fleet slot table, served on
 * `GET /api/wfb/pair` as `slots`. Each row names the drone that holds the
 * slot, the MAVLink system id the station hears on it, whether that id
 * collides with another slot's, whether the slot's video is the one the
 * station serves, and whether the drone holds the station's relay credential.
 *
 * On an HTTPS origin the call routes through Mission Control's own
 * `/api/lan-pair/fleet-slots` proxy (mixed-content guard); on HTTP or the
 * desktop app it fetches the station directly.
 *
 * Never throws. `null` means the table could not be read (unreachable, stale
 * key, malformed body); that is distinct from an empty roster, so a caller
 * never treats "could not ask" as "no drones".
 *
 * @license GPL-3.0-only
 */

import type { FleetSlotRow, RelayCredentialState } from "@/lib/api/ground-station/types";

const FETCH_TIMEOUT_MS = 6000;

const CREDENTIAL_STATES: readonly RelayCredentialState[] = ["pending", "held", "conflict"];

function parseSlot(raw: unknown): FleetSlotRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.slot !== "number" || typeof r.device_id !== "string" || r.device_id.length === 0) {
    return null;
  }
  const sysid =
    typeof r.fc_system_id === "number" && Number.isInteger(r.fc_system_id) && r.fc_system_id > 0
      ? r.fc_system_id
      : null;
  const credential = CREDENTIAL_STATES.find((s) => s === r.relay_credential) ?? "pending";
  return {
    slot: r.slot,
    device_id: r.device_id,
    paired_at_ms: typeof r.paired_at_ms === "number" ? r.paired_at_ms : 0,
    fc_system_id: sysid,
    system_id_conflict: r.system_id_conflict === true,
    video_hero: r.video_hero === true,
    relay_credential: credential,
  };
}

/** Parse the `slots` array of a pair-status body; null when it is absent. */
export function parseFleetSlots(body: unknown): FleetSlotRow[] | null {
  if (!body || typeof body !== "object" || !("slots" in body)) return null;
  const slots = body.slots;
  if (!Array.isArray(slots)) return null;
  return slots.map(parseSlot).filter((s): s is FleetSlotRow => s !== null);
}

/** Fetch a ground station's fleet slot table, or null when it cannot be read. */
export async function fetchFleetSlots(
  host: string,
  apiKey: string | null,
): Promise<FleetSlotRow[] | null> {
  const isHttps = typeof window !== "undefined" && window.location.protocol === "https:";
  try {
    const res = isHttps
      ? await fetch("/api/lan-pair/fleet-slots", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ host, apiKey: apiKey ?? undefined }),
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        })
      : await fetch(`${host.startsWith("http") ? host : `http://${host}:8080`}/api/wfb/pair`, {
          method: "GET",
          headers: apiKey
            ? { Accept: "application/json", "X-ADOS-Key": apiKey }
            : { Accept: "application/json" },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
    if (!res.ok) return null;
    return parseFleetSlots(await res.json());
  } catch {
    return null;
  }
}
