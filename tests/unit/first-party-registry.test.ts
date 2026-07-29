import { describe, it, expect } from "vitest";

import { DEMO_REGISTRY_ENTRIES } from "@/lib/plugins/first-party-registry";
import {
  parseManifestYaml,
  toInstallSummary,
} from "@/components/plugins/transports/manifest-parse";
import { deriveTrustSignals } from "@/lib/plugins/trust-signals";

describe("first-party registry demo fixture", () => {
  it("every entry parses into a summary whose id matches the catalog row", () => {
    for (const entry of DEMO_REGISTRY_ENTRIES) {
      const summary = toInstallSummary(
        parseManifestYaml(entry.manifestYaml),
        entry.archiveSha256,
        { signerId: entry.signerKeyId, archiveSha256: entry.archiveSha256 },
      );
      expect(summary.pluginId).toBe(entry.row.plugin_id);
      expect(summary.version).toBe(entry.row.latest_version);
      // First-party signer → the badge row shows first-party.
      expect(deriveTrustSignals({ signerId: summary.signerId })).toContain(
        "first-party",
      );
    }
  });

  it("the optical-pod entry exercises every pop-up section", () => {
    const entry = DEMO_REGISTRY_ENTRIES.find(
      (e) => e.row.plugin_id === "com.altnautica.siyi-pod",
    );
    expect(entry).toBeTruthy();
    const summary = toInstallSummary(
      parseManifestYaml(entry!.manifestYaml),
      entry!.archiveSha256,
      { signerId: entry!.signerKeyId },
    );
    expect(summary.halves).toEqual(["agent", "gcs"]);
    expect(summary.icon).toBe("camera");
    expect((summary.contributesSkills ?? []).length).toBe(2);
    expect((summary.contributesTools ?? []).length).toBe(5);
    expect((summary.contributesTabs ?? []).length).toBeGreaterThan(0);
    expect((summary.contributesSlots ?? []).length).toBeGreaterThan(0);
    expect((summary.contributesParameters ?? []).length).toBeGreaterThan(0);
    expect((summary.contributesTargetActions ?? []).length).toBe(1);
    expect((summary.screenshots ?? []).length).toBe(2);
    expect(summary.features && summary.features.length).toBeGreaterThan(0);
    // An agent-half tool carries its half stamp.
    expect(
      (summary.contributesTools ?? []).some((tool) => tool.half === "agent"),
    ).toBe(true);
  });

  it("the battery panel is a GCS-only plugin", () => {
    const entry = DEMO_REGISTRY_ENTRIES.find(
      (e) => e.row.plugin_id === "com.altnautica.battery-health-panel",
    );
    const summary = toInstallSummary(
      parseManifestYaml(entry!.manifestYaml),
      entry!.archiveSha256,
      { signerId: entry!.signerKeyId },
    );
    expect(summary.halves).toEqual(["gcs"]);
  });
});
