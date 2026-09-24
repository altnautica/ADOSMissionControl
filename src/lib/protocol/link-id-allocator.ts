/**
 * @module protocol/link-id-allocator
 * @description Allocates MAVLink v2 signing link ids per (drone, browser).
 *
 * MAVLink signing uses the link_id byte as a per-channel namespace for
 * replay protection: the flight controller tracks last-seen timestamp per
 * (sysid, compid, link_id). Two browsers talking to the same drone with
 * the same link_id will have their frames rejected as replays when their
 * timestamps interleave.
 *
 * A stable per-browser device id is hashed into the 1..254 range, so the
 * same browser always takes the same link id with no coordination service.
 * Collision probability is low enough for single-user, 2-3 device
 * scenarios. Signing keys stay in this browser's IndexedDB; nothing about
 * the allocation leaves the browser. Reserved values:
 *   0   - reserved for the "single-browser direct" default
 *   255 - reserved for future use (broadcast or coordination channel)
 *
 * @license GPL-3.0-only
 */

const DEVICE_ID_KEY = "ados-device-id";

/**
 * SECURITY NOTE: this key is NOT an authentication credential.
 *
 * It is a stable per-browser fingerprint used purely to allocate the
 * MAVLink signing link_id slot on the FC and to group same-browser
 * events in the audit log. There is no exfil risk: anyone can generate
 * a random UUID for themselves; nothing the agent or FC trusts about
 * a request derives from this value. The actual auth credential
 * (X-ADOS-Key) lives in-memory in pairing-store / agent-connection-store
 * and is never persisted to localStorage. See tests/lib/auth-storage.test.ts
 * for the regression net that enforces this.
 */

/**
 * Return the stable per-browser device id, creating one on first call.
 * Persisted to localStorage so the same browser allocates the same link
 * id across reloads.
 */
export function getOrCreateDeviceId(): string {
  // Wrapped in try/catch: some sandboxed contexts (SSR, Electron tests,
  // Vitest node env without jsdom, some iframe sandboxes) expose a
  // broken localStorage where .getItem throws.
  try {
    if (typeof localStorage !== "undefined" && typeof localStorage.getItem === "function") {
      let id = localStorage.getItem(DEVICE_ID_KEY);
      if (id === null || id.length === 0) {
        id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        try {
          localStorage.setItem(DEVICE_ID_KEY, id);
        } catch {
          // private mode or quota exceeded; id stays process-local
        }
      }
      return id;
    }
  } catch {
    // localStorage broken in this context; fall through to fallback.
  }
  return "ssr-fallback-device-id";
}

/**
 * Hash a device id into the 1..254 inclusive range.
 *
 * Uses the same polynomial rolling hash the SigningPanel used inline
 * before this allocator was extracted. Kept bit-identical so existing
 * enrollments do not shift link ids on upgrade.
 */
export function allocateLocalLinkId(deviceId?: string): number {
  const id = deviceId ?? getOrCreateDeviceId();
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) & 0xffff;
  }
  return 1 + (hash % 254);
}

/**
 * True when `candidate` is a valid MAVLink link id.
 * 0 and 255 are reserved.
 */
export function isReservedLinkId(candidate: number): boolean {
  return candidate === 0 || candidate === 255;
}

/**
 * Validate a user-supplied link id (e.g., from "bring your own key" import).
 */
export function assertValidLinkId(candidate: number): void {
  if (!Number.isInteger(candidate) || candidate < 0 || candidate > 255) {
    throw new Error(`link_id must be an integer in [0, 255], got ${candidate}`);
  }
}
