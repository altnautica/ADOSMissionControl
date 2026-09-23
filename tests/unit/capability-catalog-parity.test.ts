/**
 * @module CapabilityCatalogParityTest
 * @description Parity test that the GCS-side capability catalog mirrors
 * every permission id surfaced by the bundled vision-nav manifest.
 *
 * Reads the real manifest at `ADOSExtensions/extensions/vision-nav/
 * manifest.yaml`, runs it through the client-side parser, then asserts
 * every emitted permission resolves to a known catalog entry with a
 * non-empty label and description. When the agent grows a new
 * capability id, the YAML manifest references it, the parity test
 * fails until the GCS mirror at `src/lib/plugins/agent-capabilities.ts`
 * is refreshed.
 *
 * @license GPL-3.0-only
 */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseManifestYaml } from "@/components/plugins/transports/manifest-parse";
import { getMergedCapabilityMeta } from "@/lib/plugins/capabilities";

// `ADOSMissionControl/` is a sibling of `ADOSExtensions/` inside the
// private monorepo. Resolve from the GCS package root.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const VISION_NAV_MANIFEST = path.join(
  REPO_ROOT,
  "ADOSExtensions",
  "extensions",
  "vision-nav",
  "manifest.yaml",
);

describe("capability catalog parity (vision-nav)", () => {
  // The parity test is meaningful only when the sibling submodule is
  // checked out alongside the GCS repo. Skip gracefully when the file
  // is missing so a standalone GCS clone (OSS contributor) does not
  // see a spurious failure.
  const hasFixture = fs.existsSync(VISION_NAV_MANIFEST);

  const maybeIt = hasFixture ? it : it.skip;

  maybeIt("every parsed permission resolves to a known catalog entry", () => {
    const yaml = fs.readFileSync(VISION_NAV_MANIFEST, "utf-8");
    const parsed = parseManifestYaml(yaml);

    expect(parsed.permissions.length).toBeGreaterThan(0);

    const unknown: string[] = [];
    const emptyLabels: string[] = [];
    const emptyDescriptions: string[] = [];

    for (const perm of parsed.permissions) {
      const meta = getMergedCapabilityMeta(perm.id, perm.half);
      if ((meta as { unknown?: boolean }).unknown === true) {
        unknown.push(perm.id);
        continue;
      }
      if (!meta.label || meta.label.length === 0) {
        emptyLabels.push(perm.id);
      }
      if (!meta.description || meta.description.length === 0) {
        emptyDescriptions.push(perm.id);
      }
    }

    expect(
      unknown,
      `agent catalog mirror missing ids: ${unknown.join(", ")}`,
    ).toEqual([]);
    expect(
      emptyLabels,
      `catalog ids with empty labels: ${emptyLabels.join(", ")}`,
    ).toEqual([]);
    expect(
      emptyDescriptions,
      `catalog ids with empty descriptions: ${emptyDescriptions.join(", ")}`,
    ).toEqual([]);
  });
});
