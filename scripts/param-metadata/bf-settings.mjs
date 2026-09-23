/**
 * Generate the bundled Betaflight full-settings catalog.
 *
 * Betaflight has no runtime name-based settings introspection (no
 * MSP2_COMMON_SETTING_INFO — that is iNav's protocol). The only route to the
 * ~810 named settings is the CLI (`get`/`set`/`dump`), which returns values but
 * no metadata. This generator produces the metadata (type / range / enum
 * options per setting) offline, clean-room from the firmware source
 * (`cli/settings.c` valueTable[] + lookupTables[] + fc/parameter_names.h), so
 * the settings viewer can render enum dropdowns / ranged numerics for values
 * read live over the CLI. Version-keyed by the firmware's FC_VERSION.
 *
 * Source (local firmware tree preferred, else the master branch over HTTPS):
 *   BF_FIRMWARE_DIR (default ~/.betaflight) / master
 *
 * Run:  node scripts/param-metadata/bf-settings.mjs
 *
 * @license GPL-3.0-only
 */

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { PUBLIC_DIR, httpsGetBuffer, compact, writeSnapshot } from "./_shared.mjs";

const BF_DIR = process.env.BF_FIRMWARE_DIR || join(homedir(), ".betaflight");
const RAW = "https://raw.githubusercontent.com/betaflight/betaflight/master";

/** Read a firmware source file: local tree first, then master over HTTPS. */
async function readSource(rel) {
  try {
    return await readFile(join(BF_DIR, rel), "utf8");
  } catch {
    return (await httpsGetBuffer(`${RAW}/${rel}`)).toString("utf8");
  }
}

const VAR_TYPE = {
  VAR_UINT8: "uint8", VAR_INT8: "int8", VAR_UINT16: "uint16",
  VAR_INT16: "int16", VAR_UINT32: "uint32", VAR_INT32: "int32",
};
const ON_OFF = [[0, "OFF"], [1, "ON"]];

/** Strip C block/line comments and preprocessor lines (keep every entry). */
function stripCpp(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

/** Parse an int literal; undefined for symbolic macros / expressions. */
function intOrNull(v) {
  if (v == null) return undefined;
  const s = String(v).trim();
  if (!/^-?\d+$/.test(s)) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

// ── Version key ──────────────────────────────────────────────
const versionH = await readSource("src/main/build/version.h");
const vd = (name) => versionH.match(new RegExp(`#define\\s+FC_VERSION_${name}\\s+(\\S+)`))?.[1];
const year = vd("YEAR"), month = vd("MONTH"), patch = vd("PATCH_LEVEL");
const suffix = versionH.match(/#define\s+FC_VERSION_SUFFIX\s+"([^"]*)"/)?.[1] || "";
if (!year || !month || patch == null) throw new Error("bf-settings: could not parse FC_VERSION from version.h");
const versionKey = `${year}.${month}`;
const versionFull = `${year}.${month}.${patch}${suffix ? `-${suffix}` : ""}`;

// ── Lookup tables (enum → labels) ────────────────────────────
const settingsH = await readSource("src/main/cli/settings.h");
const settingsC = await readSource("src/main/cli/settings.c");

// 1. lookupTableIndex_e order (TABLE_* symbols, LOOKUP_TABLE_COUNT excluded).
const enumBody = stripCpp(settingsH).match(/typedef enum\s*\{([\s\S]*?)\}\s*lookupTableIndex_e/)?.[1];
if (!enumBody) throw new Error("bf-settings: lookupTableIndex_e enum not found");
const tableSymbols = [...enumBody.matchAll(/\b(TABLE_[A-Z0-9_]+)\b/g)].map((m) => m[1]);

// 2. lookupTables[] registration order (array names, same #ifdef structure).
const regBody = stripCpp(settingsC).match(/const lookupTableEntry_t lookupTables\[\]\s*=\s*\{([\s\S]*?)\n\};/)?.[1];
if (!regBody) throw new Error("bf-settings: lookupTables[] registration not found");
const arrayNames = [];
for (const raw of regBody.split(",")) {
  const s = raw.trim();
  if (!s) continue;
  const le = s.match(/LOOKUP_TABLE_ENTRY\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/);
  const br = s.match(/\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/); // "{ arrayName" of "{ arrayName, COUNT }"
  if (le) arrayNames.push(le[1]);
  else if (br) arrayNames.push(br[1]);
}
if (tableSymbols.length !== arrayNames.length) {
  throw new Error(`bf-settings: lookup index/registration misaligned (${tableSymbols.length} symbols vs ${arrayNames.length} arrays)`);
}
const tableToArray = new Map(tableSymbols.map((sym, i) => [sym, arrayNames[i]]));

// 3. Array bodies defined in settings.c → labels. Arrays defined in other
//    files (currentMeterSourceNames, debugModeNames, *Hardware, …) are absent
//    here → those tables ship without enum labels (omit, don't guess).
const arrayLabels = new Map();
for (const m of settingsC.matchAll(/const char \* const (\w+)\[\]\s*=\s*\{([\s\S]*?)\};/g)) {
  const labels = [...m[2].matchAll(/"([^"]*)"/g)].map((x) => x[1]);
  if (labels.length) arrayLabels.set(m[1], labels);
}
const valuesFor = (tableSym) => {
  const arr = tableToArray.get(tableSym);
  const labels = arr && arrayLabels.get(arr);
  return labels && labels.length ? labels.map((label, i) => [i, label]) : undefined;
};

// ── PARAM_NAME_* macro map ───────────────────────────────────
const paramNamesH = await readSource("src/main/fc/parameter_names.h");
const paramNames = new Map();
for (const m of paramNamesH.matchAll(/#define\s+(PARAM_NAME_[A-Z0-9_]+)\s+"([^"]*)"/g)) {
  paramNames.set(m[1], m[2]);
}

// ── valueTable[] rows ────────────────────────────────────────
const vtBody = stripCpp(settingsC).match(/const clivalue_t valueTable\[\]\s*=\s*\{([\s\S]*?)\n\};/)?.[1];
if (!vtBody) throw new Error("bf-settings: valueTable[] not found");

/** Split a struct-array body into top-level {...} row strings by brace depth. */
function splitRows(body) {
  const rows = [];
  let depth = 0, start = -1;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "{") { if (depth === 0) start = i; depth++; }
    else if (c === "}") { depth--; if (depth === 0 && start >= 0) { rows.push(body.slice(start, i + 1)); start = -1; } }
  }
  return rows;
}

const seen = new Set();
const params = [];
for (const row of splitRows(vtBody)) {
  // name: first token — a "string literal" or a PARAM_NAME_* / bare identifier.
  const nm = row.match(/^\{\s*(?:"([^"]*)"|([A-Za-z_][A-Za-z0-9_]*))/);
  if (!nm) continue;
  let name = nm[1];
  if (name === undefined) {
    const id = nm[2];
    name = id.startsWith("PARAM_NAME_") ? paramNames.get(id) : id;
  }
  if (!name || seen.has(name)) continue;

  const varType = row.match(/\bVAR_(UINT8|INT8|UINT16|INT16|UINT32|INT32)\b/);
  const baseType = varType ? VAR_TYPE[`VAR_${varType[1]}`] : undefined;
  const mode = row.match(/\bMODE_(LOOKUP|ARRAY|BITSET|STRING)\b/)?.[1] || "DIRECT";
  const group = row.match(/,\s*(PG_[A-Z0-9_]+)\s*,/)?.[1];

  let valueType = baseType;
  let values;
  let range;
  if (mode === "LOOKUP") {
    const t = row.match(/\.config\.lookup\s*=\s*\{\s*(TABLE_[A-Z0-9_]+)/)?.[1];
    if (t) values = valuesFor(t);
  } else if (mode === "BITSET") {
    values = ON_OFF; // CLI reads/writes the flag as 0/1
    valueType = "uint8";
  } else if (mode === "STRING" || mode === "ARRAY") {
    valueType = "string"; // CLI get/set is a (comma-list) string
  } else { // DIRECT
    const mm = row.match(/\.config\.minmax\s*=\s*\{\s*(-?\w+)\s*,\s*(-?\w+)\s*\}/);
    const mu = row.match(/\.config\.minmaxUnsigned\s*=\s*\{\s*(\w+)\s*,\s*(\w+)\s*\}/);
    const u32 = row.match(/\.config\.u32Max\s*=\s*([^,]+?)\s*,/);
    if (mm) { const lo = intOrNull(mm[1]), hi = intOrNull(mm[2]); if (lo !== undefined && hi !== undefined) range = { min: lo, max: hi }; }
    else if (mu) { const lo = intOrNull(mu[1]), hi = intOrNull(mu[2]); if (lo !== undefined && hi !== undefined) range = { min: lo, max: hi }; }
    else if (u32) { const hi = intOrNull(u32[1]); if (hi !== undefined) range = { min: 0, max: hi }; }
    // d32Max (signed max) intentionally left without a range (min is not sourced).
  }

  seen.add(name);
  params.push(compact({ name, humanName: "", description: "", valueType, values, range, group }));
}

params.sort((a, b) => a.name.localeCompare(b.name));

// ── Anchor validation (fail loudly on a parse regression) ──
const byName = new Map(params.map((p) => [p.name, p]));
function assertAnchor(name, expectType, expectLabel) {
  const p = byName.get(name);
  if (!p) throw new Error(`bf-settings anchor: "${name}" missing from the catalog`);
  if (expectType && p.valueType !== expectType) throw new Error(`bf-settings anchor: "${name}" valueType ${p.valueType} != ${expectType}`);
  if (expectLabel && !(p.values ?? []).some(([, l]) => l === expectLabel)) {
    throw new Error(`bf-settings anchor: "${name}" missing enum label "${expectLabel}"`);
  }
}
assertAnchor("gyro_hardware_lpf", "uint8", "NORMAL");
assertAnchor("motor_pwm_protocol", "uint8", "DSHOT600");
assertAnchor("serialrx_provider", "uint8", "CRSF");
assertAnchor("failsafe_procedure", "uint8", "GPS-RESCUE");
assertAnchor("gyro_lpf1_static_hz", "uint16");

const count = await writeSnapshot(
  join(PUBLIC_DIR, `bf-settings-${versionKey}.json.gz`),
  {
    firmware: "betaflight",
    version: versionKey,
    versionFull,
    source: "Betaflight firmware cli/settings.c valueTable + lookupTables",
    generatedAt: new Date().toISOString(),
  },
  params,
  700,
);
const withEnum = params.filter((p) => p.values).length;
const withRange = params.filter((p) => p.range).length;
console.log(`betaflight settings ${versionFull}: ${count} settings (${withEnum} enum, ${withRange} ranged, ${tableToArray.size} lookup tables)`);
