/**
 * @module follow-dock.test
 * @description The follow strip on a portrait phone: the rail fits beside the
 * range readout, so REC and the readout stay on the row and the readout still
 * opens its sheet; the quick settings open from More as a sheet. While the
 * waiting prompt shows, the critical alert stack starts below it.
 * @license GPL-3.0-only
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";

vi.mock("@/lib/skills/plugin-config-writer", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  writePluginConfigValue: vi.fn(async () => true),
}));

import messages from "../../../../../locales/en.json";
import { FollowDock } from "@/components/cockpit/flight/FollowDock";
import { CockpitAlerts } from "@/components/cockpit/CockpitAlerts";
import { FlightGridContext } from "@/components/cockpit/flight/flight-context";
import { flightGrid } from "@/components/cockpit/flight/flight-grid";
import { useFollowPromptEdge } from "@/components/cockpit/flight/follow-prompt-edge";
import { useFlightSheetStore } from "@/components/cockpit/flight/flight-sheet";
import { FOLLOW_SKILL_ID } from "@/hooks/use-following-mode";
import { useSkillRegistry } from "@/lib/skills";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { useVideoStreamsStore } from "@/stores/video-streams-store";
import { followState } from "../../__tests__/follow-fixtures";

const DRONE = "node:dock-test";
const portrait = flightGrid({ width: 390, height: 844, widthClass: "compact", following: true });

function renderDock() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <FlightGridContext.Provider value={portrait}>
        <FollowDock droneId={DRONE} />
        <CockpitAlerts droneId={DRONE} />
      </FlightGridContext.Provider>
    </NextIntlClientProvider>,
  );
}

describe("FollowDock in portrait", () => {
  let skills: unknown;
  beforeEach(() => {
    skills = useSkillRegistry.getState().skills;
    useSkillRegistry.setState({ skills: new Map([[FOLLOW_SKILL_ID, { id: FOLLOW_SKILL_ID }]]) } as never);
    useNavStreamStore.getState().clear(DRONE);
    useVideoStreamsStore.getState().clear();
    useVideoStreamsStore.getState().setStreams(DRONE, [
      { id: "eo", index: 1, label: "eo", role: "eo", kind: "concurrent" },
      { id: "belly", index: 2, label: "belly", role: "down", kind: "concurrent" },
    ]);
    useFlightSheetStore.setState({ open: null });
    useFollowPromptEdge.setState({ bottomPx: null });
  });
  afterEach(() => {
    cleanup();
    useSkillRegistry.setState({ skills } as never);
  });

  it("keeps REC and the range readout on the row, and the readout opens its sheet", () => {
    expect(portrait.zones.right_column).toBeFalsy();
    useNavStreamStore.getState().setFollow(DRONE, followState());
    renderDock();
    expect(screen.getByTestId("frail-rec")).toBeTruthy();
    expect(screen.getByTestId("frail-camswap")).toBeTruthy();
    expect(screen.queryByTestId("follow-setting-reacquire_mode")).toBeNull();
    const range = document.querySelector<HTMLButtonElement>("[data-follow-range-trigger]");
    expect(range).toBeTruthy();
    fireEvent.click(range!);
    expect(screen.getByTestId("follow-range-sheet")).toBeTruthy();
  });

  it("opens the quick settings from More as a sheet, and More closes it", () => {
    useNavStreamStore.getState().setFollow(DRONE, followState());
    renderDock();
    const more = screen.getByTestId("frail-more");
    fireEvent.click(more);
    const sheet = screen.getByTestId("follow-settings-sheet");
    expect(more.getAttribute("aria-expanded")).toBe("true");
    for (const s of ["reacquire_mode", "uncertain_mode", "predictive_search"]) {
      expect(sheet.querySelector(`[data-testid="follow-setting-${s}"]`)).toBeTruthy();
    }
    fireEvent.pointerDown(more);
    fireEvent.click(more);
    expect(screen.queryByTestId("follow-settings-sheet")).toBeNull();
  });

  it("starts the alert stack below the waiting prompt while it shows", async () => {
    const height = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(240);
    try {
      useNavStreamStore.getState().setFollow(DRONE, followState({ phase: "holding-await-operator", holdReason: "camera-lost" }));
      renderDock();
      expect(screen.getByTestId("follow-await-prompt")).toBeTruthy();
      const strip = portrait.zones.follow_strip!;
      const bottom = strip.y + strip.h + 8 + 240;
      expect(useFollowPromptEdge.getState().bottomPx).toBe(bottom);
      expect(screen.getByTestId("cockpit-alerts").style.top).toBe(`${Math.max(portrait.zones.center!.y, bottom + 6)}px`);
      expect(bottom + 6).toBeGreaterThan(portrait.zones.center!.y);
      await act(async () => {
        useNavStreamStore.getState().setFollow(DRONE, followState());
      });
      expect(useFollowPromptEdge.getState().bottomPx).toBeNull();
      expect(screen.getByTestId("cockpit-alerts").style.top).toBe("var(--fs-top-y, 60px)");
    } finally {
      height.mockRestore();
    }
  });
});
