/**
 * DataFlash .bin log parser for ArduPilot log files.
 * @license GPL-3.0-only
 */

import { FORMAT_CHARS, formatStringWidth } from "./dataflash/format-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FormatDef {
  type: number;
  length: number;
  name: string;
  formatStr: string;
  columns: string[];
}

/** A decoded field: a number, a string, or an `a` field's int16 array. */
export type DataFlashFieldValue = number | string | number[];

export interface DataFlashMessage {
  type: number;
  name: string;
  timestamp?: number;
  fields: Record<string, DataFlashFieldValue>;
}

export interface DataFlashLog {
  formats: Map<number, FormatDef>;
  messages: Map<string, DataFlashMessage[]>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HEADER_0 = 0xa3;
const HEADER_1 = 0x95;
const FMT_TYPE = 128;

// FMT message is always 89 bytes total (header + type + payload = 2+1+86)
const FMT_LENGTH = 89;

/** Parse a FMT message payload starting at `offset` (right after type byte). */
function parseFmt(view: DataView, offset: number): FormatDef {
  const type = view.getUint8(offset);
  const length = view.getUint8(offset + 1);
  const name = String(FORMAT_CHARS.n.read(view, offset + 2));
  const formatStr = String(FORMAT_CHARS.N.read(view, offset + 6));
  const columnsRaw = String(FORMAT_CHARS.Z.read(view, offset + 22));
  const columns = columnsRaw ? columnsRaw.split(",") : [];
  return { type, length, name, formatStr, columns };
}

/** Parse state shared by the synchronous and streaming entry points. */
export interface DataFlashScan {
  view: DataView;
  formats: Map<number, FormatDef>;
  messages: Map<string, DataFlashMessage[]>;
  /** Byte offset of the next unread byte. */
  pos: number;
}

export function createDataFlashScan(buffer: ArrayBuffer): DataFlashScan {
  return { view: new DataView(buffer), formats: new Map(), messages: new Map(), pos: 0 };
}

function pushMessage(messages: Map<string, DataFlashMessage[]>, msg: DataFlashMessage): void {
  let list = messages.get(msg.name);
  if (!list) {
    list = [];
    messages.set(msg.name, list);
  }
  list.push(msg);
}

/**
 * Decode messages from `scan.pos` until the position reaches `until` or the
 * buffer ends. Returns false once the buffer is exhausted or truncated.
 *
 * A FMT record is registered only when its length matches the size its
 * format string implies. A zero or short length would never advance the
 * position, and a mismatched one misreads every later field; either is a
 * corrupt record or a false header match while resyncing, so the scan
 * steps one byte and resyncs.
 */
export function scanDataFlash(scan: DataFlashScan, until: number): boolean {
  const { view, formats, messages } = scan;
  const len = view.byteLength;
  let pos = scan.pos;
  try {
    while (pos + 3 <= len) {
      if (pos >= until) return true;
      // Scan for header bytes; on lost sync advance one byte and retry.
      if (view.getUint8(pos) !== HEADER_0 || view.getUint8(pos + 1) !== HEADER_1) {
        pos++;
        continue;
      }

      const msgType = view.getUint8(pos + 2);

      // --- FMT messages (self-describing, always 89 bytes) ---
      if (msgType === FMT_TYPE) {
        if (pos + FMT_LENGTH > len) return false; // truncated
        const fmt = parseFmt(view, pos + 3);
        if (fmt.length < 3 || formatStringWidth(fmt.formatStr) !== fmt.length - 3) {
          pos++;
          continue;
        }
        formats.set(fmt.type, fmt);
        pushMessage(messages, {
          type: FMT_TYPE,
          name: "FMT",
          fields: {
            Type: fmt.type,
            Length: fmt.length,
            Name: fmt.name,
            Format: fmt.formatStr,
            Columns: fmt.columns.join(","),
          },
        });
        pos += FMT_LENGTH;
        continue;
      }

      // --- All other messages ---
      const fmt = formats.get(msgType);
      if (!fmt) {
        // Unknown message type and no FMT yet — skip header + type and resync
        pos += 3;
        continue;
      }

      if (pos + fmt.length > len) return false; // truncated

      // Payload starts after header (2) + type (1) = offset 3
      let fieldOffset = pos + 3;
      const fields: Record<string, DataFlashFieldValue> = {};
      let timestamp: number | undefined;

      // Registration checked the format string's width against the declared
      // length, so every character here has a table entry.
      for (let i = 0; i < fmt.formatStr.length && i < fmt.columns.length; i++) {
        const col = fmt.columns[i];
        const def = FORMAT_CHARS[fmt.formatStr[i]];
        const value = def.read(view, fieldOffset);
        fields[col] = value;
        if (col === "TimeUS" && typeof value === "number") timestamp = value;
        fieldOffset += def.width;
      }

      pushMessage(messages, { type: msgType, name: fmt.name, timestamp, fields });
      pos += fmt.length;
    }
    return false;
  } finally {
    scan.pos = pos;
  }
}

/** Parse a DataFlash .bin log file in one synchronous sweep. */
export function parseDataFlashLog(buffer: ArrayBuffer): DataFlashLog {
  const scan = createDataFlashScan(buffer);
  scanDataFlash(scan, Infinity);
  return { formats: scan.formats, messages: scan.messages };
}

/** Get all message type names present in a parsed log. */
export function getMessageTypes(log: DataFlashLog): string[] {
  return Array.from(log.messages.keys()).sort();
}

/** Get all messages of a given type name. */
export function getMessages(log: DataFlashLog, type: string): DataFlashMessage[] {
  return log.messages.get(type) ?? [];
}

/**
 * Extract a time series for a specific field from a message type.
 * Only includes entries that have both a TimeUS timestamp and a numeric value.
 */
export function getTimeSeries(
  log: DataFlashLog,
  type: string,
  field: string,
): { timeUs: number; value: number }[] {
  const msgs = log.messages.get(type);
  if (!msgs) return [];

  const series: { timeUs: number; value: number }[] = [];
  for (const msg of msgs) {
    if (msg.timestamp == null) continue;
    const val = msg.fields[field];
    if (typeof val !== "number") continue;
    series.push({ timeUs: msg.timestamp, value: val });
  }
  return series;
}
