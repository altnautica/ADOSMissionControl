#!/usr/bin/env node
/**
 * Generate the MAVLink wire-definition fixture the protocol tests compare the
 * hand-written tables against.
 *
 * Usage:
 *   node scripts/mavlink-wire/generate.mjs <message_definitions/v1.0 dir> [dialect.xml] [revision]
 *
 * The dialect defaults to `ardupilotmega.xml`, which includes `common.xml`,
 * `standard.xml` and `minimal.xml`. Includes are resolved recursively from the
 * same directory. `revision` (for example the mavlink/mavlink commit the XML
 * was checked out at) is recorded in the fixture. The output is written to
 * `src/lib/protocol/__tests__/fixtures/mavlink-definitions.json`.
 *
 * For every message the fixture records the id, the CRC_EXTRA seed (computed
 * with the MAVLink v2 rule: X.25 CRC over the message name and the base fields
 * in wire order, folded to one byte), the full payload length including
 * extensions, and each field's wire offset. It also records the enums the
 * GCS transcribes by hand.
 *
 * @license GPL-3.0-only
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ENUMS = ["MAV_CMD", "MAV_PARAM_TYPE", "GPS_FIX_TYPE", "MAV_RESULT", "MAV_FRAME", "MAV_MISSION_RESULT"];

const TYPE_SIZE = {
  char: 1, int8_t: 1, uint8_t: 1, uint8_t_mavlink_version: 1,
  int16_t: 2, uint16_t: 2,
  int32_t: 4, uint32_t: 4, float: 4,
  int64_t: 8, uint64_t: 8, double: 8,
};

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`));
  return m ? m[1] : undefined;
}

function x25(bytes, crc = 0xffff) {
  for (const b of bytes) {
    let tmp = (b ^ (crc & 0xff)) & 0xff;
    tmp = (tmp ^ (tmp << 4)) & 0xff;
    crc = ((crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)) & 0xffff;
  }
  return crc;
}

function parseType(raw) {
  const m = raw.match(/^([a-z0-9_]+)(?:\[(\d+)\])?$/);
  if (!m) throw new Error(`unparseable field type ${raw}`);
  const base = m[1];
  if (!(base in TYPE_SIZE)) throw new Error(`unknown field type ${raw}`);
  return { base, arrayLength: m[2] ? Number(m[2]) : 0 };
}

function parseMessages(xml, out) {
  const msgRe = /<message\s+([^>]*)>([\s\S]*?)<\/message>/g;
  let m;
  while ((m = msgRe.exec(xml)) !== null) {
    const id = Number(attr(m[1], "id"));
    const name = attr(m[1], "name");
    const body = m[2];
    const extAt = body.search(/<extensions\s*\/>/);
    const fieldRe = /<field\s+([^>]*?)\/?>/g;
    const fields = [];
    let f;
    while ((f = fieldRe.exec(body)) !== null) {
      const { base, arrayLength } = parseType(attr(f[1], "type"));
      fields.push({
        name: attr(f[1], "name"),
        type: base === "uint8_t_mavlink_version" ? "uint8_t" : base,
        arrayLength,
        extension: extAt >= 0 && f.index > extAt,
      });
    }
    out.set(id, { name, fields });
  }
}

function parseEnums(xml, out) {
  const enumRe = /<enum\s+([^>]*)>([\s\S]*?)<\/enum>/g;
  let m;
  while ((m = enumRe.exec(xml)) !== null) {
    const name = attr(m[1], "name");
    if (!ENUMS.includes(name)) continue;
    const entries = out.get(name) ?? {};
    const entryRe = /<entry\s+([^>]*?)\/?>/g;
    let e;
    while ((e = entryRe.exec(m[2])) !== null) {
      entries[attr(e[1], "name")] = Number(attr(e[1], "value"));
    }
    out.set(name, entries);
  }
}

function load(dir, file, seen, messages, enums) {
  if (seen.has(file)) return;
  seen.add(file);
  // Comments can hold commented-out <message>/<entry> tags; drop them first.
  const xml = readFileSync(join(dir, file), "utf8").replace(/<!--[\s\S]*?-->/g, "");
  for (const inc of xml.matchAll(/<include>([^<]+)<\/include>/g)) load(dir, inc[1].trim(), seen, messages, enums);
  parseMessages(xml, messages);
  parseEnums(xml, enums);
}

function layout(msg) {
  const size = (f) => TYPE_SIZE[f.type];
  // Base fields are sorted by element size, largest first (stable); extensions
  // follow in declaration order.
  const base = msg.fields.filter((f) => !f.extension).sort((a, b) => size(b) - size(a));
  const ext = msg.fields.filter((f) => f.extension);
  let offset = 0;
  const fields = [...base, ...ext].map((f) => {
    const entry = { name: f.name, type: f.type, offset, arrayLength: f.arrayLength, extension: f.extension };
    offset += size(f) * Math.max(1, f.arrayLength);
    return entry;
  });
  const enc = (s) => [...Buffer.from(s, "ascii")];
  let crc = x25(enc(`${msg.name} `));
  for (const f of base) {
    crc = x25(enc(`${f.type} ${f.name} `), crc);
    if (f.arrayLength) crc = x25([f.arrayLength], crc);
  }
  const baseLength = base.reduce((n, f) => n + size(f) * Math.max(1, f.arrayLength), 0);
  return { name: msg.name, crcExtra: (crc & 0xff) ^ (crc >> 8), length: offset, baseLength, fields };
}

const [dirArg, dialect = "ardupilotmega.xml", revision = "unspecified"] = process.argv.slice(2);
if (!dirArg) {
  console.error("usage: generate.mjs <message_definitions/v1.0 dir> [dialect.xml] [revision]");
  process.exit(2);
}
const messages = new Map();
const enums = new Map();
load(resolve(dirArg), dialect, new Set(), messages, enums);

const fixture = {
  dialect,
  revision,
  messages: Object.fromEntries([...messages.entries()].sort((a, b) => a[0] - b[0]).map(([id, m]) => [id, layout(m)])),
  enums: Object.fromEntries(ENUMS.map((n) => [n, enums.get(n) ?? {}])),
};
const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, "../../src/lib/protocol/__tests__/fixtures/mavlink-definitions.json");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(fixture)}\n`);
console.log(`wrote ${messages.size} messages to ${outPath}`);
