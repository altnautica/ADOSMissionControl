/**
 * @module formats/param-file-parser
 * @description Parse .param/.parm files and diff against FC parameters.
 * Format: lines of "NAME VALUE" or "NAME,VALUE", # for comments.
 * @license GPL-3.0-only
 */

export interface ParsedParam {
  name: string;
  value: number;
}

export interface ParamDiff {
  name: string;
  fileValue: number;
  fcValue: number | null;
  status: "changed" | "added" | "unchanged";
}

/**
 * Parse a .param file into an array of name/value pairs.
 * Handles both space-separated and comma-separated formats.
 * Skips blank lines and comment lines starting with #.
 */
export function parseParamFile(text: string): ParsedParam[] {
  const params: ParsedParam[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(/[\s,]+/);
    if (parts.length < 2) continue;
    const name = parts[0];
    const value = parseFloat(parts[1]);
    if (!isNaN(value)) {
      params.push({ name, value });
    }
  }
  return params;
}

/**
 * Compare file params against current FC params.
 * Returns a diff array sorted by status (changed first, then added, then unchanged).
 */
export function compareParams(
  fileParams: ParsedParam[],
  fcParams: Map<string, number>
): ParamDiff[] {
  const diffs: ParamDiff[] = [];

  for (const fp of fileParams) {
    const fcValue = fcParams.get(fp.name);
    if (fcValue === undefined) {
      diffs.push({ name: fp.name, fileValue: fp.value, fcValue: null, status: "added" });
    } else if (fcValue !== fp.value) {
      diffs.push({ name: fp.name, fileValue: fp.value, fcValue, status: "changed" });
    } else {
      diffs.push({ name: fp.name, fileValue: fp.value, fcValue, status: "unchanged" });
    }
  }

  // Sort: changed first, then added, then unchanged. Within each group, alphabetical.
  const order: Record<string, number> = { changed: 0, added: 1, unchanged: 2 };
  diffs.sort((a, b) => {
    const o = order[a.status] - order[b.status];
    if (o !== 0) return o;
    return a.name.localeCompare(b.name);
  });

  return diffs;
}
