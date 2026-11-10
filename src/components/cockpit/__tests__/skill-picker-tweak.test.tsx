/**
 * @license GPL-3.0-only
 *
 * The skill picker's Tweak panel names each parameter by its manifest label
 * (the raw key only when the manifest has none), its words come from the
 * shared spec strings, and the skill colour comes from the spec tokens.
 */

import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";

const mocks = vi.hoisted(() => ({
  params: [] as unknown[],
}));

// vi.mock factories are hoisted above the static imports, so the store
// factory loads zustand itself.
vi.mock("@/lib/skills", async () => {
  const { create } = await import("zustand");
  return {
    activate: vi.fn(async () => {}),
    deactivate: vi.fn(async () => {}),
    buildSkillContext: (droneId: string) => ({ droneId }),
    useSkillRegistry: create(() => ({
      skills: new Map<string, unknown>(),
      states: new Map<string, Map<string, { kind: string }>>(),
      getState: () => ({ kind: "idle" }),
    })),
  };
});
vi.mock("@/lib/skills/plugin-config-writer", () => ({ writePluginConfigValue: vi.fn(async () => true) }));
vi.mock("@/hooks/use-drone-plugin-contributions", () => ({
  useDronePluginParameters: () => mocks.params,
}));

import messages from "../../../../locales/en.json";
import tokens from "@/lib/cockpit-spec/tokens.json";
import { useSkillRegistry } from "@/lib/skills";
import { SKILL_COLOR, SkillPicker, paramLabel } from "@/components/cockpit/v2/SkillPicker";
import { closeFlightSheets } from "@/components/cockpit/flight/flight-sheet";

const DRONE = "drone-1";
const SKILL = {
  id: "com.example.follow:follow",
  label: "Follow",
  icon: "Crosshair",
  category: "behavior",
  source: "plugin",
  pluginId: "com.example.follow",
  pickerCategory: "behavior",
  motion: true,
  params: ["follow_distance_m", "orbit_rate_dps"],
  toggle: true,
};

function setSkill(kind: "idle" | "active") {
  useSkillRegistry.setState({
    skills: new Map([[SKILL.id, SKILL]]),
    states: new Map([[DRONE, new Map([[SKILL.id, { kind }]])]]),
  } as never);
}

function renderPicker() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SkillPicker droneId={DRONE} pilot={null} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  mocks.params = [
    {
      installId: "i1",
      pluginId: "com.example.follow",
      title: "Follow",
      parameters: [{ key: "follow_distance_m", schema: { type: "number" }, ui: { label: "Follow distance" } }],
    },
  ];
});

afterEach(() => {
  cleanup();
  closeFlightSheets();
});

describe("skill picker Tweak panel", () => {
  it("shows the manifest label, and the raw key only when there is none", () => {
    setSkill("idle");
    renderPicker();
    fireEvent.click(screen.getByTestId("skill-picker-chip"));
    fireEvent.click(screen.getByTestId(`skill-entry-${SKILL.id}`));
    const panel = screen.getByTestId("tweak-panel");
    expect(panel.textContent).toContain("Follow distance");
    expect(panel.textContent).not.toContain("follow_distance_m");
    expect(panel.textContent).toContain("orbit_rate_dps");
    expect(panel.textContent).toContain("Tweak");
    expect(screen.getByRole("button", { name: "GO" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
  });

  it("falls back to the key with no manifest entry", () => {
    expect(paramLabel(undefined, "orbit_rate_dps")).toBe("orbit_rate_dps");
    expect(paramLabel([{ key: "a", ui: { label: "" } }], "a")).toBe("a");
    expect(paramLabel([{ key: "a", ui: { label: "Alpha" } }], "a")).toBe("Alpha");
  });

  it("uses the spec tab labels and the empty-tab text", () => {
    setSkill("idle");
    renderPicker();
    fireEvent.click(screen.getByTestId("skill-picker-chip"));
    for (const name of ["Behaviors", "Camera", "Navigation", "Utility"]) {
      expect(screen.getByRole("tab", { name })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("tab", { name: "Camera" }));
    expect(screen.getByTestId("skill-picker-empty").textContent).toBe("No skills in this tab.");
  });
});

describe("skill picker colours", () => {
  it("takes the skill colour from tokens.json state.skill", () => {
    expect(SKILL_COLOR).toBe(tokens.state.skill);
    setSkill("active");
    renderPicker();
    const chip = screen.getByTestId("skill-picker-chip");
    expect(chip.getAttribute("style") ?? "").toMatch(/inset 0 0 0 2px/);
    fireEvent.click(chip);
    expect(screen.getByText("ACTIVE")).toBeTruthy();
  });

  it("has no hex colour literal in the source", () => {
    const src = readFileSync("src/components/cockpit/v2/SkillPicker.tsx", "utf8");
    expect(src).not.toMatch(/#[0-9A-Fa-f]{6}\b/);
  });
});
