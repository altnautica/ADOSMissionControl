/**
 * DataFlash .bin log parser for ArduPilot log files.
 * @license GPL-3.0-only
 */

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

export const HEADER_0 = 0xa3;
export const HEADER_1 = 0x95;
export const FMT_TYPE = 128;

// FMT message is always 89 bytes total (header + type + payload = 2+1+86)
export const FMT_LENGTH = 89;

// Size in bytes for each format character
const FORMAT_SIZES: Record<string, number> = {
  a: 64, // int16[32]
  b: 1, // int8
  B: 1, // uint8
  g: 2, // float16
  h: 2, // int16
  H: 2, // uint16
  i: 4, // int32
  I: 4, // uint32
  f: 4, // float32
  d: 8, // float64
  n: 4, // char[4]
  N: 16, // char[16]
  Z: 64, // char[64]
  c: 2, // int16 * 100
  C: 2, // uint16 * 100
  e: 4, // int32 * 100
  E: 4, // uint32 * 100
  L: 4, // int32 lat/lon * 1e7
  M: 1, // uint8 flight mode
  q: 8, // int64
  Q: 8, // uint64
};

/**
 * The message length a format string implies (header, type byte and every
 * field), or undefined when it holds a character with no known size.
 */
function formatLength(formatStr: string): number | undefined {
  let length = 3;
  for (const ch of formatStr) {
    const size = FORMAT_SIZES[ch];
    if (size === undefined) return undefined;
    length += size;
  }
  return length;
}

/** IEEE 754 half-precision float. */
function readFloat16(view: DataView, offset: number): number {
  const bits = view.getUint16(offset, true);
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const fraction = bits & 0x3ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 0x1f) return fraction === 0 ? sign * Infinity : NaN;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Read a null-terminated string from a DataView. */
function readString(view: DataView, offset: number, length: number): string {
  let end = offset + length;
  // find null terminator
  for (let i = offset; i < end; i++) {
    if (view.getUint8(i) === 0) {
      end = i;
      break;
    }
  }
  let str = "";
  for (let i = offset; i < end; i++) {
    str += String.fromCharCode(view.getUint8(i));
  }
  return str;
}

/** Parse a single field value from the buffer at the given offset. */
export function readField(
  view: DataView,
  offset: number,
  fmt: string,
): { value: DataFlashFieldValue; size: number } {
  switch (fmt) {
    case "a": {
      const values: number[] = [];
      for (let i = 0; i < 32; i++) values.push(view.getInt16(offset + i * 2, true));
      return { value: values, size: 64 };
    }
    case "g":
      return { value: readFloat16(view, offset), size: 2 };
    case "b":
      return { value: view.getInt8(offset), size: 1 };
    case "B":
    case "M":
      return { value: view.getUint8(offset), size: 1 };
    case "h":
      return { value: view.getInt16(offset, true), size: 2 };
    case "H":
      return { value: view.getUint16(offset, true), size: 2 };
    case "i":
    case "L":
      return { value: view.getInt32(offset, true), size: 4 };
    case "I":
      return { value: view.getUint32(offset, true), size: 4 };
    case "f":
      return { value: view.getFloat32(offset, true), size: 4 };
    case "d":
      return { value: view.getFloat64(offset, true), size: 8 };
    case "c":
      return { value: view.getInt16(offset, true) / 100, size: 2 };
    case "C":
      return { value: view.getUint16(offset, true) / 100, size: 2 };
    case "e":
      return { value: view.getInt32(offset, true) / 100, size: 4 };
    case "E":
      return { value: view.getUint32(offset, true) / 100, size: 4 };
    case "n":
      return { value: readString(view, offset, 4), size: 4 };
    case "N":
      return { value: readString(view, offset, 16), size: 16 };
    case "Z":
      return { value: readString(view, offset, 64), size: 64 };
    case "q": {
      // Read as two 32-bit halves (little-endian) — stay within Number range
      const lo = view.getUint32(offset, true);
      const hi = view.getInt32(offset + 4, true);
      return { value: hi * 0x100000000 + lo, size: 8 };
    }
    case "Q": {
      const lo = view.getUint32(offset, true);
      const hi = view.getUint32(offset + 4, true);
      return { value: hi * 0x100000000 + lo, size: 8 };
    }
    default:
      // Unreachable for a validated FMT: every character has a known size.
      return { value: 0, size: FORMAT_SIZES[fmt] ?? 1 };
  }
}

/** Parse a FMT message payload starting at `offset` (right after type byte). */
export function parseFmt(view: DataView, offset: number): FormatDef {
  const type = view.getUint8(offset);
  const length = view.getUint8(offset + 1);
  const name = readString(view, offset + 2, 4);
  const formatStr = readString(view, offset + 6, 16);
  const columnsRaw = readString(view, offset + 22, 64);
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
        if (fmt.length < 3 || formatLength(fmt.formatStr) !== fmt.length) {
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

      for (let i = 0; i < fmt.formatStr.length && i < fmt.columns.length; i++) {
        const col = fmt.columns[i];
        const { value, size } = readField(view, fieldOffset, fmt.formatStr[i]);
        fields[col] = value;
        if (col === "TimeUS" && typeof value === "number") timestamp = value;
        fieldOffset += size;
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

// Re-export streaming parser for backward compatibility
export {
  parseDataFlashLogStreaming,
  type StreamingProgressCallback,
  type StreamingParseOptions,
} from "./dataflash-streaming";
