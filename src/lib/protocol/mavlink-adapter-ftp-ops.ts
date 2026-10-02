/**
 * MAVLink adapter: FILE_TRANSFER_PROTOCOL write/list/remove ops.
 *
 * The read half (burst download) lives in `mavlink-adapter-ftp.ts`; this module
 * adds the deliberate, operator-initiated write operations — upload a file,
 * list a directory, and remove a file — as a separate, simpler op-session so
 * the delicate burst-read state machine is never entangled. Each op is a plain
 * request/response sequence (no burst streaming):
 *
 *   - upload:  CreateFile(path) -> session -> WriteFile(chunk)* -> Terminate
 *   - list:    ListDirectory(path, offset)* until a NAK EndOfFile
 *   - remove:  RemoveFile(path)
 *
 * Like the read client, this runs ENTIRELY in the GCS over the adapter's
 * transport, so it works the same whether the FC is reached DIRECTLY
 * (WebSerial/TCP/UDP) or through the companion agent's transparent MAVLink
 * pipe (ws:8765) — the agent forwards the FTP frames unmodified.
 *
 * @module protocol/mavlink-adapter-ftp-ops
 */

import { encodeFileTransferProtocol, FTP_MAX_DATA } from "./mavlink-encoder";
import {
  decodeFileTransferProtocol,
  FtpOpcode,
  FtpError,
  ftpErrorName,
} from "./mavlink-messages";
import type { MAVLinkFrame } from "./mavlink-parser";
import type { FtpContext } from "./mavlink-adapter-ftp";
import type { FtpDirEntry } from "./types/protocol";

export type { FtpDirEntry, FtpContext };

const INACTIVITY_MS = 3000;
const HARD_TIMEOUT_MS = 60 * 1000;
const MAX_RETRIES = 5;

export type FtpUploadProgress = (written: number, total: number) => void;

type FtpOpKind = "upload" | "list" | "remove";
type FtpOpPhase =
  | "creating"
  | "writing"
  | "terminating"
  | "listing"
  | "removing";

export interface FtpOpState {
  kind: FtpOpKind;
  path: string;
  phase: FtpOpPhase;
  session: number;
  seq: number;
  // upload
  payload: Uint8Array;
  writeOffset: number;
  onProgress?: FtpUploadProgress;
  // list
  entries: FtpDirEntry[];
  listOffset: number;
  // resolution (typed at the public boundary)
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  lastRequest: Uint8Array | null;
  inactivityTimer: ReturnType<typeof setTimeout> | null;
  hardTimer: ReturnType<typeof setTimeout>;
  retryCount: number;
}

function clearTimers(st: FtpOpState): void {
  if (st.inactivityTimer) {
    clearTimeout(st.inactivityTimer);
    st.inactivityTimer = null;
  }
  clearTimeout(st.hardTimer);
}

function armInactivity(ctx: FtpContext): void {
  const st = ctx.ftpOp;
  if (!st) return;
  if (st.inactivityTimer) clearTimeout(st.inactivityTimer);
  st.inactivityTimer = setTimeout(() => onInactivity(ctx), INACTIVITY_MS);
}

/** Send a request frame, record it for resend, and stamp the seq. */
function sendRequest(ctx: FtpContext, frame: Uint8Array): void {
  const st = ctx.ftpOp;
  if (!st) return;
  st.lastRequest = frame;
  st.seq = (st.seq + 1) & 0xffff;
  ctx.transport?.send(frame);
  armInactivity(ctx);
}

function onInactivity(ctx: FtpContext): void {
  const st = ctx.ftpOp;
  if (!st || !ctx.transport?.isConnected) return;
  st.retryCount++;
  if (st.retryCount > MAX_RETRIES) {
    failOp(ctx, new Error(`FTP ${st.kind} timed out on ${st.path}`));
    return;
  }
  if (st.lastRequest) {
    ctx.transport.send(st.lastRequest);
    armInactivity(ctx);
  }
}

function finishOp(ctx: FtpContext, result: unknown): void {
  const st = ctx.ftpOp;
  if (!st) return;
  clearTimers(st);
  // Best-effort terminate for a session that was opened (upload).
  if (st.session !== 0 && ctx.transport?.isConnected) {
    ctx.transport.send(buildTerminate(ctx));
  }
  ctx.ftpOp = null;
  st.resolve(result);
}

function failOp(ctx: FtpContext, err: Error): void {
  const st = ctx.ftpOp;
  if (!st) return;
  clearTimers(st);
  if (st.session !== 0 && ctx.transport?.isConnected) {
    ctx.transport.send(buildTerminate(ctx));
  }
  ctx.ftpOp = null;
  st.reject(err);
}

// ── request builders ──────────────────────────────────────────

function pathFrame(
  ctx: FtpContext,
  opcode: number,
  session: number,
  offset: number,
  path: string,
): Uint8Array {
  const bytes = new TextEncoder().encode(path);
  return encodeFileTransferProtocol(
    ctx.targetSysId,
    ctx.targetCompId,
    session,
    opcode,
    ctx.ftpOp!.seq,
    offset,
    Math.min(bytes.length, FTP_MAX_DATA),
    bytes,
    ctx.sysId,
    ctx.compId,
  );
}

function buildWrite(ctx: FtpContext): Uint8Array {
  const st = ctx.ftpOp!;
  const chunk = st.payload.subarray(
    st.writeOffset,
    Math.min(st.writeOffset + FTP_MAX_DATA, st.payload.length),
  );
  return encodeFileTransferProtocol(
    ctx.targetSysId,
    ctx.targetCompId,
    st.session,
    FtpOpcode.WriteFile,
    st.seq,
    st.writeOffset,
    chunk.length,
    chunk,
    ctx.sysId,
    ctx.compId,
  );
}

function buildTerminate(ctx: FtpContext): Uint8Array {
  const st = ctx.ftpOp!;
  return encodeFileTransferProtocol(
    ctx.targetSysId,
    ctx.targetCompId,
    st.session,
    FtpOpcode.TerminateSession,
    st.seq,
    0,
    0,
    new Uint8Array(0),
    ctx.sysId,
    ctx.compId,
  );
}

/** Parse ListDirectory response bytes: null-terminated entries, each starting
 *  with a type char (F=file, D=dir, S=skip), files carry `\t<size>` after the
 *  name. Returns the kept entries and the server-side entry count of the reply
 *  (skip entries, `.` and `..` included), which is what the next offset adds. */
function parseDirEntries(data: Uint8Array, count: number): { entries: FtpDirEntry[]; served: number } {
  const out: FtpDirEntry[] = [];
  let served = 0;
  let start = 0;
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (data[i] === 0) {
      if (i > start) {
        served++;
        const raw = decoder.decode(data.subarray(start, i));
        const type = raw[0];
        if (type === "F" || type === "D") {
          const rest = raw.slice(1);
          if (type === "F") {
            const tab = rest.indexOf("\t");
            const name = tab >= 0 ? rest.slice(0, tab) : rest;
            const size = tab >= 0 ? parseInt(rest.slice(tab + 1), 10) || 0 : 0;
            if (name && name !== "." && name !== "..") {
              out.push({ name, size, isDir: false });
            }
          } else {
            if (rest && rest !== "." && rest !== "..") {
              out.push({ name: rest, size: 0, isDir: true });
            }
          }
        }
        // type 'S' (skip) and anything else are not listed.
      }
      start = i + 1;
    }
  }
  return { entries: out, served };
}

// ── public ops ────────────────────────────────────────────────

function startOp(ctx: FtpContext, partial: Omit<FtpOpState, "hardTimer">): void {
  const hardTimer = setTimeout(() => {
    failOp(ctx, new Error(`FTP ${partial.kind} exceeded the hard timeout`));
  }, HARD_TIMEOUT_MS);
  ctx.ftpOp = { ...partial, hardTimer };
}

/** Upload `bytes` to `path` on the FC (create/overwrite). */
export async function uploadFileViaFtp(
  ctx: FtpContext,
  path: string,
  bytes: Uint8Array,
  onProgress?: FtpUploadProgress,
): Promise<void> {
  if (!ctx.transport?.isConnected) throw new Error("Not connected");
  if (ctx.ftpDownload || ctx.ftpOp)
    throw new Error("An FTP operation is already in progress");
  return new Promise<void>((resolve, reject) => {
    startOp(ctx, {
      kind: "upload",
      path,
      phase: "creating",
      session: 0,
      seq: 0,
      payload: bytes,
      writeOffset: 0,
      onProgress,
      entries: [],
      listOffset: 0,
      resolve: resolve as (v: unknown) => void,
      reject,
      lastRequest: null,
      inactivityTimer: null,
      retryCount: 0,
    });
    sendRequest(ctx, pathFrame(ctx, FtpOpcode.CreateFile, 0, 0, path));
  });
}

/** List the directory `path` on the FC. */
export async function listDirectoryViaFtp(
  ctx: FtpContext,
  path: string,
): Promise<FtpDirEntry[]> {
  if (!ctx.transport?.isConnected) throw new Error("Not connected");
  if (ctx.ftpDownload || ctx.ftpOp)
    throw new Error("An FTP operation is already in progress");
  return new Promise<FtpDirEntry[]>((resolve, reject) => {
    startOp(ctx, {
      kind: "list",
      path,
      phase: "listing",
      session: 0,
      seq: 0,
      payload: new Uint8Array(0),
      writeOffset: 0,
      entries: [],
      listOffset: 0,
      resolve: resolve as (v: unknown) => void,
      reject,
      lastRequest: null,
      inactivityTimer: null,
      retryCount: 0,
    });
    sendRequest(ctx, pathFrame(ctx, FtpOpcode.ListDirectory, 0, 0, path));
  });
}

/** Remove the file `path` on the FC. */
export async function removeFileViaFtp(
  ctx: FtpContext,
  path: string,
): Promise<void> {
  if (!ctx.transport?.isConnected) throw new Error("Not connected");
  if (ctx.ftpDownload || ctx.ftpOp)
    throw new Error("An FTP operation is already in progress");
  return new Promise<void>((resolve, reject) => {
    startOp(ctx, {
      kind: "remove",
      path,
      phase: "removing",
      session: 0,
      seq: 0,
      payload: new Uint8Array(0),
      writeOffset: 0,
      entries: [],
      listOffset: 0,
      resolve: resolve as (v: unknown) => void,
      reject,
      lastRequest: null,
      inactivityTimer: null,
      retryCount: 0,
    });
    sendRequest(ctx, pathFrame(ctx, FtpOpcode.RemoveFile, 0, 0, path));
  });
}

/** Abort any in-progress write/list/remove op (e.g. on disconnect). */
export function cancelFtpOp(ctx: FtpContext, reason: string): void {
  const st = ctx.ftpOp;
  if (!st) return;
  clearTimers(st);
  ctx.ftpOp = null;
  st.reject(new Error(reason));
}

// ── inbound ACK/NAK handler ──────────────────────────────────

/** Handle a FILE_TRANSFER_PROTOCOL ACK/NAK for the active write/list/remove op.
 *  No-op when no op is active or the frame is for a different session. */
export function handleFtpOpAck(ctx: FtpContext, frame: MAVLinkFrame): void {
  const st = ctx.ftpOp;
  if (!st) return;
  const m = decodeFileTransferProtocol(frame.payload);
  if (m.opcode !== FtpOpcode.Ack && m.opcode !== FtpOpcode.Nak) return;
  // A session is assigned during 'creating'; before that (and for the
  // session-less list/remove) accept any session, after that require a match.
  if (st.session !== 0 && m.session !== st.session) return;
  // A write ACK answers the outstanding request only when it carries that
  // request's seq + 1. A delayed ACK to an earlier copy of the chunk, followed
  // by the ACK to its resend, would otherwise advance the offset twice and
  // silently drop a chunk.
  if (m.opcode === FtpOpcode.Ack && m.reqOpcode === FtpOpcode.WriteFile && m.seq !== st.seq) return;

  st.retryCount = 0;
  armInactivity(ctx);

  if (m.opcode === FtpOpcode.Nak) {
    const code = m.size >= 1 ? m.data[0] : FtpError.Fail;
    // EndOfFile terminates a directory listing successfully.
    if (st.kind === "list" && code === FtpError.EndOfFile) {
      finishOp(ctx, st.entries);
      return;
    }
    failOp(ctx, new Error(`FTP ${st.kind} NAK (${ftpErrorName(code)}) on ${st.path}`));
    return;
  }

  switch (m.reqOpcode) {
    case FtpOpcode.CreateFile: {
      st.session = m.session;
      st.phase = st.payload.length > 0 ? "writing" : "terminating";
      if (st.payload.length === 0) {
        // Empty file: nothing to write, just terminate.
        if (st.onProgress) st.onProgress(0, 0);
        finishOp(ctx, undefined);
        return;
      }
      if (st.onProgress) st.onProgress(0, st.payload.length);
      sendRequest(ctx, buildWrite(ctx));
      return;
    }
    case FtpOpcode.WriteFile: {
      // The chunk we just wrote is confirmed; advance and send the next.
      const wrote = Math.min(FTP_MAX_DATA, st.payload.length - st.writeOffset);
      st.writeOffset += wrote;
      if (st.onProgress) st.onProgress(st.writeOffset, st.payload.length);
      if (st.writeOffset >= st.payload.length) {
        finishOp(ctx, undefined);
        return;
      }
      sendRequest(ctx, buildWrite(ctx));
      return;
    }
    case FtpOpcode.ListDirectory: {
      const count = Math.min(m.size, FTP_MAX_DATA);
      // A zero-size ACK (or one carrying no complete entry) ends the listing on
      // some stacks; otherwise the walk ends only on the EOF NAK. A reply of
      // nothing but skip entries still advances the server offset and continues.
      const { entries, served } = parseDirEntries(m.data, count);
      if (served === 0) {
        finishOp(ctx, st.entries);
        return;
      }
      st.entries.push(...entries);
      st.listOffset += served;
      sendRequest(
        ctx,
        pathFrame(ctx, FtpOpcode.ListDirectory, 0, st.listOffset, st.path),
      );
      return;
    }
    case FtpOpcode.RemoveFile: {
      finishOp(ctx, undefined);
      return;
    }
    case FtpOpcode.TerminateSession: {
      finishOp(ctx, st.kind === "list" ? st.entries : undefined);
      return;
    }
    default:
      return;
  }
}
