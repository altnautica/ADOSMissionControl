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

  // Both unacknowledged states keep a key the FC may hold, so neither may read
  // as "Signed" (the FC may still have the other key) nor "Unsigned" (the FC
  // may still reject unsigned commands).
  it.each(["unconfirmed", "disable_unconfirmed"])(
    "returns unconfirmed for a %s key",
    (enrollmentState) => {
      const r = classifyVariant(
        input({ capability: { supported: true }, hasBrowserKey: true, enrollmentState }),
      );
      expect(r).toBe("unconfirmed");
    },
  );

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
      "unconfirmed",
      "unsigned",
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
