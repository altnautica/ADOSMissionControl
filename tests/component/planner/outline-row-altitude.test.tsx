/**
 * @license GPL-3.0-only
 *
 * Outline row altitude text: a terrain-frame row does not repeat its height as
 * an AGL chip, an RTL row shows no item altitude or clearance, and the command
 * name carries a title so a truncated name can be read.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../locales/en.json";
import { OutlineWaypointRow } from "@/components/planner/outline/OutlineWaypointRow";
import type { Waypoint } from "@/lib/types/mission";

const noop = () => {};

function row(waypoint: Waypoint) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <OutlineWaypointRow
        waypoint={waypoint}
        index={0}
        selected={false}
        multiSelected={false}
        isInav={false}
        defaultFrame="relative"
        homeGroundElevation={100}
        onClick={noop}
        onRemove={noop}
        onDragStart={noop}
        onDragOver={noop}
        onDragEnd={noop}
        onDrop={noop}
        dragOver={false}
        registerRow={noop}
      />
    </NextIntlClientProvider>,
  );
}

describe("OutlineWaypointRow altitude", () => {
  it("does not repeat a terrain-frame height as an AGL chip", () => {
    row({ id: "a", lat: 0, lon: 0, alt: 30, frame: "terrain", groundElevation: 100, command: "TAKEOFF" });
    expect(screen.queryByText(/AGL/)).toBeNull();
    expect(screen.getByText("30m")).toBeInTheDocument();
    expect(screen.getByTitle("Takeoff")).toBeInTheDocument();
  });

  it("keeps the AGL chip for a relative-frame row", () => {
    row({ id: "a", lat: 0, lon: 0, alt: 30, frame: "relative", groundElevation: 90, command: "WAYPOINT" });
    expect(screen.getByText("40m AGL")).toBeInTheDocument();
  });

  it("shows no item altitude or clearance on an RTL row", () => {
    row({ id: "a", lat: 0, lon: 0, alt: 0, frame: "relative", groundElevation: 108, command: "RTL" });
    expect(screen.queryByText(/AGL/)).toBeNull();
    expect(screen.queryByText("0m")).toBeNull();
    expect(screen.getByTitle(messages.planner.outline.rtlAltitude)).toHaveTextContent("—");
  });
});
