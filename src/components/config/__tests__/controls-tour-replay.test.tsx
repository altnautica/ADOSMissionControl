/**
 * @license GPL-3.0-only
 *
 * Settings › Controls carries a "Replay controller tour" row that shows the
 * flight-screen tour again, and no tour card of its own.
 */

import { readFileSync } from "node:fs";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithIntl } from "../../../../tests/helpers/intl-wrapper";
import { ReplayTourRow, TestRow } from "../ControlsSettingsCards";
import { useControlsStore } from "@/stores/controls-store";

afterEach(() => {
  cleanup();
  useControlsStore.setState({ tourSeen: false });
});

describe("Replay controller tour row", () => {
  it("calls replayTour", () => {
    useControlsStore.setState({ tourSeen: true });
    renderWithIntl(<ReplayTourRow />);
    fireEvent.click(screen.getByRole("button", { name: "Replay controller tour" }));
    expect(useControlsStore.getState().tourSeen).toBe(false);
  });

  it("has a 48 px hit area", () => {
    renderWithIntl(<ReplayTourRow />);
    expect(screen.getByTestId("controls-tour-replay").className).toContain("min-h-12");
  });

  it("is mounted in Settings › Controls, which no longer draws a tour card", () => {
    const src = readFileSync("src/components/config/ControlsSettings.tsx", "utf8");
    expect(src).toContain("<ReplayTourRow />");
    expect(src).not.toMatch(/<Tour\b/);
  });
});

describe("test row", () => {
  it("reads the sticks hint from the spec key", () => {
    renderWithIntl(<TestRow />);
    expect(screen.getByTestId("controls-test-row").textContent).toContain("Test sticks: move the sticks; the dots follow.");
  });
});
