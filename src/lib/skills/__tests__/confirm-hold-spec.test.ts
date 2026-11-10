/**
 * The confirm holds come from the shared cockpit spec `layout.json`
 * (`holds_ms`), so every surface holds take control, hand to the flight
 * controller, the VTOL transition, Fly Here and the emergency stop for the
 * same time.
 *
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";
import layout from "@/lib/cockpit-spec/layout.json";
import { CONFIRM_HOLD_DEFAULT_MS, SPEC_HOLD_MS, confirmHoldMs } from "@/lib/skills";

describe("confirm holds", () => {
  it("equal layout.json's holds_ms", () => {
    expect(SPEC_HOLD_MS).toEqual(layout.holds_ms);
  });

  it("hold the guarded (emergency stop) tier for the spec's stop", () => {
    expect(CONFIRM_HOLD_DEFAULT_MS.guarded).toBe(layout.holds_ms.stop);
    expect(
      confirmHoldMs({ title: "t", message: "m", confirmLabel: "c", variant: "danger", gesture: "guarded" }),
    ).toBe(layout.holds_ms.stop);
  });
});
