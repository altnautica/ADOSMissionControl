/**
 * COMMAND_LONG + COMMAND_ACK tracking queue.
 * Sends MAVLink COMMAND_LONG messages and resolves promises when ACKs arrive.
 */

import type { CommandResult } from "./types";
import { mavResultText } from "@/lib/cockpit/spec-strings";
import { encodeCommandInt, encodeCommandLong } from "./encoders";
import {
  armResend, resendAsCommandInt, retryTemporarilyRejected, transmit,
  type PendingCommand,
} from "./command-queue-retry";

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

const RESULT_NAMES: Readonly<Record<number, string>> = Object.fromEntries(
  Object.entries(MAV_RESULT).map(([name, code]) => [code, name]),
);

/** Text for the results the cockpit spec names no `mav_result.*` text for. */
const RESULT_MESSAGES: Record<number, string> = {
  [MAV_RESULT.COMMAND_LONG_ONLY]: "Command must be sent as COMMAND_LONG",
  [MAV_RESULT.COMMAND_INT_ONLY]: "Command must be sent as COMMAND_INT",
  [MAV_RESULT.COMMAND_UNSUPPORTED_MAV_FRAME]: "Command frame unsupported",
  [MAV_RESULT.NOT_IN_CONTROL]: "Another controller has control of the vehicle",
};

/** The operator text for a final COMMAND_ACK result: the spec's
 * `mav_result.<NAME>` text where it has one, so every surface words a
 * result alike, else the queue's own. */
export function commandResultMessage(result: number): string {
  const name = RESULT_NAMES[result];
  return (name ? mavResultText(name) : null) ?? RESULT_MESSAGES[result] ?? `Unknown result code: ${result}`;
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
      const timer = setTimeout(() => {
        this.pending.delete(ticket);
        resolve({
          success: false,
          resultCode: -1,
          message: `Command ${command} timed out after ${effectiveTimeout}ms`,
        });
      }, effectiveTimeout);

      const entry: PendingCommand = {
        command, resolve, timer, retryCount: 0, confirmation: 0, sentAt: Date.now(),
        frame, sendFn, timeoutMs: effectiveTimeout,
        targetSys, sysId, compId, encodeArgs,
      };
      this.pending.set(ticket, entry);
      // A transport can throw synchronously (it dropped between the caller's
      // check and here, or it cannot carry a command). The command fails at
      // once with the transport's reason instead of waiting out the timeout.
      if (transmit(this.pending, ticket, entry)) armResend(this.pending, ticket);
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

      const entry: PendingCommand = {
        command, resolve, timer, retryCount: 0, confirmation: 0, sentAt: Date.now(),
        frame: encoded, sendFn, timeoutMs: effectiveTimeout,
        targetSys, sysId, compId, isCommandInt: true,
        // Retained only to satisfy the shared entry shape; the retry path
        // skips the COMMAND_LONG re-encode for a COMMAND_INT entry.
        encodeArgs: {
          targetSys, targetComp, command,
          params: [params[0], params[1], params[2], params[3], x, y, z],
          sysId, compId,
        },
      };
      this.pending.set(ticket, entry);
      if (transmit(this.pending, ticket, entry)) armResend(this.pending, ticket);
    });
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

    if (result === MAV_RESULT.TEMPORARILY_REJECTED && retryTemporarilyRejected(this.pending, ticket, entry)) return;

    if (result === MAV_RESULT.COMMAND_INT_ONLY && !entry.isCommandInt) {
      resendAsCommandInt(this.pending, ticket, entry);
      return;
    }

    // Final result — resolve
    clearTimeout(entry.timer);
    this.pending.delete(ticket);

    entry.resolve({
      success: result === MAV_RESULT.ACCEPTED,
      resultCode: result,
      message: commandResultMessage(result),
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

  /** Snapshot of pending commands for diagnostics display, oldest first. */
  getSnapshot(): { ticket: number; command: number; retryCount: number; sentAt: number }[] {
    const result: { ticket: number; command: number; retryCount: number; sentAt: number }[] = [];
    for (const [ticket, entry] of this.pending) {
      result.push({ ticket, command: entry.command, retryCount: entry.retryCount, sentAt: entry.sentAt });
    }
    return result;
  }
}
