import { describe, it, expect } from "vitest";

import { DEMO_REGISTRY_ENTRIES } from "@/mock/first-party-registry";
import { parseManifestYaml } from "@/components/plugins/transports/manifest-parse";
import { toInstallSummary } from "@/components/plugins/transports/manifest-summary";
import { deriveTrustSignals } from "@/lib/plugins/trust-signals";

describe("first-party registry demo fixture", () => {
  it("every entry parses into a summary whose id matches the catalog row", () => {
    for (const entry of DEMO_REGISTRY_ENTRIES) {
      const summary = toInstallSummary(
        parseManifestYaml(entry.manifestYaml),
        entry.archiveSha256,
        {
          signatureState: "verified",
          signerId: entry.signerKeyId,
          archiveSha256: entry.archiveSha256,
        },
      );
      expect(summary.pluginId).toBe(entry.row.plugin_id);
      expect(summary.version).toBe(entry.row.latest_version);
      // The demo fixtures stand in for verified first-party archives, so the
      // badge row must resolve first-party from the verified signer.
      expect(
        deriveTrustSignals({
          signatureState: summary.signatureState,
          signerId: summary.signerId,
        }),
      ).toContain("first-party");
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
      { signatureState: "verified", signerId: entry!.signerKeyId },
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
});
