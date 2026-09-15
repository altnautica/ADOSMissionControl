import { describe, it, expect } from "vitest";
import {
  deriveTrustSignals,
  displayTrustSignals,
} from "@/lib/plugins/trust-signals";

// Signature gating lives in src/lib/plugins/__tests__/archive-signature.test.ts,
// alongside the verifier it gates on. This file covers the two signals that are
// independent of the signature — license and vendor attribution — and the order
// the composed set comes out in.

describe("deriveTrustSignals · license", () => {
  it("adds open-source for an open license", () => {
    for (const license of [
      "GPL-3.0-or-later",
      "GPL-3.0-only",
      "MIT",
      "Apache-2.0",
      "BSD-3-Clause",
      "CC0-1.0",
    ]) {
      expect(
        deriveTrustSignals({ signatureState: "unsigned", license }),
      ).toContain("open-source");
    }
  });

  it("does not add open-source for a proprietary or absent license", () => {
    expect(
      deriveTrustSignals({ signatureState: "unsigned", license: "Proprietary" }),
    ).not.toContain("open-source");
    expect(
      deriveTrustSignals({ signatureState: "unsigned", license: undefined }),
    ).not.toContain("open-source");
  });
});

describe("deriveTrustSignals · vendor attribution", () => {
  it("adds vendor-binary when a closed vendor attribution is declared", () => {
    expect(
      deriveTrustSignals({
        signatureState: "unsigned",
        vendorAttribution: [{ name: "rknn_toolkit" }],
      }),
    ).toContain("vendor-binary");
  });

  it("adds nothing for an empty attribution list", () => {
    expect(
      deriveTrustSignals({ signatureState: "unsigned", vendorAttribution: [] }),
    ).not.toContain("vendor-binary");
  });
});

describe("deriveTrustSignals · composition", () => {
  it("emits every applicable signal in a stable order", () => {
    expect(
      deriveTrustSignals({
        signatureState: "verified",
        signerId: "altnautica-2026-A",
        license: "GPL-3.0-or-later",
        vendorAttribution: [{ name: "tensorrt" }],
      }),
    ).toEqual([
      "signed",
      "verified-publisher",
      "first-party",
      "open-source",
      "vendor-binary",
    ]);
  });

  it("displayTrustSignals drops only verified-publisher from that set", () => {
    expect(
      displayTrustSignals({
        signatureState: "verified",
        signerId: "altnautica-2026-A",
        license: "GPL-3.0-or-later",
        vendorAttribution: [{ name: "tensorrt" }],
      }),
    ).toEqual(["signed", "first-party", "open-source", "vendor-binary"]);
  });
});
