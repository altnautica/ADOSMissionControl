/**
 * PX4 ULog v1 binary parser.
 *
 * Reference: https://docs.px4.io/main/en/dev_log/ulog_file_format.html
 *
 * Two-pass design:
 *  1. Parse header + definitions (FMT 'F', Info 'I', Param 'P', Subscribe 'A')
 *  2. Decode data messages ('D'), logging ('L'), dropout ('O')
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
  /** Data rows per topic. Instance 0 is keyed by the topic name; a further
   * instance of the same topic (a second battery, a second GPS) is keyed
   * `<name>:<multi_id>` so its rows never interleave with instance 0. */
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
const MSG_ADD_LOGGED = 0x41;   // 'A'
const MSG_REMOVE_LOGGED = 0x52; // 'R'
const MSG_LOGGING = 0x4c;      // 'L'
const MSG_LOGGING_TAGGED = 0x43; // 'C'
const MSG_SYNC = 0x53;         // 'S'
const MSG_DROPOUT = 0x4f;      // 'O'
const MSG_FLAG_BITS = 0x42;    // 'B'

// ── Field size map ───────────────────────────────────────────

/** Byte width of a ULog primitive type; 0 for a nested (struct) type. */
function primitiveSize(type: string): number {
  switch (type) {
    case "uint8_t": case "int8_t": case "bool": case "char": return 1;
    case "uint16_t": case "int16_t": return 2;
    case "uint32_t": case "int32_t": case "float": return 4;
    case "uint64_t": case "int64_t": case "double": return 8;
    default: return 0;
  }
}

/** Read one primitive at `offset`; the caller has bounds-checked it. */
function readPrimitive(dv: DataView, offset: number, type: string): unknown {
  switch (type) {
    case "uint8_t": return dv.getUint8(offset);
    case "int8_t": return dv.getInt8(offset);
    case "bool": return dv.getUint8(offset) !== 0;
    case "char": return String.fromCharCode(dv.getUint8(offset));
    case "uint16_t": return dv.getUint16(offset, true);
    case "int16_t": return dv.getInt16(offset, true);
    case "uint32_t": return dv.getUint32(offset, true);
    case "int32_t": return dv.getInt32(offset, true);
    case "float": return dv.getFloat32(offset, true);
    case "uint64_t": return Number(dv.getBigUint64(offset, true));
    case "int64_t": return Number(dv.getBigInt64(offset, true));
    case "double": return dv.getFloat64(offset, true);
    default: return undefined;
  }
}

/** A field spec is `type name` or `type[N] name`; the array length is on the type. */
const ARRAY_TYPE = /^(\w+)\[(\d+)\]$/;

function parseFieldSpec(spec: string): UlogFormat["fields"][number] | null {
  const parts = spec.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const [typeStr, name] = parts;
  const array = ARRAY_TYPE.exec(typeStr);
  if (array) return { type: array[1], name, arraySize: parseInt(array[2], 10) };
  return { type: typeStr, name };
}

/**
 * Byte size of a format, resolving nested formats recursively. Undefined when
 * a nested type has no definition (or the definitions form a cycle), because
 * the fields after it cannot be located.
 */
function formatSize(
  formats: Map<string, UlogFormat>,
  name: string,
  cache: Map<string, number | undefined>,
  visiting: Set<string> = new Set(),
): number | undefined {
  if (cache.has(name)) return cache.get(name);
  const fmt = formats.get(name);
  if (!fmt || visiting.has(name)) return undefined;
  visiting.add(name);
  let total = 0;
  for (const field of fmt.fields) {
    const size = fieldTypeSize(formats, field.type, cache, visiting);
    if (size === undefined) {
      visiting.delete(name);
      cache.set(name, undefined);
      return undefined;
    }
    total += size * (field.arraySize ?? 1);
  }
  visiting.delete(name);
  cache.set(name, total);
  return total;
}

function fieldTypeSize(
  formats: Map<string, UlogFormat>,
  type: string,
  cache: Map<string, number | undefined>,
  visiting?: Set<string>,
): number | undefined {
  const primitive = primitiveSize(type);
  return primitive > 0 ? primitive : formatSize(formats, type, cache, visiting);
}

/**
 * Decode the fields of `fmt` starting at `offset`, never reading past `end`.
 * Padding fields are stepped over by size. Decoding stops at the first field
 * that does not fit in the message or whose nested type is undefined; the
 * fields read so far are kept.
 */
function decodeFormat(
  dv: DataView,
  formats: Map<string, UlogFormat>,
  fmt: UlogFormat,
  offset: number,
  end: number,
  cache: Map<string, number | undefined>,
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  let at = offset;
  for (const field of fmt.fields) {
    const size = fieldTypeSize(formats, field.type, cache);
    if (size === undefined) break;
    const count = field.arraySize ?? 1;
    const total = size * count;
    if (at + total > end) break;
    if (field.name.startsWith("_padding")) {
      at += total;
      continue;
    }
    const nested = primitiveSize(field.type) === 0 ? formats.get(field.type) : undefined;
    if (field.arraySize !== undefined) {
      const arr: unknown[] = new Array(count);
      for (let i = 0; i < count; i++) {
        const o = at + i * size;
        arr[i] = nested ? decodeFormat(dv, formats, nested, o, o + size, cache) : readPrimitive(dv, o, field.type);
      }
      row[field.name] = arr;
    } else {
      row[field.name] = nested
        ? decodeFormat(dv, formats, nested, at, at + size, cache)
        : readPrimitive(dv, at, field.type);
    }
    at += total;
  }
  return row;
}

export interface UlogParseOptions {
  /**
   * Topics whose data rows are kept. Rows of every other topic are stepped
   * over without decoding. All topics are kept when absent.
   */
  only?: ReadonlySet<string>;
  /** Called with the fraction of the file read, at most every 1% of the file. */
  onProgress?: (fraction: number) => void;
}

// ── Parser ───────────────────────────────────────────────────

export function parseUlog(buffer: ArrayBuffer, options: UlogParseOptions = {}): UlogFile {
  const { only, onProgress } = options;
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
  const sizeCache = new Map<string, number | undefined>();
  const progressStep = Math.max(1, Math.floor(bytes.length / 100));
  let nextProgressAt = progressStep;

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
    if (onProgress && msgEnd >= nextProgressAt) {
      onProgress(msgEnd / bytes.length);
      nextProgressAt = msgEnd + progressStep;
    }

    switch (msgType) {
      case MSG_FORMAT: {
        const formatStr = textDecoder.decode(bytes.slice(msgStart, msgEnd));
        const colonIdx = formatStr.indexOf(":");
        if (colonIdx > 0) {
          const name = formatStr.slice(0, colonIdx);
          const fieldsStr = formatStr.slice(colonIdx + 1);
          const fields = fieldsStr.split(";").flatMap((f) => {
            const field = parseFieldSpec(f);
            return field ? [field] : [];
          });
          result.formats.set(name, { name, fields });
          sizeCache.clear();
        }
        break;
      }

      // 'I' is key_len, key, value; 'M' prefixes an is_continued byte.
      case MSG_INFO:
      case MSG_INFO_MULTI: {
        const keyAt = msgType === MSG_INFO_MULTI ? msgStart + 1 : msgStart;
        if (keyAt >= msgEnd) break;
        const keyLen = bytes[keyAt];
        if (keyAt + 1 + keyLen > msgEnd) break;
        const key = textDecoder.decode(bytes.slice(keyAt + 1, keyAt + 1 + keyLen));
        // Simple: store raw value as string
        const valBytes = bytes.slice(keyAt + 1 + keyLen, msgEnd);
        result.info.set(key, textDecoder.decode(valBytes));
        break;
      }

      // A parameter's key is "<type> <name>" (`int32_t SYS_AUTOSTART`,
      // `float MPC_XY_VEL_MAX`), and the type says how to read the value.
      // Parameter defaults ('Q') are not the flown values and are skipped.
      case MSG_PARAM: {
        if (msgSize < 1) break;
        const keyLen = bytes[msgStart];
        const key = textDecoder.decode(bytes.slice(msgStart + 1, msgStart + 1 + keyLen));
        const valOffset = msgStart + 1 + keyLen;
        const space = key.indexOf(" ");
        if (space <= 0 || msgEnd - valOffset < 4) break;
        const type = key.slice(0, space);
        const name = key.slice(space + 1);
        if (type === "int32_t") result.params.set(name, dv.getInt32(valOffset, true));
        else if (type === "float") result.params.set(name, dv.getFloat32(valOffset, true));
        break;
      }

      case MSG_ADD_LOGGED: {
        if (msgSize < 3) break;
        const multiId = bytes[msgStart];
        const msgId = dv.getUint16(msgStart + 1, true);
        const messageName = textDecoder.decode(bytes.slice(msgStart + 3, msgEnd));
        result.subscriptions.set(msgId, { msgId, multiId, messageName: messageName.replace(/\0/g, "") });
        break;
      }

      case MSG_DATA: {
        if (msgSize < 2) break;
        const msgId = dv.getUint16(msgStart, true);
        const sub = result.subscriptions.get(msgId);
        if (!sub) break;
        if (only && !only.has(sub.messageName)) break;

        const fmt = result.formats.get(sub.messageName);
        if (!fmt) break;

        const row = decodeFormat(dv, result.formats, fmt, msgStart + 2, msgEnd, sizeCache);

        const topicName = sub.multiId === 0 ? sub.messageName : `${sub.messageName}:${sub.multiId}`;
        if (!result.data.has(topicName)) result.data.set(topicName, []);
        result.data.get(topicName)!.push(row);
        break;
      }

      // 'L' is level, timestamp, message; 'C' inserts a uint16 tag after the
      // level.
      case MSG_LOGGING:
      case MSG_LOGGING_TAGGED: {
        const tsAt = msgType === MSG_LOGGING_TAGGED ? msgStart + 3 : msgStart + 1;
        if (tsAt + 8 > msgEnd) break;
        const level = bytes[msgStart];
        const ts = dv.getBigUint64(tsAt, true);
        const message = textDecoder.decode(bytes.slice(tsAt + 8, msgEnd)).replace(/\0/g, "");
        result.logging.push({ level, timestamp: ts, message });
        break;
      }

      case MSG_DROPOUT: {
        if (msgSize < 2) break;
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
