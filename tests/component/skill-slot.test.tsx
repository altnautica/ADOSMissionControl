/**
 * Tests for the Skill Bar slot: ARIA correctness (button role, aria-pressed for
 * toggles, aria-disabled + a referenced reason description), the redundant
 * non-colour cues on each ring state (active latched dot, disabled lock glyph,
 * cooldown sweep shape), the charge badge, and HUD-honesty (the slot is a pure
 * view of the passed state — it never asserts active for a non-active state).
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

import { SkillSlot } from "@/components/cockpit/SkillSlot";
import { specString } from "@/lib/cockpit/spec-strings";
import type { Skill, SkillState } from "@/lib/skills/types";

// Echo the i18n key (with interpolations) so assertions match on the key, not a
// translated string.
import { vi } from "vitest";
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}(${JSON.stringify(values)})` : key,
}));

function skill(over: Partial<Skill> = {}): Skill {
  return {
    id: "land",
    label: "skills.land",
    icon: "ArrowDownToLine",
    category: "flight",
    source: "builtin",
    toggle: false,
    getState: () => ({ kind: "idle" }),
    activate: async () => {},
    ...over,
  };
}

function renderSlot(state: SkillState, over: Partial<Skill> = {}, danger = false) {
  return render(
    <SkillSlot
      index={0}
      skill={skill(over)}
      state={state}
      hotkey="shift+l"
      gamepadButton={null}
      danger={danger}
      onActivate={() => {}}
    />,
  );
}

describe("SkillSlot ARIA + cues", () => {
  afterEach(() => cleanup());

  it("renders a focusable button with aria-disabled false when idle", () => {
    const { container } = renderSlot({ kind: "idle" });
    const btn = container.querySelector("button");
    expect(btn).not.toBeNull();
    expect(btn?.getAttribute("aria-disabled")).toBe("false");
    // A one-shot is not a toggle, so aria-pressed is omitted (not "false").
    expect(btn?.getAttribute("aria-pressed")).toBeNull();
  });

  it("sets aria-pressed for a toggle skill and marks the active state class", () => {
    const { container } = renderSlot(
      { kind: "active" },
      { id: "orbit", toggle: true },
    );
    const btn = container.querySelector("button");
    expect(btn?.getAttribute("aria-pressed")).toBe("true");
    // Active carries the `active` state class (the glass slot's green ring +
    // glow); the accessible name announces "active" for a non-visual cue.
    expect(btn?.className).toContain("active");
  });

  it("marks disabled with aria-disabled and a referenced reason description", () => {
    const { container } = renderSlot({
      kind: "disabled",
      reason: "refusal.no_fc_link",
    });
    const btn = container.querySelector("button");
    expect(btn?.getAttribute("aria-disabled")).toBe("true");
    const descId = btn?.getAttribute("aria-describedby");
    expect(descId).toBeTruthy();
    const desc = descId ? container.querySelector(`#${descId}`) : null;
    // A spec reason key reads as the spec's text.
    expect(desc?.textContent).toContain(specString("refusal.no_fc_link"));
    // Disabled also carries the lock glyph (non-colour cue): an svg is present.
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders the cooldown countdown and the remaining time in the name", () => {
    const { container } = renderSlot(
      { kind: "cooldown", progress: 0.5 },
      { cooldownMs: 4000 },
    );
    const btn = container.querySelector("button");
    // The accessible name carries the remaining seconds (overlay + text agree).
    expect(btn?.getAttribute("aria-label")).toContain(
      "skills.state.cooldownRemaining",
    );
    // The cooldown countdown overlay (the `.cd` element) shows the seconds.
    expect(container.querySelector(".cd")).not.toBeNull();
  });

  it("surfaces the charge count as the badge and in the accessible name", () => {
    const { container } = renderSlot(
      { kind: "idle", badge: "2" },
      { charges: { current: 2, max: 3, rechargeMs: 1000 } },
    );
    const btn = container.querySelector("button");
    expect(btn?.getAttribute("aria-label")).toContain(
      "skills.state.withCharges",
    );
    // The badge digit renders.
    expect(container.textContent).toContain("2");
  });

  it("is HUD-honest: an idle slot never shows the active latched dot", () => {
    const { container } = renderSlot({ kind: "idle" });
    const btn = container.querySelector("button");
    expect(btn?.getAttribute("aria-pressed")).toBeNull();
    // No active dot for an idle slot (the only rounded-full span is the dot).
    expect(container.querySelector("span.rounded-full")).toBeNull();
  });
});
