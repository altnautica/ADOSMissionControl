/**
 * @module nodes/node-row-context-focus.test
 * @description A right-click on a fleet row focuses the row before the context
 * menu opens, so the menu's close returns focus to the row instead of the body.
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import messages from "../../../../../locales/en.json";
import { NodeRow } from "../NodeRow";
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

describe("NodeRow context menu opener", () => {
  it("focuses the row on right-click before opening the menu", () => {
    let focusedAtOpen: Element | null = null;
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <NodeRow
          node={entry}
          selected={false}
          onSelect={() => {}}
          onContext={() => {
            focusedAtOpen = document.activeElement;
          }}
        />
      </NextIntlClientProvider>,
    );
    const row = screen.getByRole("option");
    expect(document.activeElement).toBe(document.body);
    fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    expect(focusedAtOpen).toBe(row);
  });
});
