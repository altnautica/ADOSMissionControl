import { describe, it, expect } from "vitest";

import {
  classifyVariant,
  VARIANTS,
  type BadgeClassifyInput,
  type SigningBadgeVariant,
} from "@/components/command/SigningStatusBadge";

function input(partial: Partial<BadgeClassifyInput>): BadgeClassifyInput {
  return {
    capability: null,
    hasBrowserKey: false,
    ...partial,
  };
}

describe("classifyVariant", () => {
  it("returns loading when state is missing", () => {
    expect(classifyVariant(undefined)).toBe("loading");
  });

  it("returns loading when capability is null", () => {
    expect(classifyVariant(input({ capability: null }))).toBe("loading");
  });

  it("returns na when firmware does not support signing", () => {
    expect(
      classifyVariant(input({ capability: { supported: false } })),
    ).toBe("na");
  });

  it("returns key_missing when the enrollment state says so", () => {
    const r = classifyVariant(
      input({
        capability: { supported: true },
        hasBrowserKey: false,
        enrollmentState: "key_missing",
      }),
    );
    expect(r).toBe("key_missing");
  });

  // There is no "mismatch" variant, and this pins that. The old one was
  // gated on a counter nothing incremented, so the branch was unreachable in
  // production while this very test passed by injecting the counter by hand.
  // A signing-mismatch badge may only come back with a real detector behind
  // it, at which point this assertion is the thing that has to change.
  it("classifies an enrolled key as signed, with no mismatch state to reach", () => {
    const enrolled = input({
      capability: { supported: true },
      hasBrowserKey: true,
      enrollmentState: "enrolled",
    });
    expect(classifyVariant(enrolled)).toBe("signed");
    expect(Object.keys(VARIANTS)).not.toContain("mismatch");
  });

  it("returns signed when enrolled and require is off", () => {
    const r = classifyVariant(
      input({
        capability: { supported: true },
        hasBrowserKey: true,
        enrollmentState: "enrolled",
        requireOnFc: false,
      }),
    );
    expect(r).toBe("signed");
  });

  it("returns signed_required when enrolled and require is on", () => {
    const r = classifyVariant(
      input({
        capability: { supported: true },
        hasBrowserKey: true,
        enrollmentState: "enrolled",
        requireOnFc: true,
      }),
    );
    expect(r).toBe("signed_required");
  });

  it("returns unsigned when supported but no browser key", () => {
    const r = classifyVariant(
      input({ capability: { supported: true }, hasBrowserKey: false }),
    );
    expect(r).toBe("unsigned");
  });
});

describe("VARIANTS", () => {
  it("has every variant present, and no more", () => {
    const expected: SigningBadgeVariant[] = [
      "signed",
      "signed_required",
      "unsigned",
      "key_missing",
      "na",
      "loading",
    ];
    for (const k of expected) {
      expect(VARIANTS[k]).toBeDefined();
    }
    // A variant with no classifier branch is a state the operator can never
    // be shown, which is how the mismatch pill went unnoticed.
    expect(Object.keys(VARIANTS).sort()).toEqual([...expected].sort());
  });

  it("every variant ships an aria-label distinct from its sibling variants", () => {
    const labels = Object.values(VARIANTS).map((v) => v.ariaLabel);
    const unique = new Set(labels);
    expect(unique.size).toBe(labels.length);
  });

  it("every variant has non-empty tooltip, label, and className", () => {
    for (const [name, v] of Object.entries(VARIANTS)) {
      expect(v.label, `${name}.label`).toBeTruthy();
      expect(v.tooltip, `${name}.tooltip`).toBeTruthy();
      expect(v.className, `${name}.className`).toBeTruthy();
      expect(v.ariaLabel, `${name}.ariaLabel`).toBeTruthy();
    }
  });
});
