/**
 * The confirm holds come from the shared cockpit spec `layout.json`
 * (`holds_ms`), so every surface holds take control, hand to the flight
 * controller, the VTOL transition, Fly Here and the emergency stop for the
 * same time. The values are pinned here as literals, so a spec copy that
 * drifts from the agreed holds fails instead of being copied along.
 *
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";
import { CONFIRM_HOLD_DEFAULT_MS, SPEC_HOLD_MS, confirmHoldMs } from "@/lib/skills";

describe("confirm holds", () => {
  it("hold for the spec's agreed times", () => {
    expect(SPEC_HOLD_MS).toEqual({
      take_control: 1500,
      hand_to_fc: 1500,
      vtol_transition: 1500,
      fly_here: 800,
      stop: 3000,
    });
  });

  it("hold the guarded (emergency stop) tier for 3 s", () => {
    expect(CONFIRM_HOLD_DEFAULT_MS.guarded).toBe(3000);
    expect(
      confirmHoldMs({ title: "t", message: "m", confirmLabel: "c", variant: "danger", gesture: "guarded" }),
    ).toBe(3000);
  });
});
