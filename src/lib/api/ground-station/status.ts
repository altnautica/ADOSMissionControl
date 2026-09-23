// Ground station overall status snapshot.

import type { GroundStationStatusResponse } from "./types";
import { gsRequest, type RequestContext } from "./request";

type Raw = Record<string, unknown>;

function asObj(v: unknown): Raw {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {};
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Map the agent's `/ground-station/status` body (ados-control `gs_status.rs`
 * get_status) onto the store shape. The agent always sends `paired_drone` as
 * an object whose `device_id` is null while unpaired, carries the radio view
 * under `link` (with `fec_recovered`/`fec_lost`), spells the profile
 * `ground-station`, and reports no active uplink on this surface.
 */
export function normaliseGroundStationStatus(body: unknown): GroundStationStatusResponse {
  const b = asObj(body);
  const paired = asObj(b.paired_drone);
  const link = asObj(b.link);
  return {
    paired_drone: typeof paired.device_id === "string" ? paired.device_id : null,
    profile:
      b.profile === "ground-station" || b.profile === "ground_station"
        ? "ground_station"
        : b.profile === "drone" || b.profile === "auto"
          ? b.profile
          : "unconfigured",
    uplink_active: null,
    link_health: {
      rssi_dbm: numOrNull(link.rssi_dbm),
      bitrate_mbps: numOrNull(link.bitrate_mbps),
      fec_rec: numOrNull(link.fec_recovered) ?? 0,
      fec_lost: numOrNull(link.fec_lost) ?? 0,
      channel: numOrNull(link.channel),
    },
  };
}

export async function getStatus(ctx: RequestContext): Promise<GroundStationStatusResponse> {
  return normaliseGroundStationStatus(
    await gsRequest<unknown>(ctx, "/api/v1/ground-station/status"),
  );
}
