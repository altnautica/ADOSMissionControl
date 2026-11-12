/**
 * @module nodes/node-rail-context-focus.test
 * @description A right-click on a collapsed rail tile focuses the tile before the context
 * menu opens, so the menu's close returns focus to the tile instead of the body.
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import messages from "../../../../../locales/en.json";
import { NodeRail } from "../NodeRail";
import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";

const entry: FleetNodeEntry = {
  _id: "node:n1",
  userId: "u",
  deviceId: "n1",
  name: "Alpha",
  apiKey: "",
  pairedAt: Date.now(),
  lastSeen: Date.now(),
  profile: "ground-station",
  isLocal: false,
};

afterEach(cleanup);

describe("NodeRail context menu opener", () => {
  it("focuses the tile on right-click before opening the menu", () => {
    let focusedAtOpen: Element | null = null;
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <NodeRail
          node={entry}
          selected={false}
          onSelect={() => {}}
          onContext={() => {
            focusedAtOpen = document.activeElement;
          }}
        />
      </NextIntlClientProvider>,
    );
    const tile = screen.getByRole("option");
    expect(document.activeElement).toBe(document.body);
    fireEvent.contextMenu(tile, { clientX: 10, clientY: 10 });
    expect(focusedAtOpen).toBe(tile);
  });
});
