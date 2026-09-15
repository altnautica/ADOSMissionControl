/**
 * @module hardware/radio/cloud-radio
 * @description Picks the radio block for the node a panel is rendering
 * from the per-drone cloud-status rows, so the live link card can render
 * either from the direct LAN poll or from the heartbeat fan-out.
 * @license GPL-3.0-only
 */

import type { RadioState } from "@/lib/api/ground-station/types";
import { LAN_SNAPSHOT_STALE_MS } from "@/stores/ground-station/link-store";

/**
 * How old a cloud status row may be and still count as a reading. The row is a
 * heartbeat fan-out, so a node that went offline an hour ago leaves its last
 * row in place forever; without this the Radio tab renders that hour-old SNR,
 * MCS and acquire state as current.
 */
export const CLOUD_ROW_MAX_AGE_MS = 15_000;

interface CloudStatusRadio {
  status?: {
    radio?: RadioState;
    deviceId?: string;
    mdnsHost?: string;
    name?: string;
    updatedAt?: number;
  } | null;
  drone?: {
    deviceId?: string;
    name?: string;
    mdnsHost?: string;
  };
}

export interface PickedCloudRadio {
  radio: RadioState | null;
  hostname: string | null;
  /** Epoch ms the row was last written, or null when it carries no stamp. */
  updatedAt: number | null;
}

/**
 * Pick the radio block belonging to the node whose panel is rendering,
 * keyed by that node's deviceId. Selecting "the freshest row carrying any
 * radio block" would render one node's radio on another node's panel — a
 * status surface reporting a different node's link (Rule 44). When the
 * deviceId is unknown, or no matching row carries a radio block, this
 * returns nulls so the panel falls back to its own direct-poll data rather
 * than borrowing a peer's snapshot.
 */
export function pickRadioFromCloud(
  rows: unknown,
  deviceId: string | null,
): PickedCloudRadio {
  const none: PickedCloudRadio = { radio: null, hostname: null, updatedAt: null };
  if (!deviceId || !Array.isArray(rows) || rows.length === 0) return none;
  for (const row of rows as CloudStatusRadio[]) {
    const rowDeviceId = row.drone?.deviceId ?? row.status?.deviceId;
    if (rowDeviceId !== deviceId) continue;
    const radio = row.status?.radio;
    if (!radio) continue;
    return {
      radio,
      hostname:
        row.drone?.mdnsHost ?? row.drone?.name ?? row.drone?.deviceId ?? null,
      updatedAt:
        typeof row.status?.updatedAt === "number" ? row.status.updatedAt : null,
    };
  }
  return none;
}

export interface RadioSourceInput {
  /** Stamp on the picked cloud row, null when it carries none. */
  cloudUpdatedAt: number | null;
  /** When the LAN poll last landed a status snapshot, null when never. */
  lanFetchedAt: number | null;
  now: number;
}

export interface RadioSource {
  /** The cloud row is young enough to be a reading at all. */
  cloudFresh: boolean;
  /** The LAN snapshot is young enough to be a reading at all. */
  lanFresh: boolean;
  /**
   * The cloud row proves, by its own timestamp, that it is newer than the LAN
   * snapshot. Only then may it override a value the LAN poll also carries.
   */
  cloudWinsShared: boolean;
}

/**
 * Which source may speak for a reading both the LAN poll and the cloud row
 * carry (RSSI, bitrate, channel, FEC).
 *
 * The panel used to prefer the cloud row unconditionally and with no staleness
 * check at all, so an hour-old heartbeat beat a 2 Hz LAN poll from the agent
 * sitting on the same network. Local-first is the rule: the cloud row wins a
 * shared reading only when it carries a timestamp newer than the LAN snapshot,
 * and a row with no timestamp never wins. Cloud-only readings (SNR, MCS,
 * adapter health, acquire state) still come from the row, but only while
 * `cloudFresh` — a stale row is not a reading.
 */
export function resolveRadioSource(input: RadioSourceInput): RadioSource {
  const { cloudUpdatedAt, lanFetchedAt, now } = input;
  const cloudFresh =
    cloudUpdatedAt !== null && now - cloudUpdatedAt <= CLOUD_ROW_MAX_AGE_MS;
  const lanFresh =
    lanFetchedAt !== null && now - lanFetchedAt <= LAN_SNAPSHOT_STALE_MS;
  return {
    cloudFresh,
    lanFresh,
    cloudWinsShared:
      cloudFresh &&
      (!lanFresh || (lanFetchedAt !== null && cloudUpdatedAt! > lanFetchedAt)),
  };
}

/**
 * Pick the freshest fleet node that is RECEIVING a peer's downlink — it reports
 * a valid WFB decode rate. This is the calibration measurement source: the
 * receiver's decode-side stats are what a transmit-side sweep is scored
 * against. Returns nulls when no node in the fleet reports decode stats.
 */
export function pickReceiverFromCloud(rows: unknown): PickedCloudRadio {
  const none: PickedCloudRadio = { radio: null, hostname: null, updatedAt: null };
  if (!Array.isArray(rows) || rows.length === 0) return none;
  let bestRadio: RadioState | null = null;
  let bestHost: string | null = null;
  let bestUpdatedAt = -Infinity;
  for (const row of rows as CloudStatusRadio[]) {
    const radio = row.status?.radio;
    if (!radio || radio.validRxPacketsPerS == null) continue;
    const updatedAt = typeof row.status?.updatedAt === "number" ? row.status.updatedAt : 0;
    if (updatedAt > bestUpdatedAt) {
      bestUpdatedAt = updatedAt;
      bestRadio = radio;
      bestHost = row.drone?.mdnsHost ?? row.drone?.name ?? row.drone?.deviceId ?? null;
    }
  }
  if (bestRadio === null) return none;
  return {
    radio: bestRadio,
    hostname: bestHost,
    updatedAt: bestUpdatedAt > 0 ? bestUpdatedAt : null,
  };
}
