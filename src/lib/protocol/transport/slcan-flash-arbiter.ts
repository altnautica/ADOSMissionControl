/**
 * SLCAN flash arbiter.
 *
 * Owns the transition from MAVLink-over-WebSerial to an SLCAN session on
 * the same physical USB port, and the reverse. Two strategies depending on
 * the chip family (see `lib/board-profiles/family.ts`):
 *
 *   - F4 (or unknown): the FC's CAN driver only routes to the SLCAN
 *     pipe on boot. We set the four `CAN_SLCAN_*` params, fire the storage
 *     commit, reboot the FC, drop the MAVLink transport, and poll
 *     `navigator.serial.getPorts()` for the same port to re-enumerate
 *     before opening it with the SLCAN codec.
 *
 *   - F7/H7/G4: the firmware honours `MAV_CMD_CAN_FORWARD` and switches
 *     the live MAVLink USB pipe into CAN passthrough without a reboot.
 *     We fire the command, drop the MAVLink transport, and reopen the
 *     same port as a byte channel for SLCAN.
 *
 * On exit the inverse happens. F4 exit is a special case: we cannot write
 * `CAN_SLCAN_CPORT=0` because MAVLink is gone, so we rely on the FC's
 * `CAN_SLCAN_TIMOUT` watchdog to auto-revert once the SLCAN port goes
 * idle. F7/H7/G4 exit re-issues `MAV_CMD_CAN_FORWARD(0)` after MAVLink
 * is re-attached.
 *
 * @module protocol/transport/slcan-flash-arbiter
 * @license GPL-3.0-only
 */

import type { DroneProtocol, Transport } from "../types";
import { WebSerialTransport } from "./webserial";
import { SlcanTransport } from "./slcan";
import {
  detectChipFamily,
  chipFamilyRequiresReboot,
  type ChipFamily,
} from "@/lib/board-profiles/family";
import { useSlcanModeStore } from "@/stores/slcan-mode-store";
import { useDroneManager } from "@/stores/drone-manager";

/** Public params for entering SLCAN mode. */
export interface EnterSlcanOpts {
  protocol: DroneProtocol;
  droneId: string;
  bus: 1 | 2;
  bitrate: number;
  timeoutSec: number;
}

export interface SlcanSession {
  slcanTransport: SlcanTransport;
  exitFn: () => Promise<void>;
}

// ── Timing constants ────────────────────────────────────────────────

const REBOOT_SETTLE_MS = 1500;
const PORT_POLL_INTERVAL_MS = 500;
const PORT_POLL_MAX_MS = 10_000;
const HOT_SWITCH_SETTLE_MS = 200;

// ── Helpers ─────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

/** Re-enumerate the previously-granted serial ports and return the first. */
async function findFirstPermittedPort(): Promise<SerialPort | null> {
  if (typeof navigator === "undefined" || !("serial" in navigator)) return null;
  try {
    const ports = await navigator.serial.getPorts();
    return ports.length > 0 ? ports[0] : null;
  } catch {
    return null;
  }
}

/**
 * Wait for the FC's USB port to come back after a reboot. Polls
 * `navigator.serial.getPorts()` so no user gesture is required.
 */
async function waitForPortReappear(): Promise<SerialPort> {
  const deadline = Date.now() + PORT_POLL_MAX_MS;
  while (Date.now() < deadline) {
    const port = await findFirstPermittedPort();
    if (port) return port;
    await delay(PORT_POLL_INTERVAL_MS);
  }
  throw new Error(
    `Serial port did not reappear within ${PORT_POLL_MAX_MS / 1000}s`,
  );
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

  const transport = (protocol as unknown as { transport?: Transport }).transport;
  const savedPort = transport ? getSerialPort(transport) : null;
  if (!savedPort) {
    throw new Error("SLCAN requires direct USB (WebSerial transport)");
  }

  const store = useSlcanModeStore.getState();
  store.beginEntering({ droneId, bus, bitrate, timeoutSec });

  // 1. Program the four SLCAN params.
  try {
    await protocol.setParameter("CAN_SLCAN_CPORT", bus);
    await protocol.setParameter("CAN_SLCAN_SERNUM", 0);
    await protocol.setParameter("CAN_SLCAN_TIMOUT", timeoutSec);
    await protocol.setParameter("CAN_SLCAN_OVRIDE", 1);
  } catch (err) {
    return rollback(
      protocol,
      `Failed to program SLCAN params: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 2. Fire-and-forget flash commit (ArduPilot does not reliably ACK).
  try {
    void protocol.commitParamsToFlash();
  } catch {
    // ignore — the param writes already hit EEPROM on most ArduPilot builds
  }

  // 3. Decide the entry path based on chip family.
  const info = protocol.getVehicleInfo();
  const family: ChipFamily =
    info?.boardId != null ? detectChipFamily(info.boardId) : "unknown";
  const rebootRequired = chipFamilyRequiresReboot(family);

  // 4. Drive the chosen path. Both end with the MAVLink transport gone
  //    and the same physical port available for the SLCAN codec.
  let port: SerialPort;
  if (rebootRequired) {
    // F4 / unknown: reboot the FC, then wait for the port to come back.
    try {
      await protocol.reboot();
    } catch {
      // Many FCs disconnect mid-reply — that is expected.
    }
    // Mark the upcoming transport close as intentional so the drone
    // manager's close handler does not fire the unexpected-disconnect
    // cleanup path and remove the ManagedDrone from the fleet.
    useDroneManager.getState().markIntentionalDisconnect(droneId);
    try {
      await protocol.disconnect();
    } catch {
      // ignore
    }
    await delay(REBOOT_SETTLE_MS);
    try {
      port = await waitForPortReappear();
    } catch (err) {
      return rollback(
        protocol,
        `Reboot path failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    // F7/H7/G4: live hot-switch via MAV_CMD_CAN_FORWARD.
    try {
      if (typeof protocol.enableCanForward !== "function") {
        return rollback(protocol, "FC firmware lacks enableCanForward()");
      }
      const result = await protocol.enableCanForward(bus);
      if (!result.success) {
        return rollback(
          protocol,
          `enableCanForward rejected by FC (code ${result.resultCode})`,
        );
      }
    } catch (err) {
      return rollback(
        protocol,
        `enableCanForward threw: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    await delay(HOT_SWITCH_SETTLE_MS);
    // Same rationale as the reboot path: tell the drone manager this is
    // an intentional teardown so the fleet entry survives.
    useDroneManager.getState().markIntentionalDisconnect(droneId);
    try {
      await protocol.disconnect();
    } catch {
      // ignore
    }
    port = savedPort;
  }

  // 5. Open the same port as a byte channel and wrap it in SLCAN.
  const byteTransport = new WebSerialTransport();
  try {
    await byteTransport.connectToPort(port, 115200);
  } catch (err) {
    return rollback(
      protocol,
      `Failed to reopen port for SLCAN: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const slcanTransport = new SlcanTransport(byteTransport, true);
  try {
    await slcanTransport.open({ bitrate });
  } catch (err) {
    await byteTransport.disconnect().catch(() => {});
    return rollback(
      protocol,
      `SLCAN handshake failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  useSlcanModeStore.getState().markActive();

  const exitFn = () =>
    exitSlcanMode({ slcanTransport, port, family, bus, protocol, droneId });
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
  family: ChipFamily;
  bus: 1 | 2;
  protocol: DroneProtocol;
  droneId: string;
}

/**
 * Tear down the SLCAN session and restore MAVLink on the same physical
 * port. The caller passes the original protocol so we can disable
 * CAN_FORWARD on the hot-switch path; the F4 path relies on the FC's
 * `CAN_SLCAN_TIMOUT` watchdog because MAVLink is paused when we exit.
 */
async function exitSlcanMode(opts: ExitOpts): Promise<void> {
  const { slcanTransport, port, family, bus, protocol, droneId } = opts;
  const store = useSlcanModeStore.getState();
  store.beginExiting();

  // 1. Close the SLCAN session. The codec sends `C\r` defensively; we
  //    own the byte transport so its disconnect runs inline.
  try {
    await slcanTransport.close();
  } catch {
    // best effort
  }

  // 2. Wait briefly so the OS releases the port handle.
  await delay(family === "F4" || family === "unknown" ? REBOOT_SETTLE_MS : HOT_SWITCH_SETTLE_MS);

  // 3. Reopen the port as MAVLink at 115200 and reconnect the protocol.
  const mavlinkByteTransport = new WebSerialTransport();
  store.markReconnecting();
  try {
    let nextPort: SerialPort = port;
    if (family === "F4" || family === "unknown") {
      // After auto-revert the port may have re-enumerated. Re-discover.
      nextPort = (await findFirstPermittedPort()) ?? port;
    }
    await mavlinkByteTransport.connectToPort(nextPort, 115200);
    await protocol.connect(mavlinkByteTransport);
    // Refresh the ManagedDrone's transport reference so its close handler
    // tracks the live byte transport (the original was closed during
    // arbitration). swapTransport is a no-op if the drone is gone — that
    // matches the "reboot drained the entry" case.
    useDroneManager.getState().swapTransport(droneId, mavlinkByteTransport);
  } catch (err) {
    store.markError(
      `Failed to reopen MAVLink: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }

  // 4. On the hot-switch path, ask the FC to release CAN forwarding now
  //    that MAVLink is back.
  if (family === "F7" || family === "H7" || family === "G4") {
    try {
      if (typeof protocol.enableCanForward === "function") {
        await protocol.enableCanForward(0);
      }
    } catch {
      // Best-effort — the FC will time out on its own.
    }
    // Also clear the SLCAN port param so a subsequent reboot doesn't
    // accidentally enter SLCAN mode again.
    try {
      await protocol.setParameter("CAN_SLCAN_CPORT", 0);
    } catch {
      // ignore
    }
  }

  // Suppress unused-var warning on `bus`; it stays in the signature for
  // future use (per-bus CAN_FORWARD disable).
  void bus;

  store.reset();
}
