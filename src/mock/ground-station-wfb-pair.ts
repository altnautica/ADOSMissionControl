/**
 * @module mock/ground-station-wfb-pair
 * @description In-memory fleet-key pair client for the demo ground station.
 * It answers `pairDrone` / `unpairDrone` with the agent's reply shapes and
 * refuses a bad request with the agent's status and `detail.error.code`, so the
 * Pair modal drives the real store action in demo. The demo seed installs it
 * through `setDemoPairApi`.
 * @license GPL-3.0-only
 */

import { GroundStationApiError, type GroundStationApi } from "@/lib/api/ground-station-api";
import type {
  FleetSlotRow,
  PairResult,
  SharedKeyOutcome,
  UnpairResult,
} from "@/lib/api/ground-station/types";

/** The demo pair client's origin. */
export const DEMO_PAIR_BASE_URL = "mock://demo";

/** A wfb-ng key file is exactly this many bytes. */
export const WFB_KEY_FILE_BYTES = 64;

/** Fleet slots one ground station issues. */
export const DEMO_FLEET_MAX_SLOTS = 8;

/** A well-formed demo drone key (64 bytes, base64). */
export const DEMO_PAIR_KEY_B64 = btoa(
  String.fromCharCode(...Array.from({ length: WFB_KEY_FILE_BYTES }, (_, i) => i)),
);

/** A device id the agent accepts (8 to 32 of letters, digits, '-', '_', '.'). */
export const DEMO_PAIR_DEVICE_ID = "demo-drone-01";

/** Fingerprint the demo reports for the installed fleet key. */
export const DEMO_PAIR_FINGERPRINT = "3f9a1c07d24e8b56";

const DEVICE_ID_RE = /^[A-Za-z0-9._-]{8,32}$/;

/** The agent's `{detail:{error:{code,message}}}` refusal. */
function refusal(status: number, code: string, message?: string): GroundStationApiError {
  const error = message ? { code, message } : { code };
  return new GroundStationApiError(status, JSON.stringify({ detail: { error } }));
}

/** Decoded byte length of a strict standard-alphabet base64 string, or null. */
function base64ByteLength(b64: string): number | null {
  if (b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return null;
  try {
    return atob(b64).length;
  } catch {
    return null;
  }
}

/** The pair methods the Pair modal calls. */
export type DemoPairMethods = Pick<GroundStationApi, "baseUrl" | "pairDrone" | "unpairDrone">;

interface DemoPairState {
  /** The installed fleet key, or null when unpaired. */
  key: string | null;
  /** The installed shared half the beacon key derives from, or null. */
  sharedKey: string | null;
  slots: FleetSlotRow[];
}

export class DemoGroundStationPair implements DemoPairMethods {
  readonly baseUrl = DEMO_PAIR_BASE_URL;
  private state: DemoPairState = { key: null, sharedKey: null, slots: [] };

  /** Back to an unpaired station with an empty fleet. */
  reset(): void {
    this.state = { key: null, sharedKey: null, slots: [] };
  }

  /** Mirrors the agent's guard order: blob present, device id, blob decode,
   *  shared-key check, then the fleet-key gate and slot allocation. */
  pairDrone = async (
    blobB64: string,
    droneDeviceId: string,
    sharedKeyB64?: string,
  ): Promise<PairResult> => {
    const blob = blobB64.replace(/\s+/g, "");
    const deviceId = droneDeviceId.trim();
    if (!blob) throw refusal(400, "E_BLOB_REQUIRED");
    if (!deviceId) {
      throw refusal(400, "E_DEVICE_ID_REQUIRED", "drone_device_id is required");
    }
    if (!DEVICE_ID_RE.test(deviceId)) {
      throw refusal(
        400,
        "E_DEVICE_ID_INVALID",
        "drone_device_id must be 8 to 32 characters of letters, digits, '-', '_' or '.'",
      );
    }
    const bytes = base64ByteLength(blob);
    if (bytes === null) throw refusal(400, "E_BLOB_BASE64", "Invalid input");
    if (bytes !== WFB_KEY_FILE_BYTES) {
      throw refusal(
        400,
        "E_INVALID_KEY_BLOB",
        `key blob is ${bytes} bytes, expected ${WFB_KEY_FILE_BYTES}`,
      );
    }
    const shared = sharedKeyB64?.replace(/\s+/g, "") || null;
    if (shared !== null) {
      const sharedBytes = base64ByteLength(shared);
      if (sharedBytes !== WFB_KEY_FILE_BYTES) {
        throw refusal(
          400,
          "E_SHARED_KEY_INVALID",
          sharedBytes === null
            ? "shared key is not valid base64"
            : `shared key is ${sharedBytes} bytes, expected ${WFB_KEY_FILE_BYTES}`,
        );
      }
    }
    const joining = this.state.key !== null;
    if (joining && this.state.key !== blob) {
      throw refusal(
        409,
        "E_FLEET_KEY_MISMATCH",
        "this ground station already holds a different fleet key; unpair before pairing a different fleet",
      );
    }
    let row = this.state.slots.find((s) => s.device_id === deviceId);
    if (!row) {
      const taken = new Set(this.state.slots.map((s) => s.slot));
      const free = Array.from({ length: DEMO_FLEET_MAX_SLOTS }, (_, i) => i).find(
        (s) => !taken.has(s),
      );
      if (free === undefined) {
        throw refusal(
          409,
          "E_FLEET_FULL",
          `all ${DEMO_FLEET_MAX_SLOTS} fleet slots are taken; release one before pairing another drone`,
        );
      }
      row = {
        slot: free,
        device_id: deviceId,
        paired_at_ms: Date.now(),
        fc_system_id: null,
        system_id_conflict: false,
        video_hero: this.state.slots.length === 0,
        relay_credential: "pending",
      };
      this.state.slots = [...this.state.slots, row];
    }
    this.state.key = blob;
    let sharedOutcome: SharedKeyOutcome | undefined;
    if (shared !== null) {
      if (this.state.sharedKey === shared) sharedOutcome = "unchanged";
      else if (joining && this.state.sharedKey !== null) sharedOutcome = "mismatch";
      else {
        this.state.sharedKey = shared;
        sharedOutcome = "installed";
      }
    }
    return {
      paired: true,
      paired_with_device_id: deviceId,
      paired_at: joining ? null : new Date().toISOString(),
      fingerprint: DEMO_PAIR_FINGERPRINT,
      role: "gs",
      fleet_slot: row.slot,
      slots: this.state.slots.map((s) => ({ ...s })),
      ...(sharedOutcome ? { shared_key: sharedOutcome } : {}),
    };
  };

  unpairDrone = async (): Promise<UnpairResult> => {
    this.reset();
    return { paired: false, role: "gs" };
  };
}

/** The one demo pair client; the seed resets it on every reseed. */
export const demoGroundStationPair = new DemoGroundStationPair();
