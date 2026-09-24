/**
 * COMMAND_LONG + COMMAND_ACK tracking queue.
 * Sends MAVLink COMMAND_LONG messages and resolves promises when ACKs arrive.
 */

import type { CommandResult } from "./types";
import { encodeCommandInt, encodeCommandLong } from "./mavlink-encoder";

// MAVLink COMMAND_ACK result codes
export const MAV_RESULT = {
  ACCEPTED: 0,
  TEMPORARILY_REJECTED: 1,
  DENIED: 2,
  UNSUPPORTED: 3,
  FAILED: 4,
  IN_PROGRESS: 5,
  CANCELLED: 6,
  COMMAND_LONG_ONLY: 7,
  COMMAND_INT_ONLY: 8,
  COMMAND_UNSUPPORTED_MAV_FRAME: 9,
  NOT_IN_CONTROL: 10,
} as const;

const RESULT_MESSAGES: Record<number, string> = {
  [MAV_RESULT.ACCEPTED]: "Command accepted",
  [MAV_RESULT.TEMPORARILY_REJECTED]: "Command temporarily rejected",
  [MAV_RESULT.DENIED]: "Command denied",
  [MAV_RESULT.UNSUPPORTED]: "Command unsupported",
  [MAV_RESULT.FAILED]: "Command failed",
  [MAV_RESULT.IN_PROGRESS]: "Command in progress",
  [MAV_RESULT.CANCELLED]: "Command cancelled",
  [MAV_RESULT.COMMAND_LONG_ONLY]: "Command must be sent as COMMAND_LONG",
  [MAV_RESULT.COMMAND_INT_ONLY]: "Command must be sent as COMMAND_INT",
  [MAV_RESULT.COMMAND_UNSUPPORTED_MAV_FRAME]: "Command frame unsupported",
  [MAV_RESULT.NOT_IN_CONTROL]: "Another controller has control of the vehicle",
};

const MAV_FRAME_GLOBAL = 0;
const MAV_FRAME_GLOBAL_RELATIVE_ALT = 3;

/**
 * Commands whose COMMAND_LONG param5/param6 carry latitude/longitude in
 * degrees, with the frame the autopilot assumes for them. Converting such a
 * command to COMMAND_INT scales x/y by 1e7; every other command carries
 * param5/param6 into x/y unscaled. This mirrors the conversion ArduPilot
 * applies to an incoming COMMAND_LONG.
 */
const LONG_LOCATION_COMMAND_FRAME: Readonly<Record<number, number>> = {
  179: MAV_FRAME_GLOBAL, // DO_SET_HOME
  195: MAV_FRAME_GLOBAL_RELATIVE_ALT, // DO_SET_ROI_LOCATION
  201: MAV_FRAME_GLOBAL_RELATIVE_ALT, // DO_SET_ROI
  192: MAV_FRAME_GLOBAL_RELATIVE_ALT, // DO_REPOSITION
  611: MAV_FRAME_GLOBAL, // DO_SET_GLOBAL_ORIGIN
  43003: MAV_FRAME_GLOBAL, // EXTERNAL_POSITION_ESTIMATE
};

/** Re-encode a COMMAND_LONG's inputs as the equivalent COMMAND_INT frame. */
function encodeLongAsCommandInt(a: PendingCommand["encodeArgs"]): Uint8Array {
  const locationFrame: number | undefined = LONG_LOCATION_COMMAND_FRAME[a.command];
  const scale = locationFrame === undefined ? 1 : 1e7;
  const x = Number.isNaN(a.params[4]) ? 0 : Math.trunc(a.params[4] * scale);
  const y = Number.isNaN(a.params[5]) ? 0 : Math.trunc(a.params[5] * scale);
  return encodeCommandInt(
    a.targetSys, a.targetComp, locationFrame ?? MAV_FRAME_GLOBAL_RELATIVE_ALT, a.command, 0, 0,
    a.params[0], a.params[1], a.params[2], a.params[3],
    x, y, a.params[6], a.sysId, a.compId,
  );
}

/**
 * Commands whose repeat leaves the vehicle in the same state, so they are sent
 * again when no COMMAND_ACK arrives, as the MAVLink command protocol expects of
 * the sender (confirmation incremented on each COMMAND_LONG resend). A command
 * that acts again when repeated (camera trigger or capture, calibration, motor
 * or actuator test, relative yaw) or that the vehicle refuses when already done
 * (takeoff while airborne) is sent once.
 */
const RESEND_SAFE_COMMANDS: ReadonlySet<number> = new Set([
  400, // COMPONENT_ARM_DISARM
  176, // DO_SET_MODE
  20, // NAV_RETURN_TO_LAUNCH
  21, // NAV_LAND
  185, // DO_FLIGHTTERMINATION
  192, // DO_REPOSITION
  193, // DO_PAUSE_CONTINUE
  178, // DO_CHANGE_SPEED
  179, // DO_SET_HOME
  207, // DO_FENCE_ENABLE
  181, // DO_SET_RELAY
  183, // DO_SET_SERVO
  204, // DO_MOUNT_CONFIGURE
  205, // DO_MOUNT_CONTROL
  195, // DO_SET_ROI_LOCATION
  197, // DO_SET_ROI_NONE
  34, // DO_ORBIT
  511, // SET_MESSAGE_INTERVAL
  512, // REQUEST_MESSAGE
  32000, // CAN_FORWARD
  42007, // SET_EKF_SOURCE_SET
]);

/** Resends of a silent command within its timeout (so three transmissions in all). */
const MAX_SILENT_RESENDS = 2;

interface PendingCommand {
  command: number;
  resolve: (result: CommandResult) => void;
  timer: ReturnType<typeof setTimeout>;
  retryCount: number;
  /** COMMAND_LONG confirmation byte of the last transmission. */
  confirmation: number;
  /** Next resend of a silent command, while one is scheduled. */
  resendTimer?: ReturnType<typeof setTimeout>;
  frame: Uint8Array;
  sendFn: (data: Uint8Array) => void;
  timeoutMs: number;
  // The system id of the vehicle this command was addressed to. Incoming
  // COMMAND_ACKs from a different source sysid are ignored so a co-channel
  // vehicle's ack cannot resolve this drone's pending command.
  targetSys: number;
  // Who we sent as. An ack addressed to a different GCS on a shared link is
  // not ours to consume.
  sysId: number;
  compId: number;
  // COMMAND_INT has no confirmation byte, so its retry is a byte-identical
  // resend rather than a re-encode with an incremented confirmation.
  isCommandInt?: boolean;
  // Inputs retained so retries can re-encode the COMMAND_LONG with an
  // incremented confirmation byte rather than resending byte-identical frames.
  encodeArgs: {
    targetSys: number;
    targetComp: number;
    command: number;
    params: [number, number, number, number, number, number, number];
    sysId: number;
    compId: number;
  };
}

/**
 * Upper bound on concurrently-pending commands. Generous next to real usage
 * (a connect burst is three) and small enough that a caller looping without
 * awaiting fails loudly instead of growing the map without limit.
 */
const MAX_PENDING = 32;

export class CommandQueue {
  /**
   * Pending commands keyed by a monotonic ticket, NOT by MAV_CMD id.
   *
   * Keying by command id meant a second in-flight command with the same id
   * cancelled the first with "Superseded by new command". Three
   * REQUEST_MESSAGE (512) calls fire back to back on connect, so the first two
   * cancelled themselves before the vehicle could answer; the same collision
   * hit concurrent setServo, setRelay and setMessageInterval calls.
   *
   * COMMAND_ACK carries no correlation id, only the command number, so an ack
   * for one of several same-id commands is matched FIFO — the oldest matching
   * entry wins. That is the best available resolution and it is why insertion
   * order matters here (Map preserves it).
   */
  private pending: Map<number, PendingCommand> = new Map();
  private nextTicket = 1;
  private timeout: number;

  constructor(timeoutMs: number = 3000) {
    this.timeout = timeoutMs;
  }

  /**
   * Send a COMMAND_LONG and wait for the corresponding COMMAND_ACK.
   *
   * @param command — MAV_CMD command ID
   * @param params — 7 float parameters for COMMAND_LONG
   * @param sendFn — transport.send function to transmit the encoded frame
   * @param targetSys — target system ID
   * @param targetComp — target component ID
   * @param sysId — sender system ID
   * @param compId — sender component ID
   * @returns Promise that resolves when ACK is received or times out
   */
  sendCommand(
    command: number,
    params: [number, number, number, number, number, number, number],
    sendFn: (data: Uint8Array) => void,
    targetSys: number,
    targetComp: number,
    sysId: number,
    compId: number,
    timeoutMs?: number,
  ): Promise<CommandResult> {
    const effectiveTimeout = timeoutMs ?? this.timeout;

    if (this.pending.size >= MAX_PENDING) {
      return Promise.resolve({
        success: false,
        resultCode: -1,
        message: `Command queue full (${MAX_PENDING} in flight)`,
      });
    }

    const ticket = this.nextTicket++;

    // First transmission carries confirmation=0. Retries re-encode with an
    // incremented confirmation count, so keep the encode inputs around.
    const encodeArgs = { targetSys, targetComp, command, params, sysId, compId };
    const frame = encodeCommandLong(
      targetSys,
      targetComp,
      command,
      params[0], params[1], params[2], params[3],
      params[4], params[5], params[6],
      sysId,
      compId,
      0,
    );

    return new Promise<CommandResult>((resolve) => {
      // Set up timeout
      const timer = setTimeout(() => {
        this.pending.delete(ticket);
        resolve({
          success: false,
          resultCode: -1,
          message: `Command ${command} timed out after ${effectiveTimeout}ms`,
        });
      }, effectiveTimeout);

      // Track the pending command
      this.pending.set(ticket, {
        command, resolve, timer, retryCount: 0, confirmation: 0,
        frame, sendFn, timeoutMs: effectiveTimeout,
        targetSys, sysId, compId, encodeArgs,
      });

      // Send. A transport can throw synchronously (e.g. "Not connected"
      // if the link dropped between the caller's check and here). Fail
      // the command cleanly instead of leaking an unhandled rejection
      // and leaving the promise to hang until the timeout fires.
      try {
        sendFn(frame);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(ticket);
        resolve({
          success: false,
          resultCode: -1,
          message: `Send failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      this.armResend(ticket);
    });
  }

  /**
   * Send a COMMAND_INT and wait for its COMMAND_ACK.
   *
   * COMMAND_INT exists so lat/lon keep 1e7 integer precision instead of being
   * squeezed through a float32 param. The ack is the same COMMAND_ACK, so
   * tracking is identical to {@link sendCommand} — the only difference is the
   * frame the first transmission carries. There is no confirmation byte in
   * COMMAND_INT, so a retry resends the same frame.
   */
  sendCommandInt(
    command: number,
    params: [number, number, number, number],
    x: number,
    y: number,
    z: number,
    frame: number,
    sendFn: (data: Uint8Array) => void,
    targetSys: number,
    targetComp: number,
    sysId: number,
    compId: number,
    timeoutMs?: number,
  ): Promise<CommandResult> {
    const effectiveTimeout = timeoutMs ?? this.timeout;

    if (this.pending.size >= MAX_PENDING) {
      return Promise.resolve({
        success: false,
        resultCode: -1,
        message: `Command queue full (${MAX_PENDING} in flight)`,
      });
    }

    const ticket = this.nextTicket++;
    const encoded = encodeCommandInt(
      targetSys, targetComp, frame, command, 0, 0,
      params[0], params[1], params[2], params[3],
      x, y, z, sysId, compId,
    );

    return new Promise<CommandResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(ticket);
        resolve({
          success: false,
          resultCode: -1,
          message: `Command ${command} timed out after ${effectiveTimeout}ms`,
        });
      }, effectiveTimeout);

      this.pending.set(ticket, {
        command, resolve, timer, retryCount: 0, confirmation: 0,
        frame: encoded, sendFn, timeoutMs: effectiveTimeout,
        targetSys, sysId, compId, isCommandInt: true,
        // Retained only to satisfy the shared entry shape; the retry path
        // skips the COMMAND_LONG re-encode for a COMMAND_INT entry.
        encodeArgs: {
          targetSys, targetComp, command,
          params: [params[0], params[1], params[2], params[3], x, y, z],
          sysId, compId,
        },
      });

      try {
        sendFn(encoded);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(ticket);
        resolve({
          success: false,
          resultCode: -1,
          message: `Send failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      this.armResend(ticket);
    });
  }

  /**
   * Send a resend-safe command again each time a third of its timeout passes
   * without any COMMAND_ACK, at most {@link MAX_SILENT_RESENDS} times. Any ack
   * (IN_PROGRESS included) stops it: the vehicle has the command.
   */
  private armResend(ticket: number): void {
    const entry = this.pending.get(ticket);
    if (!entry || !RESEND_SAFE_COMMANDS.has(entry.command)) return;
    const interval = entry.timeoutMs / (MAX_SILENT_RESENDS + 1);
    let resends = 0;
    const tick = () => {
      entry.resendTimer = undefined;
      if (this.pending.get(ticket) !== entry || resends >= MAX_SILENT_RESENDS) return;
      resends++;
      if (!entry.isCommandInt) {
        entry.confirmation++;
        entry.frame = this.encodeLong(entry);
      }
      try {
        entry.sendFn(entry.frame);
      } catch (err) {
        clearTimeout(entry.timer);
        this.pending.delete(ticket);
        entry.resolve({
          success: false,
          resultCode: -1,
          message: `Send failed: ${err instanceof Error ? err.message : String(err)}`,
        });
        return;
      }
      entry.resendTimer = setTimeout(tick, interval);
    };
    entry.resendTimer = setTimeout(tick, interval);
  }

  /** Re-encode a pending COMMAND_LONG with its current confirmation byte. */
  private encodeLong(entry: PendingCommand): Uint8Array {
    const a = entry.encodeArgs;
    return encodeCommandLong(
      a.targetSys, a.targetComp, a.command,
      a.params[0], a.params[1], a.params[2], a.params[3],
      a.params[4], a.params[5], a.params[6],
      a.sysId, a.compId,
      entry.confirmation,
    );
  }

  /**
   * Handle an incoming COMMAND_ACK message.
   * Call this when the MAVLink parser decodes a COMMAND_ACK (msg ID 77).
   *
   * @param command — the command ID being acknowledged
   * @param result — MAV_RESULT code
   * @param sourceSys — the source system id of the ACK frame. When provided,
   *   an ACK whose source does not match the command's target sysid is ignored
   *   so a wrong-vehicle or stale ack cannot resolve this pending command.
   * @param targetSys — the ack's `target_system`, i.e. the GCS it is addressed
   *   to. 0 means "any". An ack addressed to a different GCS on a shared link
   *   must not resolve our command.
   * @param targetComp — the ack's `target_component`, same rule.
   */
  handleAck(
    command: number,
    result: number,
    sourceSys?: number,
    targetSys?: number,
    targetComp?: number,
  ): void {
    // FIFO over insertion order: the oldest pending entry for this command id
    // that the ack could belong to. COMMAND_ACK carries no correlation id, so
    // this is the finest resolution the protocol allows.
    let ticket: number | undefined;
    let entry: PendingCommand | undefined;
    for (const [t, e] of this.pending) {
      if (e.command !== command) continue;
      // Not from the vehicle we addressed. A broadcast source (0) is accepted.
      if (sourceSys !== undefined && sourceSys !== 0 && sourceSys !== e.targetSys) continue;
      // Not addressed to us. 0 means "any", and an old sender that leaves the
      // extension fields off decodes as 0 too, so this stays permissive.
      if (targetSys !== undefined && targetSys !== 0 && targetSys !== e.sysId) continue;
      if (targetComp !== undefined && targetComp !== 0 && targetComp !== e.compId) continue;
      ticket = t;
      entry = e;
      break;
    }
    if (ticket === undefined || entry === undefined) return;
    // The vehicle answered, so it has the command: no more silent resends.
    clearTimeout(entry.resendTimer);
    entry.resendTimer = undefined;
    // IN_PROGRESS: reset timeout, keep waiting for final ACK
    if (result === MAV_RESULT.IN_PROGRESS) {
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        this.pending.delete(ticket);
        entry.resolve({
          success: false,
          resultCode: -1,
          message: `Command ${command} timed out after IN_PROGRESS`,
        });
      }, entry.timeoutMs);
      return;
    }

    // TEMPORARILY_REJECTED: auto-retry up to 3 times with 1s delay
    if (result === MAV_RESULT.TEMPORARILY_REJECTED && entry.retryCount < 3) {
      clearTimeout(entry.timer);
      entry.retryCount++;
      // Re-encode the COMMAND_LONG with the confirmation byte incremented.
      // ArduPilot/PX4 distinguish a fresh command from a repeat by this byte;
      // resending confirmation=0 looks like a duplicate first attempt rather
      // than a confirmation.
      if (!entry.isCommandInt) {
        entry.confirmation++;
        entry.frame = this.encodeLong(entry);
      }
      setTimeout(() => {
        // Entry may have been cleared during the delay
        if (!this.pending.has(ticket)) return;
        // Reset timeout
        entry.timer = setTimeout(() => {
          this.pending.delete(ticket);
          entry.resolve({
            success: false,
            resultCode: MAV_RESULT.TEMPORARILY_REJECTED,
            message: `Command ${command} temporarily rejected after ${entry.retryCount} retries`,
          });
        }, entry.timeoutMs);
        // Resend. The transport may have dropped during the retry delay
        // and can throw synchronously; fail the command cleanly instead
        // of throwing uncaught inside the timer and leaving the promise
        // pending forever.
        try {
          entry.sendFn(entry.frame);
        } catch (err) {
          clearTimeout(entry.timer);
          this.pending.delete(ticket);
          entry.resolve({
            success: false,
            resultCode: -1,
            message: `Send failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }, 1000);
      return;
    }

    // COMMAND_INT_ONLY: a flash-constrained ArduPilot build without
    // COMMAND_LONG handling acks every COMMAND_LONG this way. Re-send the same
    // command once as COMMAND_INT; its ack resolves this entry.
    if (result === MAV_RESULT.COMMAND_INT_ONLY && !entry.isCommandInt) {
      clearTimeout(entry.timer);
      entry.isCommandInt = true;
      entry.frame = encodeLongAsCommandInt(entry.encodeArgs);
      entry.timer = setTimeout(() => {
        this.pending.delete(ticket);
        entry.resolve({
          success: false,
          resultCode: -1,
          message: `Command ${command} timed out after COMMAND_INT resend`,
        });
      }, entry.timeoutMs);
      try {
        entry.sendFn(entry.frame);
      } catch (err) {
        clearTimeout(entry.timer);
        this.pending.delete(ticket);
        entry.resolve({
          success: false,
          resultCode: -1,
          message: `Send failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    // Final result — resolve
    clearTimeout(entry.timer);
    this.pending.delete(ticket);

    entry.resolve({
      success: result === MAV_RESULT.ACCEPTED,
      resultCode: result,
      message: RESULT_MESSAGES[result] ?? `Unknown result code: ${result}`,
    });
  }

  /** Clear all pending commands (call on disconnect). */
  clear(): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      clearTimeout(entry.resendTimer);
      entry.resolve({
        success: false,
        resultCode: -1,
        message: "Connection closed",
      });
    }
    this.pending.clear();
  }

  /**
   * Send a COMMAND_LONG without waiting for ACK.
   * Used for commands where the FC may not respond (reset, reboot).
   */
  sendCommandNoAck(
    command: number,
    params: [number, number, number, number, number, number, number],
    sendFn: (data: Uint8Array) => void,
    targetSys: number,
    targetComp: number,
    sysId: number,
    compId: number,
  ): void {
    const frame = encodeCommandLong(
      targetSys, targetComp, command,
      params[0], params[1], params[2], params[3],
      params[4], params[5], params[6],
      sysId, compId,
    );
    sendFn(frame);
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  /** Snapshot of pending commands for diagnostics display */
  getSnapshot(): { command: number; retryCount: number; timestamp: number }[] {
    const result: { command: number; retryCount: number; timestamp: number }[] = [];
    for (const [, entry] of this.pending) {
      result.push({
        command: entry.command,
        retryCount: entry.retryCount,
        timestamp: Date.now(),
      });
    }
    return result;
  }
}
