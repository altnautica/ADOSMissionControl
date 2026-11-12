/**
 * @module dashboard/drone-list-panel.test
 * @description The fleet sidebar's chrome: translated Fleet overview and
 * count, 36 px labelled header buttons, and the outlined search field.
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

vi.mock("@/hooks/use-fleet-nodes", () => ({
  useFleetNodes: () => [],
}));
vi.mock("@/hooks/use-forget-node", () => ({
  useForgetNode: () => async () => {},
}));
vi.mock("../ReconnectingDrones", () => ({ ReconnectingDrones: () => null }));

import messages from "../../../../locales/en.json";
import { DroneListPanel } from "../DroneListPanel";

afterEach(cleanup);

function renderPanel() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DroneListPanel collapsed={false} onToggleCollapse={() => {}} />
    </NextIntlClientProvider>,
  );
}

describe("DroneListPanel", () => {
  it("labels the overview button and the count from the locale", () => {
    renderPanel();
    expect(screen.getByText(messages.fleet.overview)).toBeTruthy();
    expect(screen.getByText("0 drones")).toBeTruthy();
  });

  it("gives the header buttons a 36 px target and an accessible name", () => {
    renderPanel();
    for (const name of [messages.fleet.addDrone, messages.fleet.collapsePanel]) {
      const button = screen.getByRole("button", { name });
      expect(button.className).toContain("h-9");
      expect(button.className).toContain("w-9");
    }
  });

  it("draws the search as an outlined 32 px field", () => {
    renderPanel();
    const field = screen.getByRole("textbox", { name: messages.fleet.searchDrones }).parentElement!;
    expect(field.className).toContain("h-8");
    expect(field.className).toContain("focus-within:border-accent-primary");
  });
});
