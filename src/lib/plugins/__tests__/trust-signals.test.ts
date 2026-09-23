/**
 * @license GPL-3.0-only
 *
 * The install pop-up must refuse to turn a manifest's own `signer_id` into
 * trust.
 *
 * `toInstallSummary` (file drop, registry preview) receives a `signer_id` that
 * came out of the archive the operator supplied. It may not carry it onto the
 * summary or badge it unless the archive's signature actually verified, which
 * needs the GCS to hold the bytes.
 */

import { describe, it, expect } from "vitest";

import { toInstallSummary } from "@/components/plugins/transports/manifest-summary";
import type { ParsedManifest } from "@/components/plugins/transports/manifest-types";

/** A manifest that declares the first-party signer id inside the archive. */
const parsed = {
  pluginId: "com.example.cam",
  version: "1.0.0",
  name: "Example Cam",
  risk: "medium",
  halves: ["gcs"],
  signerId: "altnautica-2026-A",
  license: "GPL-3.0-or-later",
  permissions: [],
} as unknown as ParsedManifest;

describe("toInstallSummary · the manifest's signer claim is not trust", () => {
  it("drops the declared signer and badges nothing when nothing was verified", () => {
    const summary = toInstallSummary(parsed, "hash", {
      signatureState: "unverified",
    });
    expect(summary.signerId).toBeUndefined();
    expect(summary.trustSignals).not.toContain("signed");
    expect(summary.trustSignals).not.toContain("first-party");
    // The license signal does not depend on the signature.
    expect(summary.trustSignals).toEqual(["open-source"]);
  });

  it("drops the declared signer when verification actively failed", () => {
    const summary = toInstallSummary(parsed, "hash", {
      signatureState: "invalid",
      signerId: "altnautica-2026-A",
    });
    expect(summary.signerId).toBeUndefined();
    expect(summary.trustSignals).toEqual(["open-source"]);
  });

  it("carries the signer and the badges once the archive verified", () => {
    const summary = toInstallSummary(parsed, "hash", {
      signatureState: "verified",
      signerId: "altnautica-2026-A",
    });
    expect(summary.signerId).toBe("altnautica-2026-A");
    expect(summary.trustSignals).toEqual([
      "signed",
      "first-party",
      "open-source",
    ]);
  });

  it("records the state it was given so a consumer can tell the cases apart", () => {
    for (const signatureState of [
      "verified",
      "unsigned",
      "invalid",
      "unverified",
    ] as const) {
      const summary = toInstallSummary(parsed, "hash", { signatureState });
      expect(summary.signatureState).toBe(signatureState);
    }
  });
});
