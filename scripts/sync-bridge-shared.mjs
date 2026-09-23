#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
//
// Copies the MAVLink bridge's shared modules into the packages that compile
// them under their own tsconfig (each has its own rootDir, so none can import
// across the boundary). The source under tools/mavlink-bridge/src is the only
// file to edit; run this script after changing it.
//
//   node scripts/sync-bridge-shared.mjs          write the copies
//   node scripts/sync-bridge-shared.mjs --check  exit 1 if a copy is stale

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** [source, copy] pairs, relative to the Mission Control root. */
export const SHARED_COPIES = [
  ["tools/mavlink-bridge/src/udp-peer.ts", "electron/udp-peer.ts"],
  ["tools/mavlink-bridge/src/ws-guard.ts", "tools/sitl/src/bridge/ws-guard.ts"],
];

/** The exact text a copy of `source` must hold. */
export function renderCopy(source) {
  const header =
    `// @generated from ${source} by scripts/sync-bridge-shared.mjs. Do not edit by hand.\n`;
  return header + readFileSync(join(ROOT, source), "utf8");
}

/** Copies whose on-disk text differs from the rendered source. */
export function staleCopies() {
  return SHARED_COPIES.filter(([source, copy]) => {
    let current = "";
    try {
      current = readFileSync(join(ROOT, copy), "utf8");
    } catch {
      // a missing copy is stale
    }
    return current !== renderCopy(source);
  }).map(([, copy]) => copy);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const stale = staleCopies();
    if (stale.length > 0) {
      console.error(`Stale copies: ${stale.join(", ")}. Run node scripts/sync-bridge-shared.mjs`);
      process.exit(1);
    }
  } else {
    for (const [source, copy] of SHARED_COPIES) {
      writeFileSync(join(ROOT, copy), renderCopy(source));
      console.log(`${source} -> ${copy}`);
    }
  }
}
