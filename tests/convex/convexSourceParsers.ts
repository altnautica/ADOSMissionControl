/**
 * @module convexSourceParsers
 * @description Source-level parsers for the Convex heartbeat contract: the
 * `pushStatus` args block, the `cmd_droneStatus` schema table, and the nested
 * heartbeat sub-blocks.
 *
 * Shared by the contract test (which pins this repo's own copy) and the twin
 * parity gate (which compares it against the production superset in
 * `website/convex`). ONE copy: forking a parser is how two tests come to
 * disagree about what they are reading, which is the same defect class the
 * gates themselves exist to catch.
 *
 * Deliberately string-based rather than importing the validators: the point is
 * to catch a refactor that changes a validator's SHAPE (`v.optional(v.string())`
 * -> `v.string()`), which a name-set comparison and a runtime import both miss.
 *
 * @license GPL-3.0-only
 */

/**
 * Parse the `args: { ... }` block out of a Convex mutation source file
 * by signature-based bracket matching. Returns a map from arg name to
 * the verbatim validator expression (e.g. `"v.optional(v.string())"`).
 *
 * This is deliberately string-based: we want to catch a future refactor
 * that changes the validator shape (e.g. `v.optional(v.string())` →
 * `v.string()` would silently break agents that omit the field).
 */
export function parseArgsBlock(source: string, exportName: string): Map<string, string> {
  const exportIdx = source.indexOf(`export const ${exportName}`);
  if (exportIdx < 0) throw new Error(`export ${exportName} not found`);
  const argsIdx = source.indexOf("args:", exportIdx);
  if (argsIdx < 0) throw new Error(`args block for ${exportName} not found`);
  const openBrace = source.indexOf("{", argsIdx);
  if (openBrace < 0) throw new Error("args open brace not found");

  // Walk to the matching close brace, tracking nesting depth so nested
  // `v.object({ ... })` validators don't terminate the args block early.
  let depth = 0;
  let close = -1;
  for (let i = openBrace; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close < 0) throw new Error("args close brace not found");
  const body = source.slice(openBrace + 1, close);

  // Strip line comments first so commas inside `// ... ,` don't split
  // entries early. Block comments are not used inside the args block.
  const stripped = body
    .split("\n")
    .map((line) => {
      const slash = line.indexOf("//");
      return slash >= 0 ? line.slice(0, slash) : line;
    })
    .join("\n");

  // Split into top-level field entries (depth-aware so we don't slice
  // through a nested validator).
  const entries: string[] = [];
  let buf = "";
  let inDepth = 0;
  for (const ch of stripped) {
    if (ch === "{" || ch === "(" || ch === "[") inDepth += 1;
    else if (ch === "}" || ch === ")" || ch === "]") inDepth -= 1;
    if (ch === "," && inDepth === 0) {
      if (buf.trim().length > 0) entries.push(buf.trim());
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.trim().length > 0) entries.push(buf.trim());

  const map = new Map<string, string>();
  for (const entry of entries) {
    const cleaned = entry.trim();
    if (cleaned.length === 0) continue;
    const colon = cleaned.indexOf(":");
    if (colon < 0) continue;
    const name = cleaned.slice(0, colon).trim();
    const value = cleaned.slice(colon + 1).trim();
    // Skip non-identifier names (defensive against parser drift).
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) continue;
    map.set(name, value);
  }
  return map;
}

/**
 * Slice out the body of a nested `<name>: v.optional(v.object({ ... }))`
 * block from either the mutation or the schema source.
 *
 * These nested blocks are strict `v.object()`s, so they reject any key they
 * do not declare — and because they ride the heartbeat, one undeclared key
 * takes the whole node offline in cloud mode rather than dropping a single
 * field. The assertions below work on this slice (not the whole file) so a
 * failure prints the block, not the entire module.
 */
export function nestedBlockBody(source: string, name: string): string {
  const anchor = source.indexOf(`${name}: v.optional(`);
  if (anchor < 0) throw new Error(`${name} block not found`);
  const open = source.indexOf("{", source.indexOf("v.object(", anchor));
  if (open < 0) throw new Error(`${name} object open brace not found`);

  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`${name} object close brace not found`);
}

export function radioBlockBody(source: string): string {
  return nestedBlockBody(source, "radio");
}

/**
 * The top-level field names the `cmd_droneStatus` schema table declares.
 * Depth-aware, mirroring `parseRadioBlockKeys`: only depth-0 lines inside the
 * `defineTable({ ... })` object name a column of the table itself.
 */
export function parseSchemaTableKeys(source: string): Set<string> {
  const anchor = source.indexOf("cmd_droneStatus: defineTable(");
  if (anchor < 0) throw new Error("cmd_droneStatus table not found");
  const open = source.indexOf("{", anchor);
  if (open < 0) throw new Error("cmd_droneStatus table open brace not found");

  let depth = 0;
  let close = -1;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close < 0) throw new Error("cmd_droneStatus table close brace not found");

  const keys = new Set<string>();
  let nesting = 0;
  for (const line of source.slice(open + 1, close).split("\n")) {
    const slash = line.indexOf("//");
    const code = slash >= 0 ? line.slice(0, slash) : line;
    if (nesting === 0) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(code);
      if (match) keys.add(match[1]);
    }
    for (const ch of code) {
      if (ch === "{" || ch === "(" || ch === "[") nesting += 1;
      else if (ch === "}" || ch === ")" || ch === "]") nesting -= 1;
    }
  }
  return keys;
}

/** The top-level field names a nested heartbeat block declares. */
export function parseNestedBlockKeys(source: string, name: string): Set<string> {
  const keys = new Set<string>();
  let nesting = 0;
  for (const line of nestedBlockBody(source, name).split("\n")) {
    const slash = line.indexOf("//");
    const code = slash >= 0 ? line.slice(0, slash) : line;
    // Only depth-0 lines name a field of the block object itself; anything
    // deeper belongs to a nested validator.
    if (nesting === 0) {
      const match = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*:/.exec(code);
      if (match) keys.add(match[1]);
    }
    for (const ch of code) {
      if (ch === "{" || ch === "(" || ch === "[") nesting += 1;
      else if (ch === "}" || ch === ")" || ch === "]") nesting -= 1;
    }
  }
  return keys;
}

export function parseRadioBlockKeys(source: string): Set<string> {
  return parseNestedBlockKeys(source, "radio");
}
