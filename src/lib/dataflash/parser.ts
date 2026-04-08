/**
 * ArduPilot DataFlash binary log parser.
 *
 * The DataFlash format is "self-describing": the FMT message (msg type 0x80)
 * declares each subsequent message type's struct shape, then the rest of the
 * file is a sequence of `[head1=0xA3] [head2=0x95] [type] [payload...]`
 * frames whose payload size + field types come from the FMT registry.
 *
 * Pure function — takes a `Uint8Array`, returns a {@link DataflashLog}.
 * No I/O. Safe for use in browser, Node, and worker contexts.
 *
 * Reference: ArduPilot `libraries/AP_Logger/AP_Logger.h` and
 * `MissionPlanner/LogAnalyzer/py2exe/DataflashLog.py`.
 *
 * @module dataflash/parser
 * @license GPL-3.0-only
 */

import { FORMAT_CHARS, formatStringWidth } from "./format-types";

const HEAD1 = 0xa3;
const HEAD2 = 0x95;
const FMT_MSG_TYPE = 0x80;

/** Header (HEAD1 + HEAD2 + type byte) length in bytes. */
const HEADER_LEN = 3;

/** FMT message payload length, fixed by the spec at 86 bytes (89 with header). */
const FMT_PAYLOAD_LEN = 86;

export interface FormatDef {
  type: number;
  /** Total payload length declared by the FMT message (excludes the 3-byte frame header). */
  length: number;
  /** Message name (e.g. `"GPS"`, `"ATT"`, `"FMT"`). */
  name: string;
  /** Format string (one char per field). */
  format: string;
  /** Field labels in declaration order, length matches `format.length`. */
  labels: string[];
}

/** A decoded record. Field names match the FMT label list. */
export type DataflashRecord = Record<string, number | string | number[]>;

export interface DataflashLog {
  /** FMT registry keyed by message type byte. */
  formats: Map<number, FormatDef>;
  /** Parameters parsed from PARM messages, name → latest value. */
  params: Map<string, number>;
  /** Decoded messages grouped by message name. */
  messages: Map<string, DataflashRecord[]>;
  /** Total bytes read. */
  bytesRead: number;
  /** Number of bytes skipped due to header sync errors. */
  resyncSkipped: number;
}

/**
 * Parse a complete ArduPilot DataFlash binary log.
 *
 * The function tolerates the typical "head bytes lost" gap (drops up to a few
 * bytes when re-syncing) but does not silently swallow malformed FMT records —
 * unknown format characters in an FMT row throw immediately.
 */
export function parseDataflashLog(buffer: Uint8Array): DataflashLog {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const formats = new Map<number, FormatDef>();
  const params = new Map<string, number>();
  const messages = new Map<string, DataflashRecord[]>();

  let ofs = 0;
  let resyncSkipped = 0;

  // Bootstrap the FMT format itself. The very first FMT message in the file
  // describes the FMT message itself: type=0x80, length=89, name="FMT",
  // format="BBnNZ", labels="Type,Length,Name,Format,Columns".
  // We pre-register it so the loop below can decode it uniformly.
  const FMT_FORMAT_DEF: FormatDef = {
    type: FMT_MSG_TYPE,
    length: FMT_PAYLOAD_LEN,
    name: "FMT",
    format: "BBnNZ",
    labels: ["Type", "Length", "Name", "Format", "Columns"],
  };
  formats.set(FMT_MSG_TYPE, FMT_FORMAT_DEF);

  while (ofs + HEADER_LEN <= buffer.length) {
    // Resync — scan forward until we find HEAD1+HEAD2.
    if (buffer[ofs] !== HEAD1 || buffer[ofs + 1] !== HEAD2) {
      ofs += 1;
      resyncSkipped += 1;
      continue;
    }
    const msgType = buffer[ofs + 2];
    const def = formats.get(msgType);
    if (!def) {
      // Unknown type — slip past the header and resync. Real-world logs do
      // contain occasional unknown types from custom firmware; tolerate.
      ofs += HEADER_LEN;
      resyncSkipped += 1;
      continue;
    }

    const payloadLen = def.length - HEADER_LEN;
    if (ofs + HEADER_LEN + payloadLen > buffer.length) {
      // Truncated tail — stop cleanly.
      break;
    }

    const payloadOfs = ofs + HEADER_LEN;
    const record = decodePayload(view, payloadOfs, def);

    if (msgType === FMT_MSG_TYPE) {
      // Self-describing: register the new format.
      const fmt: FormatDef = {
        type: Number(record.Type),
        length: Number(record.Length),
        name: String(record.Name),
        format: String(record.Format),
        labels: String(record.Columns).split(",").filter(Boolean),
      };
      // Sanity-check the format string before registering.
      try {
        formatStringWidth(fmt.format);
      } catch (err) {
        throw new Error(
          `[dataflash] FMT '${fmt.name}' (type=${fmt.type}) declares unknown format chars: ${(err as Error).message}`,
        );
      }
      formats.set(fmt.type, fmt);
    } else if (def.name === "PARM") {
      // PARM messages: { Name, Value [, Default] }. Capture latest value per name.
      const name = String(record.Name);
      const value = Number(record.Value);
      if (name) params.set(name, value);
    }

    // Stash by name. We always include FMT rows too — useful for debugging.
    let bucket = messages.get(def.name);
    if (!bucket) {
      bucket = [];
      messages.set(def.name, bucket);
    }
    bucket.push(record);

    ofs += def.length;
  }

  return {
    formats,
    params,
    messages,
    bytesRead: ofs,
    resyncSkipped,
  };
}

function decodePayload(view: DataView, ofs: number, def: FormatDef): DataflashRecord {
  const record: DataflashRecord = {};
  let cursor = 0;
  for (let i = 0; i < def.format.length; i++) {
    const ch = def.format[i];
    const reader = FORMAT_CHARS[ch];
    if (!reader) {
      // Should have been caught at FMT registration time, but be defensive.
      throw new Error(`[dataflash] Unknown format char '${ch}' in '${def.name}'`);
    }
    const label = def.labels[i] ?? `f${i}`;
    record[label] = reader.read(view, ofs + cursor);
    cursor += reader.width;
  }
  return record;
}
