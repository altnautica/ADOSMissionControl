/**
 * AP_Periph flash dispatcher.
 *
 * Wires the CAN flash button into a real OTA attempt:
 *   - opens a CAN transport to the peripheral: MAVLink CAN_FORWARD, which
 *     keeps the telemetry link up, or a direct SLCAN session on the USB port
 *   - starts a DroneCAN session on it (lib/dronecan/session), which feeds
 *     node status and bus traffic into the DroneCAN stores
 *   - runs the OTA orchestrator, streaming its snapshots into the flash store
 *
 * @license GPL-3.0-only
 */

import type { DroneProtocol } from "@/lib/protocol/types/protocol";
import {
  MavlinkCanForwardTransport,
  type CanTransport,
} from "@/lib/protocol/transport/can-transport";
import { enterSlcanMode, SLCAN_TIMEOUT_MAX_S } from "@/lib/protocol/transport/slcan-flash-arbiter";
import { DroneCanOtaOrchestrator } from "@/lib/dronecan/ota";
import { startDroneCanSession } from "@/lib/dronecan/session";
import { ApPeriphManifest } from "@/lib/protocol/firmware/ap-periph-manifest";
import { useDroneCanFlashStore } from "@/stores/dronecan/flash-store";

export interface FlashApPeriphParams {
  protocol: DroneProtocol;
  targetNodeId: number;
  board: string;
  channel: string;
  manifest: ApPeriphManifest;
  bus?: 1 | 2;
  /**
   * Transport for the CAN bus during the OTA flow.
   *   - `"can-forward"` (default): MAVLink CAN_FORWARD relay, agent-friendly.
   *   - `"slcan"`: direct SLCAN session on the FC's USB port. Requires a
   *     direct WebSerial connection; arbited via `enterSlcanMode()`.
   */
  transport?: "slcan" | "can-forward";
  /** SLCAN bitrate in bits/s (only used when `transport === "slcan"`). */
  slcanBitrate?: number;
  /** SLCAN auto-revert timeout in seconds, 1..127 (only used when `transport === "slcan"`). */
  slcanTimeoutSec?: number;
}

/** Node-name prefix AP_Periph builds use: `org.ardupilot.<hwdef board name>`. */
const AP_PERIPH_NODE_NAME_PREFIX = "org.ardupilot.";

/** `major.minor` from a published firmware-version string such as `1.7.0-dev`. */
export function parseApPeriphVersion(text: string | null): { major: number; minor: number } | null {
  const m = text?.match(/(\d+)\.(\d+)/);
  return m ? { major: Number(m[1]), minor: Number(m[2]) } : null;
}

/**
 * Why the node must not take this board's image, or null when it may. A node
 * that names itself `org.ardupilot.<board>` must name the selected board; a
 * node with another naming scheme cannot be compared by name.
 */
export function apPeriphBoardMismatch(nodeName: string, board: string): string | null {
  if (!nodeName.toLowerCase().startsWith(AP_PERIPH_NODE_NAME_PREFIX)) return null;
  const nodeBoard = nodeName.slice(AP_PERIPH_NODE_NAME_PREFIX.length);
  if (nodeBoard.toLowerCase() === board.toLowerCase()) return null;
  return `Node reports board ${nodeBoard}, but the selected firmware is for ${board}. Pick the firmware for this node's board.`;
}

/**
 * Drive one AP_Periph OTA attempt end-to-end. Returns a disposer that
 * tears down the transport + client + subscriptions when the caller is
 * done. Errors surface as rejected promises so the UI can show a toast.
 */
export async function flashApPeriph(
  params: FlashApPeriphParams,
): Promise<{ dispose: () => Promise<void> }> {
  const {
    protocol,
    targetNodeId,
    board,
    channel,
    manifest,
    bus = 1,
    transport: transportKind = "can-forward",
    slcanBitrate = 1_000_000,
    slcanTimeoutSec = SLCAN_TIMEOUT_MAX_S,
  } = params;

  // 1. Fetch the firmware payload and its published version. Do this BEFORE
  //    we touch the CAN bus so a 404 doesn't leave the FC in CAN_FORWARD
  //    mode. The version is what the post-flash verify asserts; without it
  //    a bootloader that refused the image and booted the old app would be
  //    reported as a verified success.
  const fileBytes = await manifest.downloadFirmware(channel, board);
  const expectedSwVersion = parseApPeriphVersion((await manifest.getBoardManifest(channel, board)).version);
  if (!expectedSwVersion) {
    throw new Error(`The ${board} firmware listing publishes no version, so the update could not be verified. Not flashing.`);
  }

  // 2. Open the chosen CAN transport. The MAVLink CAN_FORWARD path leaves
  //    the MAVLink link up; the SLCAN path replaces it with a direct
  //    SLCAN session on the same USB port (the arbiter handles the
  //    CAN_SLCAN_* parameters and any reboot).
  let transport: CanTransport;
  let slcanExit: (() => Promise<void>) | null = null;
  if (transportKind === "slcan") {
    const droneId =
      protocol.getVehicleInfo()?.systemId?.toString() ?? "unknown";
    const session = await enterSlcanMode({
      protocol,
      droneId,
      bus: bus === 2 ? 2 : 1,
      bitrate: slcanBitrate,
      timeoutSec: slcanTimeoutSec,
    });
    transport = session.slcanTransport;
    slcanExit = session.exitFn;
  } else {
    const fwdTransport = new MavlinkCanForwardTransport(protocol, { bus });
    await fwdTransport.open({ bitrate: 1_000_000 });
    transport = fwdTransport;
  }

  // 3. Build a DroneCanClient on top of the transport, fanning its node
  //    status and transfers into the CAN stores.
  const session = await startDroneCanSession(transport);
  const client = session.client;
  const unsubs: Array<() => void> = [];

  // 5. Run the OTA orchestrator. Snapshots stream into the flash store
  //    until the run completes or errors out.
  const orchestrator = new DroneCanOtaOrchestrator(client);
  const unsubSnapshots = orchestrator.subscribe((snapshot) => {
    useDroneCanFlashStore.getState().setSnapshot(snapshot);
  });
  unsubs.push(unsubSnapshots);

  const dispose = async () => {
    for (const off of unsubs) off();
    try {
      await session.close();
    } catch {
      // Best effort.
    }
    if (slcanExit) {
      try {
        await slcanExit();
      } catch {
        // Best effort — the FC's CAN_SLCAN_TIMOUT will auto-revert.
      }
    }
  };

  // A completed run keeps the session open: the post-flash state is read from
  // it and the caller disposes when it leaves the page or starts a new
  // attempt. A failed run hands nothing back, so it tears down here and the
  // FC returns to MAVLink instead of waiting out its SLCAN/forward timeout.
  try {
    // 4. Confirm the target is the board this image is for before
    //    BeginFirmwareUpdate; a wrong-board image only fails later as a
    //    node that never comes back.
    const info = await client.getNodeInfo(targetNodeId, { timeoutMs: 1000, retries: 2 });
    const mismatch = apPeriphBoardMismatch(info.name, board);
    if (mismatch) throw new Error(mismatch);
    await orchestrator.start({ targetNodeId, fileBytes, expectedSwVersion });
  } catch (err) {
    await dispose();
    throw err;
  }

  return { dispose };
}

