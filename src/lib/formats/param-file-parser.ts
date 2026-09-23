/**
 * @module formats/param-file-parser
 * @description Parse/serialize .param (Mission Planner) and .params (QGC) files
 * and diff against FC parameters.
 * @license GPL-3.0-only
 */

export interface ParsedParam {
  name: string;
  value: number;
  /** MAV_PARAM_TYPE when known (QGC 5th column). */
  type?: number;
}

export interface ParamDiff {
  name: string;
  fileValue: number;
  fcValue: number | null;
  status: "changed" | "added" | "unchanged";
}

export interface SerializeParamOptions {
  format: "mp" | "qgc";
  systemId?: number;
  componentId?: number;
  /** Fallback MAV_PARAM_TYPE for QGC export when not provided per-param. Default 9 (REAL32). */
  defaultType?: number;
}

const PARAM_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

function normalizeText(text: string): string {
  return text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function isCommentOrHeader(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (t.startsWith("#") || t.startsWith("//") || t.startsWith(";")) return true;
  const low = t.toLowerCase();
  if (low.startsWith("qgc")) return true;
  if (low === "vehicle_id" || low.startsWith("vehicle_id ")) return true;
  return false;
}

function stripInlineComment(line: string): string {
  let out = line;
  for (const sep of ["#", "//", ";"]) {
    const idx = out.indexOf(sep);
    if (idx !== -1) out = out.slice(0, idx);
  }
  return out.trim();
}

/**
 * Parse a .param / .params file into name/value pairs.
 * Supports Mission Planner (NAME VALUE / NAME,VALUE) and QGC
 * (VEHICLE_ID COMPONENT_ID NAME VALUE TYPE).
 */
export function parseParamFile(text: string): ParsedParam[] {
  const params: ParsedParam[] = [];
  for (const raw of normalizeText(text).split("\n")) {
    if (isCommentOrHeader(raw)) continue;
    const line = stripInlineComment(raw);
    if (!line) continue;

    const parts = line.includes(",") && !line.includes(" ")
      ? line.split(",").map((p) => p.trim()).filter(Boolean)
      : line.split(/[\s,]+/).filter(Boolean);

    if (parts.length < 2) continue;

    // QGC: sysid compid NAME VALUE [TYPE]
    if (parts.length >= 5) {
      const sys = parseInt(parts[0], 10);
      const comp = parseInt(parts[1], 10);
      const maybeName = parts[2];
      const maybeVal = parseFloat(parts[3]);
      if (!isNaN(sys) && !isNaN(comp) && PARAM_NAME_RE.test(maybeName) && !isNaN(maybeVal)) {
        const typeNum = parseInt(parts[4], 10);
        params.push({
          name: maybeName,
          value: maybeVal,
          type: !isNaN(typeNum) ? typeNum : undefined,
        });
        continue;
      }
    }

    // MP / generic: NAME VALUE
    const name = parts[0].replace(/"/g, "");
    const value = parseFloat(parts[1]);
    if (PARAM_NAME_RE.test(name) && !isNaN(value)) {
      params.push({ name, value });
    }
  }
  return params;
}

/** Serialize parameters for download. */
export function serializeParamFile(
  rows: Array<{ name: string; value: number; type?: number }>,
  options: SerializeParamOptions,
): string {
  const sys = options.systemId ?? 1;
  const comp = options.componentId ?? 1;
  const defaultType = options.defaultType ?? 9;

  if (options.format === "qgc") {
    const lines = [
      "# Onboard parameters",
      "# VEHICLE_ID COMPONENT_ID NAME VALUE TYPE",
      ...rows.map((r) => `${sys}\t${comp}\t${r.name}\t${r.value}\t${r.type ?? defaultType}`),
    ];
    return lines.join("\n") + "\n";
  }

  return rows.map((r) => `${r.name} ${r.value}`).join("\n") + (rows.length ? "\n" : "");
}

/**
 * FC parameter values arrive as float32 (PARAM_VALUE) widened to a double,
 * while file values are parsed from decimal text. Compare both at float32
 * precision so a value saved from the same FC reads as unchanged.
 */
function sameParamValue(a: number, b: number): boolean {
  return Math.fround(a) === Math.fround(b);
}

/**
 * Compare file params against current FC params.
 * Returns a diff array sorted by status (changed first, then added, then unchanged).
 */
export function compareParams(
  fileParams: ParsedParam[],
  fcParams: Map<string, number>,
): ParamDiff[] {
  const diffs: ParamDiff[] = [];

  for (const fp of fileParams) {
    const fcValue = fcParams.get(fp.name);
    if (fcValue === undefined) {
      diffs.push({ name: fp.name, fileValue: fp.value, fcValue: null, status: "added" });
    } else if (!sameParamValue(fcValue, fp.value)) {
      diffs.push({ name: fp.name, fileValue: fp.value, fcValue, status: "changed" });
    } else {
      diffs.push({ name: fp.name, fileValue: fp.value, fcValue, status: "unchanged" });
    }
  }

  const order: Record<string, number> = { changed: 0, added: 1, unchanged: 2 };
  diffs.sort((a, b) => {
    const o = order[a.status] - order[b.status];
    if (o !== 0) return o;
    return a.name.localeCompare(b.name);
  });

  return diffs;
}
