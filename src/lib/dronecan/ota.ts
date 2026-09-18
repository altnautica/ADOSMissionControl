/**
 * @module ota
 * @description DroneCAN OTA orchestrator. Drives the canonical peripheral
 * firmware update sequence:
 *
 *   1. ARMING       — register file-read server, validate args.
 *   2. BEGIN_SENT   — issue `BeginFirmwareUpdate` and wait for the target to
 *                     enter the SOFTWARE_UPDATE mode.
 *   3. TRANSFERRING — serve `file.Read` chunks; progress is driven by offsets
 *                     the target asks for.
 *   4. REBOOTING    — bootloader stops asking; wait for the node to drop and
 *                     re-emit NodeStatus.
 *   5. VERIFYING    — wait for OPERATIONAL, call `GetNodeInfo`, compare SW.
 *   6. DONE.
 *
 * @license GPL-3.0-only
 */

import type { DroneCanClient, AnyTransferEvent } from "./client";
import { TimeoutError } from "./client-errors";
import {
  MODE_OPERATIONAL,
  MODE_SOFTWARE_UPDATE,
  type NodeStatus,
} from "./dsdl/node-status";
import { ERROR_OK } from "./dsdl/begin-firmware-update";
import { DATA_TYPE_IDS } from "./signatures";
import {
  BEGIN_TIMEOUT_MS,
  ENTER_SU_TIMEOUT_MS,
  REBOOT_TIMEOUT_MS,
  REMOTE_PATH,
  STALL_AFTER_BEGIN_MS,
  VERIFY_TIMEOUT_MS,
  computePercent,
  freshState,
  type InternalState,
  type OtaErrorCode,
  type OtaRpcTraceEntry,
  type OtaSnapshot,
  type OtaStartOptions,
  type OtaState,
  type OtaTransitionLogEntry,
} from "./ota-types";

export type {
  OtaErrorCode,
  OtaRpcTraceEntry,
  OtaSnapshot,
  OtaStartOptions,
  OtaState,
  OtaTransitionLogEntry,
};

/**
 * Walks the OTA flow as a state machine. One instance per attempt; create a
 * new one to retry.
 */
export class DroneCanOtaOrchestrator {
  private readonly client: DroneCanClient;
  private readonly transitionLog: OtaTransitionLogEntry[] = [];
  private readonly rpcTrace: OtaRpcTraceEntry[] = [];
  private readonly listeners: Array<(s: OtaSnapshot) => void> = [];

  private opts: OtaStartOptions | null = null;
  private state: InternalState = freshState();
  private fileServerHandle: { stop(): void } | null = null;
  private unsubNodeStatus: (() => void) | null = null;
  private unsubAnyTransfer: (() => void) | null = null;
  private resolveDone: (() => void) | null = null;
  private rejectDone: ((err: Error) => void) | null = null;
  private stallTimer: ReturnType<typeof setTimeout> | null = null;
  private rebootTimer: ReturnType<typeof setTimeout> | null = null;
  private verifyTimer: ReturnType<typeof setTimeout> | null = null;
  private enterSuTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(client: DroneCanClient) {
    this.client = client;
  }

  subscribe(listener: (snapshot: OtaSnapshot) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  getSnapshot(): OtaSnapshot {
    return this.buildSnapshot();
  }

  async start(opts: OtaStartOptions): Promise<void> {
    if (this.opts) throw new Error("OTA orchestrator already started");
    if (!opts.fileBytes || opts.fileBytes.length === 0) {
      throw new Error("fileBytes is empty");
    }
    if (opts.targetNodeId <= 0 || opts.targetNodeId > 127) {
      throw new Error(`invalid targetNodeId: ${opts.targetNodeId}`);
    }
    this.opts = opts;
    const sourceNodeId = opts.sourceNodeId ?? this.client.getSelfNodeId();

    return new Promise<void>((resolve, reject) => {
      this.resolveDone = resolve;
      this.rejectDone = reject;
      this.transition("IDLE", "ARMING");
      this.subscribeStreams();
      try {
        this.fileServerHandle = this.client.serveFileReads({
          fileData: opts.fileBytes,
          path: REMOTE_PATH,
          onChunkServed: (offset, len) => this.onChunkServed(offset, len),
        });
      } catch (err) {
        this.failWith(
          "INVALID_ARGS",
          err instanceof Error ? err.message : "failed to register file server",
        );
        return;
      }
      this.beginFirmwareUpdate(sourceNodeId, opts.targetNodeId).catch((err) => {
        if (!this.state.resolved) {
          this.failWith(
            err instanceof TimeoutError ? "TIMEOUT" : "TRANSPORT_LOST",
            err instanceof Error ? err.message : "begin failed",
          );
        }
      });
    });
  }

  abort(): void {
    if (this.state.resolved) return;
    this.failWith("USER_ABORTED", "OTA aborted");
  }

  // ── State machine steps ─────────────────────────────────

  private async beginFirmwareUpdate(
    sourceNodeId: number,
    targetNodeId: number,
  ): Promise<void> {
    this.transition("ARMING", "BEGIN_SENT");
    const startedAt = Date.now();
    let response;
    try {
      response = await this.client.beginFirmwareUpdate(
        targetNodeId,
        sourceNodeId,
        REMOTE_PATH,
        { timeoutMs: BEGIN_TIMEOUT_MS, retries: 1 },
      );
    } catch (err) {
      this.recordRpcTrace({
        ts: Date.now(),
        kind: "response",
        type: "file.BeginFirmwareUpdate",
        dir: "in",
        latencyMs: Date.now() - startedAt,
        ok: false,
      });
      if (err instanceof TimeoutError) {
        this.state.timeouts += 1;
        this.failWith("TIMEOUT", "BeginFirmwareUpdate timed out");
        return;
      }
      throw err;
    }
    this.recordRpcTrace({
      ts: Date.now(),
      kind: "response",
      type: "file.BeginFirmwareUpdate",
      dir: "in",
      latencyMs: Date.now() - startedAt,
      ok: response.error === ERROR_OK,
    });
    this.state.beginError = response.error;
    if (response.error !== ERROR_OK) {
      this.failWith(
        "BEGIN_REJECTED",
        `BeginFirmwareUpdate returned error=${response.error}${
          response.optional_error_message
            ? `: ${response.optional_error_message}`
            : ""
        }`,
      );
      return;
    }
    this.startEnterSoftwareUpdateTimer();
    this.emit();
  }

  private onChunkServed(offset: number, len: number): void {
    if (this.state.resolved) return;
    if (this.state.state === "BEGIN_SENT") {
      this.clearTimer("enterSuTimer");
      this.transition("BEGIN_SENT", "TRANSFERRING");
    }
    this.state.lastOffset = offset;
    this.state.lastChunkLen = len;
    if (offset >= this.state.highestOffset) {
      const newHighest = offset + len;
      this.state.bytesSent += Math.max(
        0,
        newHighest - this.state.highestOffset,
      );
      this.state.highestOffset = newHighest;
    } else {
      this.state.retries += 1;
    }
    this.restartStallTimer();

    // Completion is "the last byte of the image has been served", NOT "the
    // node asked for an offset past EOF". A node only makes that extra
    // zero-length request when the file length is an exact multiple of 256,
    // because `isFileReadEof` treats any shorter chunk as the end — and an
    // AP_Periph binary essentially never is. So after the final short chunk
    // the node went quiet to write and reboot, and the 5 s stall timer fired
    // `failWith("TIMEOUT")` and tore down the file server: a SUCCESSFUL flash
    // was reported as a timeout.
    const totalBytes = this.opts?.fileBytes.length ?? 0;
    if (len === 0 || (totalBytes > 0 && offset + len >= totalBytes)) {
      this.transferComplete();
      return;
    }
    this.emit();
  }

  private transferComplete(): void {
    if (this.state.state !== "TRANSFERRING") return;
    this.clearTimer("stallTimer");
    this.transition("TRANSFERRING", "REBOOTING");
    this.rebootTimer = setTimeout(() => {
      if (this.state.state === "REBOOTING") {
        this.failWith("NODE_GONE", "node did not return after reboot");
      }
    }, REBOOT_TIMEOUT_MS);
    this.emit();
  }

  private onNodeStatus(srcNodeId: number, status: NodeStatus): void {
    if (this.state.resolved) return;
    if (!this.opts || srcNodeId !== this.opts.targetNodeId) return;
    this.state.lastNodeStatus = {
      mode: status.mode,
      health: status.health,
      uptime_sec: status.uptime_sec,
    };
    switch (this.state.state) {
      case "BEGIN_SENT":
        if (status.mode === MODE_SOFTWARE_UPDATE) {
          this.clearTimer("enterSuTimer");
          this.transition(
            "BEGIN_SENT",
            "TRANSFERRING",
            "node entered SOFTWARE_UPDATE",
          );
          this.restartStallTimer();
        }
        break;
      case "TRANSFERRING":
        if (status.mode !== MODE_SOFTWARE_UPDATE) this.transferComplete();
        break;
      case "REBOOTING":
        if (status.mode === MODE_OPERATIONAL) {
          this.clearTimer("rebootTimer");
          this.transition("REBOOTING", "VERIFYING");
          this.runVerify();
        }
        break;
      default:
        break;
    }
    this.emit();
  }

  private async runVerify(): Promise<void> {
    if (!this.opts) return;
    const verifyStart = Date.now();
    this.verifyTimer = setTimeout(() => {
      if (this.state.state === "VERIFYING") {
        this.failWith("TIMEOUT", "verification GetNodeInfo timed out");
      }
    }, VERIFY_TIMEOUT_MS);

    let info;
    try {
      info = await this.client.getNodeInfo(this.opts.targetNodeId, {
        timeoutMs: VERIFY_TIMEOUT_MS,
        retries: 1,
      });
    } catch (err) {
      this.clearTimer("verifyTimer");
      this.recordRpcTrace({
        ts: Date.now(),
        kind: "response",
        type: "GetNodeInfo",
        dir: "in",
        latencyMs: Date.now() - verifyStart,
        ok: false,
      });
      if (this.state.resolved) return;
      this.failWith(
        err instanceof TimeoutError ? "TIMEOUT" : "TRANSPORT_LOST",
        err instanceof Error ? err.message : "GetNodeInfo failed",
      );
      return;
    }
    this.clearTimer("verifyTimer");
    this.recordRpcTrace({
      ts: Date.now(),
      kind: "response",
      type: "GetNodeInfo",
      dir: "in",
      latencyMs: Date.now() - verifyStart,
      ok: true,
    });

    // A version mismatch is a FAILED verify, not a note attached to DONE.
    // `VERIFYING → DONE` was unconditional with no failure branch, so
    // `VERSION_MISMATCH` was unreachable and the state verified nothing —
    // and `flashApPeriph` never passes `expectedSwVersion`, so the whole
    // stage was a round trip with no assertion at all.
    const expected = this.opts.expectedSwVersion;
    if (expected) {
      const got = info.software_version;
      if (got.major !== expected.major || got.minor !== expected.minor) {
        this.failWith(
          "VERSION_MISMATCH",
          `verify failed: expected software version ${expected.major}.${expected.minor}, node reports ${got.major}.${got.minor}`,
        );
        return;
      }
    }
    this.transition("VERIFYING", "DONE");
    this.state.resolved = true;
    this.cleanup();
    this.emit();
    this.resolveDone?.();
  }

  // ── Helpers ──────────────────────────────────────────────

  private subscribeStreams(): void {
    this.unsubNodeStatus = this.client.onNodeStatus((src, status) =>
      this.onNodeStatus(src, status),
    );
    this.unsubAnyTransfer = this.client.onAnyTransfer((evt) =>
      this.onAnyTransfer(evt),
    );
  }

  private onAnyTransfer(evt: AnyTransferEvent): void {
    if (this.state.resolved) return;
    if (evt.dataTypeId === DATA_TYPE_IDS.fileRead && evt.kind === "request") {
      this.recordRpcTrace({
        ts: evt.ts,
        kind: "request",
        type: "file.Read",
        dir: "in",
        ok: true,
      });
    }
  }

  private startEnterSoftwareUpdateTimer(): void {
    this.clearTimer("enterSuTimer");
    this.enterSuTimer = setTimeout(() => {
      if (this.state.state === "BEGIN_SENT") {
        this.failWith(
          "TIMEOUT",
          "node did not enter SOFTWARE_UPDATE after BeginFirmwareUpdate",
        );
      }
    }, ENTER_SU_TIMEOUT_MS);
  }

  private restartStallTimer(): void {
    this.clearTimer("stallTimer");
    this.stallTimer = setTimeout(() => {
      if (this.state.state === "TRANSFERRING") {
        this.failWith("TIMEOUT", "no file.Read request for stall window");
      }
    }, STALL_AFTER_BEGIN_MS);
  }

  private clearTimer(
    name: "stallTimer" | "rebootTimer" | "verifyTimer" | "enterSuTimer",
  ): void {
    const t = this[name];
    if (t) {
      clearTimeout(t);
      this[name] = null;
    }
  }

  private transition(from: OtaState, to: OtaState, note?: string): void {
    if (this.state.state !== from) return;
    this.state.state = to;
    this.transitionLog.push({ ts: Date.now(), from, to, note });
  }

  private failWith(code: OtaErrorCode, message: string): void {
    if (this.state.resolved) return;
    const from = this.state.state;
    const to: OtaState = code === "USER_ABORTED" ? "ABORTED" : "FAILED";
    this.state.state = to;
    this.state.errorCode = code;
    this.state.errorMessage = message;
    this.state.resolved = true;
    this.transitionLog.push({
      ts: Date.now(),
      from,
      to,
      note: `${code}: ${message}`,
    });
    this.cleanup();
    this.emit();
    this.rejectDone?.(Object.assign(new Error(message), { code }));
  }

  private cleanup(): void {
    this.clearTimer("stallTimer");
    this.clearTimer("rebootTimer");
    this.clearTimer("verifyTimer");
    this.clearTimer("enterSuTimer");
    this.fileServerHandle?.stop();
    this.fileServerHandle = null;
    this.unsubNodeStatus?.();
    this.unsubNodeStatus = null;
    this.unsubAnyTransfer?.();
    this.unsubAnyTransfer = null;
  }

  private recordRpcTrace(entry: OtaRpcTraceEntry): void {
    this.rpcTrace.push(entry);
    if (this.rpcTrace.length > 200) {
      this.rpcTrace.splice(0, this.rpcTrace.length - 200);
    }
  }

  private emit(): void {
    const snap = this.buildSnapshot();
    for (const l of this.listeners) {
      try {
        l(snap);
      } catch {
        // listener errors are isolated
      }
    }
  }

  private buildSnapshot(): OtaSnapshot {
    const total = this.opts?.fileBytes.length ?? 0;
    return {
      state: this.state.state,
      percent: computePercent(this.state, total),
      bytesSent: this.state.bytesSent,
      bytesTotal: total,
      lastOffset: this.state.lastOffset,
      lastChunkLen: this.state.lastChunkLen,
      retries: this.state.retries,
      timeouts: this.state.timeouts,
      beginError: this.state.beginError,
      lastNodeStatus: this.state.lastNodeStatus
        ? { ...this.state.lastNodeStatus }
        : undefined,
      transitionLog: [...this.transitionLog],
      rpcTrace: [...this.rpcTrace],
      errorCode: this.state.errorCode,
      errorMessage: this.state.errorMessage,
    };
  }
}
