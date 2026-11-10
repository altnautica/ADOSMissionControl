/**
 * @license GPL-3.0-only
 *
 * Settings › General › Reset tips clears the tips this device has seen, so
 * the flight screen's tips show again.
 */

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithIntl } from "../../../../tests/helpers/intl-wrapper";
import { GeneralSection } from "../GeneralSection";
import { useCockpitTipsStore } from "@/stores/cockpit-tips-store";

afterEach(() => {
  cleanup();
  useCockpitTipsStore.getState().reset();
});

describe("Reset tips", () => {
  it("calls the tips store reset", () => {
    useCockpitTipsStore.setState({ seen: ["status_pill", "stop"], openCount: 3 });
    renderWithIntl(<GeneralSection />);
    fireEvent.click(screen.getByTestId("reset-tips"));
    expect(useCockpitTipsStore.getState().seen).toEqual([]);
    expect(useCockpitTipsStore.getState().openCount).toBe(0);
  });

  it("is labelled from the spec key", () => {
    renderWithIntl(<GeneralSection />);
    expect(screen.getByTestId("reset-tips").textContent).toContain("Reset tips");
  });
});
