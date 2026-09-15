/**
 * @license GPL-3.0-only
 *
 * The install-from-URL / already-installed path maps the agent's parse summary
 * onto the same rich install-pop-up shape as a dropped file: permissions run
 * through the merged capability catalog, the archive SHA + icon carry through,
 * and the trust set is the shared display derivation.
 */

import { describe, it, expect } from "vitest";

import { agentSummaryToManifest } from "../agent-summary-to-manifest";
import type { PluginAgentParseSummary } from "@/lib/agent/plugin-client";

function summary(
  over: Partial<PluginAgentParseSummary> = {},
): PluginAgentParseSummary {
  return {
    ok: true,
    plugin_id: "com.example.pod",
    version: "1.2.0",
    name: "Example Pod",
    description: "A camera pod driver.",
    author: "Example OEM",
    license: "GPL-3.0-or-later",
    risk: "high",
    signer_id: "altnautica-2026-A",
    signed: true,
    halves: ["agent", "gcs"],
    permissions: [
      { id: "mavlink.write", required: true },
      { id: "some.unknown.cap", required: false },
    ],
    archive_sha256: "abc123",
    icon: "camera",
    ...over,
  };
}

describe("agentSummaryToManifest", () => {
  it("resolves known permission ids through the merged catalog", () => {
    const m = agentSummaryToManifest(summary());
    const mav = m.permissions.find((p) => p.id === "mavlink.write");
    expect(mav?.label).toBeTruthy();
    expect(mav?.label).not.toBe("mavlink.write");
    expect(mav?.category).toBeTruthy();
    expect(mav?.unknown).toBeUndefined();
  });

  it("flags an unknown permission id instead of guessing a label", () => {
    const m = agentSummaryToManifest(summary());
    const unk = m.permissions.find((p) => p.id === "some.unknown.cap");
    expect(unk?.unknown).toBe(true);
    expect(unk?.label).toBeUndefined();
  });

  it("carries the archive SHA and the header icon", () => {
    const m = agentSummaryToManifest(summary());
    expect(m.archiveSha256).toBe("abc123");
    expect(m.icon).toBe("camera");
  });
});
