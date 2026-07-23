/**
 * @module hardware/radio/cloud-radio
 * @description Picks the radio block for the node a panel is rendering
 * from the per-drone cloud-status rows, so the live link card can render
 * either from the direct LAN poll or from the heartbeat fan-out.
 * @license GPL-3.0-only
 */

import type { RadioState } from "@/lib/api/ground-station/types";

interface CloudStatusRadio {
  status?: {
    radio?: RadioState;
    deviceId?: string;
    mdnsHost?: string;
    name?: string;
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
  if (!deviceId || !Array.isArray(rows) || rows.length === 0) {
    return { radio: null, hostname: null };
  }
  for (const row of rows as CloudStatusRadio[]) {
    const rowDeviceId = row.drone?.deviceId ?? row.status?.deviceId;
    if (rowDeviceId !== deviceId) continue;
    const radio = row.status?.radio;
    if (!radio) continue;
    return {
      radio,
      hostname:
        row.drone?.mdnsHost ?? row.drone?.name ?? row.drone?.deviceId ?? null,
    };
  }
  return { radio: null, hostname: null };
}

/**
 * Pick the freshest fleet node that is RECEIVING a peer's downlink — it reports
 * a valid WFB decode rate. This is the calibration measurement source: the
 * receiver's decode-side stats are what a transmit-side sweep is scored
 * against. Returns nulls when no node in the fleet reports decode stats.
 */
export function pickReceiverFromCloud(rows: unknown): PickedCloudRadio {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { radio: null, hostname: null };
  }
  let bestRadio: RadioState | null = null;
  let bestHost: string | null = null;
  let bestUpdatedAt = -Infinity;
  for (const row of rows as CloudStatusRadio[]) {
    const radio = row.status?.radio;
    if (!radio || radio.validRxPacketsPerS == null) continue;
    const updatedAt =
      ((row.status as Record<string, unknown> | null | undefined)?.[
        "updatedAt"
      ] as number | undefined) ?? 0;
    if (updatedAt > bestUpdatedAt) {
      bestUpdatedAt = updatedAt;
      bestRadio = radio;
      bestHost = row.drone?.mdnsHost ?? row.drone?.name ?? row.drone?.deviceId ?? null;
    }
  }
  return { radio: bestRadio, hostname: bestHost };
}
