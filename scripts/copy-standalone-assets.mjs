/**
 * Copy the runtime assets that Next.js `output: "standalone"` does not bundle,
 * and normalize the standalone layout for Electron / electron-builder.
 *
 * The standalone build emits a self-contained server under `.next/standalone/`
 * but intentionally leaves out `.next/static/` (hashed client chunks) and
 * `public/`. Without them the standalone server answers `/_next/static/*` with
 * 404, so the page renders its server HTML but never hydrates. The Electron
 * desktop wrapper runs this standalone server, so it needs both trees copied in.
 *
 * Next.js may also nest the traced server under a path that mirrors the
 * absolute project location (e.g. `.next/standalone/src/ADOSMissionControl/`
 * when the repo lives at `~/src/ADOSMissionControl`). Desktop packaging and
 * electron/server.ts expect `server.js` at the standalone root; we flatten here.
 *
 * Runs as `postbuild`, so every `next build` (including the desktop scripts)
 * leaves `.next/standalone/` complete. No-op when standalone output is absent.
 *
 * @license GPL-3.0-only
 */

import { cpSync, existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const standalone = join(root, ".next", "standalone");

if (!existsSync(standalone)) {
  console.log("[standalone] .next/standalone not found — skipping (output:standalone not built)");
  process.exit(0);
}

/**
 * Find a nested directory containing server.js (Next standalone output).
 * Walks shallowly under standalone/ so we don't scan node_modules trees.
 */
function findNestedServerDir(dir, depth = 0) {
  if (depth > 6) return null;
  const direct = join(dir, "server.js");
  if (existsSync(direct)) return dir;

  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }

  for (const name of entries) {
    if (name === "node_modules" || name === ".next" || name === "public") continue;
    const child = join(dir, name);
    try {
      if (!statSync(child).isDirectory()) continue;
    } catch {
      continue;
    }
    const found = findNestedServerDir(child, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * If server.js is not at the standalone root, promote the nested project dir
 * so electron/server.ts and afterPack see the conventional layout.
 */
function normalizeStandaloneLayout() {
  const rootServer = join(standalone, "server.js");
  if (existsSync(rootServer)) {
    console.log("[standalone] server.js already at standalone root");
    return;
  }

  const nested = findNestedServerDir(standalone);
  if (!nested || nested === standalone) {
    console.warn("[standalone] WARNING: could not locate server.js under .next/standalone");
    return;
  }

  console.log(`[standalone] flattening nested output: ${nested} -> ${standalone}`);

  const tmp = join(root, ".next", "standalone-flatten-tmp");
  rmSync(tmp, { recursive: true, force: true });
  cpSync(nested, tmp, { recursive: true });
  rmSync(standalone, { recursive: true, force: true });
  cpSync(tmp, standalone, { recursive: true });
  rmSync(tmp, { recursive: true, force: true });

  if (!existsSync(join(standalone, "server.js"))) {
    console.warn("[standalone] WARNING: flatten completed but server.js still missing at root");
  } else {
    console.log("[standalone] flattened successfully (server.js + node_modules at root)");
  }
}

normalizeStandaloneLayout();

// `public/screenshots` holds the README's images. The app never serves them,
// so they stay out of every installer and container image.
const README_ONLY = join(root, "public", "screenshots");

const copies = [
  { src: join(root, ".next", "static"), dst: join(standalone, ".next", "static") },
  { src: join(root, "public"), dst: join(standalone, "public") },
];

for (const { src, dst } of copies) {
  if (!existsSync(src)) {
    console.log(`[standalone] source missing, skipping: ${src}`);
    continue;
  }
  rmSync(dst, { recursive: true, force: true });
  cpSync(src, dst, { recursive: true, filter: (path) => path !== README_ONLY });
  console.log(`[standalone] copied ${src} -> ${dst}`);
}
