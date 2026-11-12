/**
 * @module swarm-view/swarm-map-stacking.test
 * @description The Positions map sits beside the slot table only from 1500 px;
 * narrower windows stack it under the table so the table keeps its state
 * columns and the page does not scroll sideways.
 * @license GPL-3.0-only
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import messages from "../../../../../locales/en.json";

vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("../use-swarm-slot-rows", () => ({ useSwarmSlotRows: () => [] }));

import { SwarmFleetMap } from "../SwarmFleetMap";

describe("swarm board layout", () => {
  it("sizes the map beside the table only from 1500 px", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <SwarmFleetMap rows={[]} nodesBySlot={new Map()} selected={new Set()} onSelectSlots={() => {}} />
      </NextIntlClientProvider>,
    );
    const cls = screen.getByTestId("swarm-fleet-map").className;
    expect(cls).toContain("min-[1500px]:w-[420px]");
    expect(cls).not.toContain("xl:w-[420px]");
  });

  it("puts the table and map in a row only from 1500 px", () => {
    const src = readFileSync(join(__dirname, "../SwarmView.tsx"), "utf8");
    expect(src).toContain("min-[1500px]:flex-row");
    expect(src).not.toContain("xl:flex-row");
  });
});
