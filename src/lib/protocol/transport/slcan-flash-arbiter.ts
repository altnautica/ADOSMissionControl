/**
 * SLCAN flash arbiter.
 *
 * Owns the transition from MAVLink-over-WebSerial to an SLCAN session on
 * the same physical USB port, and the reverse. It follows ArduPilot's SLCAN
 * parameter semantics:
 *
 *   - `CAN_SLCAN_CPORT` selects the CAN interface and is applied at boot, so
 *     when it changes the FC is rebooted (and MAVLink reconnected on the
 *     re-enumerated port) before going further.
 *   - `CAN_SLCAN_TIMOUT` is written before the switch, so the FC always has
 *     a way back to MAVLink. 0 ("never revert") is refused.
 *   - `CAN_SLCAN_SERNUM` is what hands the serial port to SLCAN (after
 *     `CAN_SLCAN_SDELAY`). It is written last, after everything else is in
 *     place; it resets on reboot.
 *
 * MAV_CMD_CAN_FORWARD is not part of this: it is the MAVLink CAN_FRAME
 * tunnel, not a switch of the USB port to SLCAN.
 *
 * On exit the SLCAN session is closed and MAVLink is retried until the FC's
 * `CAN_SLCAN_TIMOUT` idle watchdog hands the port back, then
 * `CAN_SLCAN_CPORT` is cleared and committed so the next boot does not route
 * CAN to SLCAN again.
 *
 * A port that re-enumerates after a reboot is matched by USB vendor/product
 * id against the port the FC was on, never by its position in the granted
 * list; an ambiguous match fails instead of guessing.
 *
 * @module protocol/transport/slcan-flash-arbiter
 * @license GPL-3.0-only
 */

import type { DroneProtocol, Transport } from "../types";
import { WebSerialTransport } from "./webserial";
import { SlcanTransport } from "./slcan";
import { useSlcanModeStore } from "@/stores/slcan-mode-store";
import { useDroneManager } from "@/stores/drone-manager";

/** Public params for entering SLCAN mode. */
export interface EnterSlcanOpts {
  protocol: DroneProtocol;
  droneId: string;
  bus: 1 | 2;
  bitrate: number;
  /** CAN_SLCAN_TIMOUT: seconds of SLCAN silence before the FC returns the port to MAVLink. */
  timeoutSec: number;
}

/** CAN_SLCAN_TIMOUT is stored as an INT8 on ArduPilot (range 0..127 s). */
export const SLCAN_TIMEOUT_MAX_S = 127;

export interface SlcanSession {
  slcanTransport: SlcanTransport;
  exitFn: () => Promise<void>;
}

// ── Timing constants ────────────────────────────────────────────────

const REBOOT_SETTLE_MS = 1500;
const PORT_POLL_INTERVAL_MS = 500;
const PORT_POLL_MAX_MS = 10_000;
/** How long a rebooting native-USB FC gets to drop its old port. */
const PORT_DISAPPEAR_MAX_MS = 5_000;
/** Budget for the first heartbeat after a reboot (the adapter waits 10 s per attempt). */
const POST_REBOOT_MAVLINK_MS = 20_000;
/** CAN_SLCAN_SDELAY default (1 s) plus margin: the FC switches the port this long after SERNUM. */
const SERNUM_SWITCH_SETTLE_MS = 1500;
/** Margin past CAN_SLCAN_TIMOUT before giving up on MAVLink after an exit. */
const EXIT_REVERT_MARGIN_MS = 15_000;

// ── Helpers ─────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Pull the SerialPort handle off a transport that exposes `getPort()`.
 * Returns null for non-serial transports (cloud, websocket, MQTT).
 */
function getSerialPort(transport: Transport): SerialPort | null {
  if (transport && "getPort" in transport) {
    return (transport as { getPort(): SerialPort | null }).getPort();
  }
  return null;
}

/** The USB identity Web Serial exposes for a port. */
export interface SerialPortUsbInfo {
  usbVendorId?: number;
  usbProductId?: number;
}

/**
 * Pick the flight controller's port out of the granted ports after a reboot.
 * Prefers the very same SerialPort object; otherwise the one port whose USB
 * vendor/product id matches the FC's. Returns null while nothing matches yet
 * and throws when the match is ambiguous or the FC's port has no USB id.
 */
export function matchReenumeratedPort(
  saved: SerialPort,
  savedInfo: SerialPortUsbInfo,
  ports: readonly SerialPort[],
): SerialPort | null {
  if (ports.includes(saved)) return saved;
  if (savedInfo.usbVendorId === undefined) {
    throw new Error("The flight controller's serial port has no USB id, so it cannot be found again after a reboot");
  }
  const matches = ports.filter((p) => {
    const info = p.getInfo();
    return info.usbVendorId === savedInfo.usbVendorId && info.usbProductId === savedInfo.usbProductId;
  });
  if (matches.length > 1) {
    throw new Error("More than one granted serial device matches the flight controller's USB id. Unplug the others and retry.");
  }
  return matches[0] ?? null;
}

/**
 * Wait for the FC's USB port to come back after a reboot. First waits for
 * the old port to drop (a bridge board keeps it, which ends the wait at the
 * deadline), then polls `navigator.serial.getPorts()` for the matching port,
 * so no user gesture is required.
 */
async function waitForPortReappear(saved: SerialPort): Promise<SerialPort> {
  if (typeof navigator === "undefined" || !("serial" in navigator)) {
    throw new Error("Web Serial is not available");
  }
  const savedInfo = saved.getInfo();
  const goneBy = Date.now() + PORT_DISAPPEAR_MAX_MS;
  while (Date.now() < goneBy) {
    const ports = await navigator.serial.getPorts();
    if (!ports.includes(saved)) break;
    await delay(PORT_POLL_INTERVAL_MS);
  }
  const deadline = Date.now() + PORT_POLL_MAX_MS;
  while (Date.now() < deadline) {
    const port = matchReenumeratedPort(saved, savedInfo, await navigator.serial.getPorts());
    if (port) return port;
    await delay(PORT_POLL_INTERVAL_MS);
  }
  throw new Error(
    `Serial port did not reappear within ${PORT_POLL_MAX_MS / 1000}s`,
  );
}

/**
 * Reopen `port` as MAVLink and reconnect `protocol`, retrying until a
 * heartbeat arrives or `budgetMs` runs out. The drone manager is pointed at
 * the live byte transport so its close handler tracks the right link.
 */
async function reconnectMavlink(
  protocol: DroneProtocol,
  port: SerialPort,
  droneId: string,
  budgetMs: number,
): Promise<void> {
  const deadline = Date.now() + budgetMs;
  let lastError: unknown = null;
  do {
    const byteTransport = new WebSerialTransport();
    try {
      await byteTransport.connectToPort(port, 115200);
      await protocol.connect(byteTransport);
      // swapTransport is a no-op if the drone is gone, which matches the
      // "reboot drained the entry" case.
      useDroneManager.getState().swapTransport(droneId, byteTransport);
      return;
    } catch (err) {
      lastError = err;
      await byteTransport.disconnect().catch(() => {});
      await delay(PORT_POLL_INTERVAL_MS);
    }
  } while (Date.now() < deadline);
  throw new Error(`MAVLink did not come back within ${Math.round(budgetMs / 1000)} s: ${errorText(lastError)}`);
}

/** Best-effort rollback: revert the param flip and re-mark store as error. */
async function rollback(protocol: DroneProtocol, reason: string): Promise<never> {
  try {
    if (protocol.isConnected) {
      await protocol.setParameter("CAN_SLCAN_CPORT", 0).catch(() => {});
    }
  } catch {
    // Swallow — rollback is best-effort.
  }
  useSlcanModeStore.getState().markError(reason);
  throw new Error(reason);
}

/** Write one param; a refused or failed write yields its reason, success yields null. */
async function writeParam(protocol: DroneProtocol, name: string, value: number): Promise<string | null> {
  try {
    const result = await protocol.setParameter(name, value);
    return result.success ? null : result.message || "rejected by the FC";
  } catch (err) {
    return errorText(err);
  }
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Enter SLCAN mode on the connected FC. Returns the opened SLCAN
 * transport and an `exitFn` that the caller MUST invoke (typically in a
 * finally block) to restore the MAVLink connection.
 *
 * Pre-conditions:
 *   - The store is in IDLE.
 *   - `protocol` is connected over a WebSerial-compatible transport
 *     (other transports throw immediately — SLCAN needs direct USB).
 */
export async function enterSlcanMode(
  opts: EnterSlcanOpts,
): Promise<SlcanSession> {
  const { protocol, droneId, bus, bitrate, timeoutSec } = opts;
  if (!Number.isInteger(timeoutSec) || timeoutSec < 1 || timeoutSec > SLCAN_TIMEOUT_MAX_S) {
    throw new Error(
      `SLCAN timeout must be an integer 1..${SLCAN_TIMEOUT_MAX_S} s (CAN_SLCAN_TIMOUT is an INT8; 0 would never return the port to MAVLink)`,
    );
  }

  const transport = (protocol as unknown as { transport?: Transport }).transport;
  const savedPort = transport ? getSerialPort(transport) : null;
  if (!savedPort) {
    throw new Error("SLCAN requires direct USB (WebSerial transport)");
  }

  const store = useSlcanModeStore.getState();
  store.beginEntering({ droneId, bus, bitrate, timeoutSec });

  // 1. CPORT is applied at boot; only a change needs a reboot.
  let cportChanged = true;
  try {
    const current = await protocol.getParameter("CAN_SLCAN_CPORT");
    cportChanged = current.value !== bus;
  } catch {
    // Unknown current value: take the reboot so the routing is certain.
  }

  // 2. Interface and the revert watchdog first. A refused write aborts the
  //    entry: continuing would leave the FC routing somewhere other than
  //    what the session assumes.
  const writes: ReadonlyArray<readonly [string, number]> = [
    ["CAN_SLCAN_CPORT", bus],
    ["CAN_SLCAN_TIMOUT", timeoutSec],
  ];
  for (const [name, value] of writes) {
    const failure = await writeParam(protocol, name, value);
    if (failure !== null) {
      return rollback(protocol, `Failed to set ${name}=${value}: ${failure}`);
    }
  }
  try {
    await protocol.commitParamsToFlash();
  } catch {
    // ArduPilot writes PARAM_SET straight to storage; the commit is a backstop.
  }

  // 3. Apply a changed CPORT with a reboot, then get MAVLink back on the
  //    same physical FC so SERNUM can be written (it resets on reboot).
  let port = savedPort;
  if (cportChanged) {
    try {
      await protocol.reboot();
    } catch {
      // Many FCs disconnect mid-reply — that is expected.
    }
    // Mark the upcoming transport close as intentional so the drone
    // manager's close handler does not remove the ManagedDrone.
    useDroneManager.getState().markIntentionalDisconnect(droneId);
    try {
      await protocol.disconnect();
    } catch {
      // ignore
    }
    await delay(REBOOT_SETTLE_MS);
    try {
      port = await waitForPortReappear(savedPort);
      await reconnectMavlink(protocol, port, droneId, POST_REBOOT_MAVLINK_MS);
    } catch (err) {
      return rollback(protocol, `Reboot path failed: ${errorText(err)}`);
    }
  }

  // 4. SERNUM last: it hands the USB serial port to SLCAN after
  //    CAN_SLCAN_SDELAY. A refusal aborts; a lost reply after the port
  //    flipped is expected and the SLCAN handshake below is the real check.
  try {
    const result = await protocol.setParameter("CAN_SLCAN_SERNUM", 0);
    if (!result.success) {
      return rollback(protocol, `Failed to set CAN_SLCAN_SERNUM=0: ${result.message || "rejected by the FC"}`);
    }
  } catch {
    // The port may already be SLCAN.
  }
  useDroneManager.getState().markIntentionalDisconnect(droneId);
  try {
    await protocol.disconnect();
  } catch {
    // ignore
  }
  await delay(SERNUM_SWITCH_SETTLE_MS);

  // 5. Open the same port as a byte channel and wrap it in SLCAN.
  const byteTransport = new WebSerialTransport();
  try {
    await byteTransport.connectToPort(port, 115200);
  } catch (err) {
    return rollback(protocol, `Failed to reopen port for SLCAN: ${errorText(err)}`);
  }

  const slcanTransport = new SlcanTransport(byteTransport, true);
  try {
    await slcanTransport.open({ bitrate });
  } catch (err) {
    await byteTransport.disconnect().catch(() => {});
    return rollback(protocol, `SLCAN handshake failed: ${errorText(err)}`);
  }

  useSlcanModeStore.getState().markActive();

  const exitFn = () =>
    exitSlcanMode({ slcanTransport, port, timeoutSec, protocol, droneId });
  // Register the closure on the store so the top-of-shell banner can
  // drive a "Resume MAVLink" button without needing a direct reference
  // back to the panel that triggered entry.
  useSlcanModeStore.getState().setExitFn(exitFn);
  return { slcanTransport, exitFn };
}

// ── Exit ────────────────────────────────────────────────────────────

interface ExitOpts {
  slcanTransport: SlcanTransport;
  port: SerialPort;
  timeoutSec: number;
  protocol: DroneProtocol;
  droneId: string;
}

/**
 * Tear down the SLCAN session and restore MAVLink on the same physical
 * port. The FC returns the port to MAVLink only after `CAN_SLCAN_TIMOUT`
 * seconds without SLCAN traffic, so the reconnect is retried for that long
 * plus a margin. Once MAVLink is back, `CAN_SLCAN_CPORT` is cleared and
 * committed so a later boot does not route CAN to SLCAN.
 */
async function exitSlcanMode(opts: ExitOpts): Promise<void> {
  const { slcanTransport, port, timeoutSec, protocol, droneId } = opts;
  const store = useSlcanModeStore.getState();
  store.beginExiting();

  // 1. Close the SLCAN session. The codec sends `C\r` defensively; we
  //    own the byte transport so its disconnect runs inline.
  try {
    await slcanTransport.close();
  } catch {
    // best effort
  }

  // 2. Reopen the port as MAVLink once the FC's idle watchdog reverts it.
  store.markReconnecting();
  try {
    await reconnectMavlink(protocol, port, droneId, timeoutSec * 1000 + EXIT_REVERT_MARGIN_MS);
  } catch (err) {
    store.markError(`Failed to reopen MAVLink: ${errorText(err)}`);
    throw err;
  }

  // 3. Clear the routing so the next boot does not re-enter SLCAN.
  const failure = await writeParam(protocol, "CAN_SLCAN_CPORT", 0);
  if (failure === null) {
    try {
      await protocol.commitParamsToFlash();
    } catch {
      // ArduPilot writes PARAM_SET straight to storage.
    }
  }

  store.reset();
}
