/**
 * Flash log store — a bounded, append-only record of everything that
 * happens during a firmware flash, surfaced by the flash debug panel and
 * exportable as a self-describing `.log` file for remote diagnosis.
 *
 * Design notes:
 *  - Uses a `RingBuffer` so a long flash (or repeated retries) can never
 *    grow memory without bound. The buffer is mutated in place; consumers
 *    subscribe to `_version` (bumped on every change) and re-read via
 *    `entries.toArray()`, mirroring the DroneCAN flash-store pattern.
 *  - Preserve-across-reconnect is the DEFAULT: a device re-enumerating mid
 *    flash must NOT wipe the log. Clearing is always explicit (`clear()`).
 *
 * @module stores/flash-log-store
 */

import { create } from "zustand";
import { RingBuffer } from "@/lib/ring-buffer";
import { APP_VERSION } from "@/lib/app-version";
import type { FlashPhase } from "@/lib/protocol/firmware/types";
import { downloadBlob } from "@/lib/download";

export type FlashLogLevel = "debug" | "info" | "warning" | "error" | "success";

export type FlashLogSource =
  | "manager"
  | "serial"
  | "px4"
  | "dfu"
  | "rockchip"
  | "dronecan"
  | "ui"
  | "download";

export type FlashErrorCategory =
  | "sync_timeout"
  | "device_disconnected"
  | "board_id_mismatch"
  | "crc_mismatch"
  | "webusb_blocked"
  | "no_device"
  | "browser_unsupported"
  | "aborted"
  | "unknown";

export interface FlashLogEntry {
  ts: number;
  level: FlashLogLevel;
  source: FlashLogSource;
  phase?: FlashPhase;
  message: string;
  /** Optional raw protocol bytes, pre-formatted as hex, for the hex view. */
  rawHex?: string;
  /** Set on error entries to drive the error-remedy mapping. */
  category?: FlashErrorCategory;
}

export interface FlashSessionMeta {
  appVersion: string;
  userAgent: string;
  platform: string;
  board?: string;
  chip?: string;
  firmware?: string;
  method?: string;
  startedAt: number;
}

export interface FlashLogOptions {
  phase?: FlashPhase;
  rawHex?: string;
  category?: FlashErrorCategory;
}

const LOG_CAP = 2000;

interface FlashLogState {
  entries: RingBuffer<FlashLogEntry>;
  meta: FlashSessionMeta | null;
  /** Monotonic counter bumped on every mutation so selectors re-render. */
  _version: number;
  log: (
    level: FlashLogLevel,
    source: FlashLogSource,
    message: string,
    opts?: FlashLogOptions,
  ) => void;
  startSession: (meta?: Partial<FlashSessionMeta>) => void;
  updateMeta: (meta: Partial<FlashSessionMeta>) => void;
  clear: () => void;
  buildLogText: () => string;
  download: () => void;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/** Local wall-clock time as HH:MM:SS.mmm (matches what users see). */
function stamp(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${d
    .getMilliseconds()
    .toString()
    .padStart(3, "0")}`;
}

export const useFlashLogStore = create<FlashLogState>((set, get) => ({
  entries: new RingBuffer<FlashLogEntry>(LOG_CAP),
  meta: null,
  _version: 0,

  log: (level, source, message, opts) => {
    get().entries.push({
      ts: Date.now(),
      level,
      source,
      message,
      phase: opts?.phase,
      rawHex: opts?.rawHex,
      category: opts?.category,
    });
    set((s) => ({ _version: s._version + 1 }));
  },

  startSession: (meta) => {
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    const platform =
      typeof navigator !== "undefined"
        ? (navigator as Navigator & { platform?: string }).platform ?? ""
        : "";
    set((s) => ({
      meta: {
        appVersion: APP_VERSION,
        userAgent: ua,
        platform,
        startedAt: Date.now(),
        ...meta,
      },
      _version: s._version + 1,
    }));
  },

  updateMeta: (meta) => {
    const prev = get().meta;
    if (!prev) return;
    set((s) => ({ meta: { ...prev, ...meta }, _version: s._version + 1 }));
  },

  clear: () => {
    get().entries.clear();
    set((s) => ({ _version: s._version + 1 }));
  },

  buildLogText: () => {
    const { entries, meta } = get();
    const lines: string[] = ["# ADOS Mission Control — Flash Log"];
    if (meta) {
      lines.push(`# app: ${meta.appVersion}`);
      lines.push(`# ua: ${meta.userAgent}`);
      lines.push(`# os: ${meta.platform}`);
      const target = [
        meta.board && `board: ${meta.board}`,
        meta.chip && `chip: ${meta.chip}`,
        meta.firmware && `fw: ${meta.firmware}`,
        meta.method && `method: ${meta.method}`,
      ]
        .filter(Boolean)
        .join("   ");
      if (target) lines.push(`# ${target}`);
      lines.push(`# started: ${new Date(meta.startedAt).toISOString()}`);
    }
    lines.push(`# entries: ${entries.length}`);
    lines.push("----");
    entries.forEach((e) => {
      const phase = e.phase ? ` (${e.phase})` : "";
      lines.push(
        `${stamp(e.ts)}  [${e.level.toUpperCase()}] [${e.source}]${phase} ${e.message}`,
      );
      if (e.rawHex) lines.push(`              ${e.rawHex}`);
    });
    return lines.join("\n");
  },

  download: () => {
    if (typeof document === "undefined") return;
    const blob = new Blob([get().buildLogText()], { type: "text/plain" });
    downloadBlob(blob, `flash-log-${Date.now()}.log`);
  },
}));
