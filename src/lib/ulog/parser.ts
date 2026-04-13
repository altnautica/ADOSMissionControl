/**
 * PX4 ULog v1 binary parser.
 *
 * Reference: https://docs.px4.io/main/en/dev_log/ulog_file_format.html
 *
 * Two-pass design:
 *  1. Parse header + definitions (FMT 'F', Info 'I', Param 'P', Subscribe 'A')
 *  2. Decode data messages ('D'), logging ('L'), dropout ('O')
 *
 * Phase 30.
 *
 * @module ulog/parser
 * @license GPL-3.0-only
 */

// ── Types ────────────────────────────────────────────────────

export interface UlogFormat {
  name: string;
  fields: { type: string; name: string; arraySize?: number }[];
}

export interface UlogSubscription {
  msgId: number;
  multiId: number;
  messageName: string;
}

export interface UlogFile {
  version: number;
  timestamp: bigint;
  formats: Map<string, UlogFormat>;
  params: Map<string, number | string>;
  info: Map<string, unknown>;
  subscriptions: Map<number, UlogSubscription>;
  data: Map<string, Record<string, unknown>[]>;
  logging: { level: number; timestamp: bigint; message: string }[];
  dropouts: { duration: number; count: number }[];
}

// ── Magic bytes ──────────────────────────────────────────────

const ULOG_MAGIC = [0x55, 0x4c, 0x6f, 0x67, 0x01, 0x12, 0x35]; // "ULog\x01\x12\x35"

// ── Message types ────────────────────────────────────────────

const MSG_FORMAT = 0x46;       // 'F'
const MSG_DATA = 0x44;         // 'D'
const MSG_INFO = 0x49;         // 'I'
const MSG_INFO_MULTI = 0x4d;   // 'M'
const MSG_PARAM = 0x50;        // 'P'
const MSG_PARAM_DEFAULT = 0x51; // 'Q'
const MSG_ADD_LOGGED = 0x41;   // 'A'
const MSG_REMOVE_LOGGED = 0x52; // 'R'
const MSG_LOGGING = 0x4c;      // 'L'
const MSG_LOGGING_TAGGED = 0x43; // 'C'
const MSG_SYNC = 0x53;         // 'S'
const MSG_DROPOUT = 0x4f;      // 'O'
const MSG_FLAG_BITS = 0x42;    // 'B'

// ── Field size map ───────────────────────────────────────────

function fieldSize(type: string): number {
  switch (type) {
    case "uint8_t": case "int8_t": case "bool": case "char": return 1;
    case "uint16_t": case "int16_t": return 2;
    case "uint32_t": case "int32_t": case "float": return 4;
    case "uint64_t": case "int64_t": case "double": return 8;
    default: return 0; // nested type — resolved at parse time
  }
}

function readField(dv: DataView, offset: number, type: string): { value: unknown; size: number } {
  switch (type) {
    case "uint8_t": return { value: dv.getUint8(offset), size: 1 };
    case "int8_t": return { value: dv.getInt8(offset), size: 1 };
    case "bool": return { value: dv.getUint8(offset) !== 0, size: 1 };
    case "char": return { value: String.fromCharCode(dv.getUint8(offset)), size: 1 };
    case "uint16_t": return { value: dv.getUint16(offset, true), size: 2 };
    case "int16_t": return { value: dv.getInt16(offset, true), size: 2 };
    case "uint32_t": return { value: dv.getUint32(offset, true), size: 4 };
    case "int32_t": return { value: dv.getInt32(offset, true), size: 4 };
    case "float": return { value: dv.getFloat32(offset, true), size: 4 };
    case "uint64_t": return { value: Number(dv.getBigUint64(offset, true)), size: 8 };
    case "int64_t": return { value: Number(dv.getBigInt64(offset, true)), size: 8 };
    case "double": return { value: dv.getFloat64(offset, true), size: 8 };
    default: return { value: 0, size: 0 };
  }
}

// ── Parser ───────────────────────────────────────────────────

export function parseUlog(buffer: ArrayBuffer): UlogFile {
  const bytes = new Uint8Array(buffer);
  const dv = new DataView(buffer);

  // Validate magic
  for (let i = 0; i < ULOG_MAGIC.length; i++) {
    if (bytes[i] !== ULOG_MAGIC[i]) throw new Error("Not a ULog file (bad magic bytes)");
  }

  const version = bytes[7];
  const timestamp = dv.getBigUint64(8, true);

  const result: UlogFile = {
    version,
    timestamp,
    formats: new Map(),
    params: new Map(),
    info: new Map(),
    subscriptions: new Map(),
    data: new Map(),
    logging: [],
    dropouts: [],
  };

  let pos = 16; // After header (7 magic + 1 version + 8 timestamp)

  // Flag bits message (always first after header in v1)
  if (pos < bytes.length && bytes[pos + 2] === MSG_FLAG_BITS) {
    const msgSize = dv.getUint16(pos, true);
    pos += 3 + msgSize; // skip flag bits
  }

  // Parse all messages
  while (pos + 3 <= bytes.length) {
    const msgSize = dv.getUint16(pos, true);
    const msgType = bytes[pos + 2];
    const msgStart = pos + 3;
    const msgEnd = msgStart + msgSize;

    if (msgEnd > bytes.length) break;

    switch (msgType) {
      case MSG_FORMAT: {
        const formatStr = textDecoder.decode(bytes.slice(msgStart, msgEnd));
        const colonIdx = formatStr.indexOf(":");
        if (colonIdx > 0) {
          const name = formatStr.slice(0, colonIdx);
          const fieldsStr = formatStr.slice(colonIdx + 1);
          const fields = fieldsStr.split(";").filter(Boolean).map((f) => {
            const parts = f.trim().split(/\s+/);
            const typeStr = parts[0];
            const nameStr = parts[1] ?? "";
            const bracketIdx = nameStr.indexOf("[");
            if (bracketIdx >= 0) {
              const arraySize = parseInt(nameStr.slice(bracketIdx + 1, nameStr.indexOf("]")));
              return { type: typeStr, name: nameStr.slice(0, bracketIdx), arraySize };
            }
            return { type: typeStr, name: nameStr };
          });
          result.formats.set(name, { name, fields });
        }
        break;
      }

      case MSG_INFO:
      case MSG_INFO_MULTI: {
        const keyLen = bytes[msgStart];
        const key = textDecoder.decode(bytes.slice(msgStart + 1, msgStart + 1 + keyLen));
        // Simple: store raw value as string
        const valBytes = bytes.slice(msgStart + 1 + keyLen, msgEnd);
        result.info.set(key, textDecoder.decode(valBytes));
        break;
      }

      case MSG_PARAM:
      case MSG_PARAM_DEFAULT: {
        const keyLen = bytes[msgStart];
        const key = textDecoder.decode(bytes.slice(msgStart + 1, msgStart + 1 + keyLen));
        const valOffset = msgStart + 1 + keyLen;
        // Params are either int32 or float — detect by remaining size
        const remaining = msgEnd - valOffset;
        if (remaining >= 4) {
          // Try float first (PX4 convention)
          result.params.set(key, dv.getFloat32(valOffset, true));
        }
        break;
      }

      case MSG_ADD_LOGGED: {
        const multiId = bytes[msgStart];
        const msgId = dv.getUint16(msgStart + 1, true);
        const messageName = textDecoder.decode(bytes.slice(msgStart + 3, msgEnd));
        result.subscriptions.set(msgId, { msgId, multiId, messageName: messageName.replace(/\0/g, "") });
        break;
      }

      case MSG_DATA: {
        const msgId = dv.getUint16(msgStart, true);
        const sub = result.subscriptions.get(msgId);
        if (!sub) break;

        const fmt = result.formats.get(sub.messageName);
        if (!fmt) break;

        const row: Record<string, unknown> = {};
        let fieldOffset = msgStart + 2;

        for (const field of fmt.fields) {
          if (fieldOffset >= msgEnd) break;
          const baseSize = fieldSize(field.type);

          if (field.arraySize && baseSize > 0) {
            const arr: unknown[] = [];
            for (let i = 0; i < field.arraySize && fieldOffset < msgEnd; i++) {
              const { value, size } = readField(dv, fieldOffset, field.type);
              arr.push(value);
              fieldOffset += size;
            }
            row[field.name] = arr;
          } else if (baseSize > 0) {
            const { value, size } = readField(dv, fieldOffset, field.type);
            row[field.name] = value;
            fieldOffset += size;
          } else {
            // Nested type — skip (not common in data messages)
            break;
          }
        }

        const topicName = sub.messageName;
        if (!result.data.has(topicName)) result.data.set(topicName, []);
        result.data.get(topicName)!.push(row);
        break;
      }

      case MSG_LOGGING:
      case MSG_LOGGING_TAGGED: {
        const level = bytes[msgStart];
        const ts = dv.getBigUint64(msgStart + 1, true);
        const message = textDecoder.decode(bytes.slice(msgStart + 9, msgEnd)).replace(/\0/g, "");
        result.logging.push({ level, timestamp: ts, message });
        break;
      }

      case MSG_DROPOUT: {
        const duration = dv.getUint16(msgStart, true);
        result.dropouts.push({ duration, count: 1 });
        break;
      }

      case MSG_SYNC:
      case MSG_REMOVE_LOGGED:
        // Ignored
        break;
    }

    pos = msgEnd;
  }

  return result;
}

const textDecoder = new TextDecoder("utf-8");
