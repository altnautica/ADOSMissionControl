/**
 * @license GPL-3.0-only
 *
 * The flight-flow overlays stack in one top-centre column under the follow
 * strip (`flowColumn`), never at the screen centre: the centre-sticks ring
 * and the countdowns sit inside that column. The no-video placeholder starts
 * below the centre marks, so the horizon never strikes its text.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { FlightFlowOverlays } from "@/components/cockpit/v2/FlightFlowOverlays";
import { parsePilotState } from "@/lib/hud/cockpit-frames";
import { demoPilotWire } from "@/mock/mock-pilot";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { FlightGridContext } from "../flight-context";
import { FlightVideoFrame, placeholderTop } from "../FlightFrame";
import { PLACEHOLDER_DROP_PX, flightGrid, flowColumn, videoRect } from "../flight-grid";

afterEach(cleanup);

describe("flow overlay column", () => {
  for (const following of [false, true]) {
    it(`stacks under the ${following ? "follow strip" : "top bar"}, between the columns`, () => {
      const grid = flightGrid({ width: 1280, height: 800, widthClass: "expanded", following });
      const pilot = parsePilotState(demoPilotWire({ link_loss_in_s: 4, link_loss_action: "rtl", gate: { pending: true, progress: 0.4 } }));
      if (!pilot) throw new Error("demo pilot wire did not parse");
      // The overlays show only what a fresh pilot frame says.
      useNavStreamStore.getState().setPilot("flow-stack", pilot);
      render(
        <FlightGridContext.Provider value={grid}><FlightFlowOverlays droneId="flow-stack" pilot={pilot} /></FlightGridContext.Provider>,
      );
      const stack = screen.getByTestId("flow-stack");
      const col = flowColumn(grid);
      expect(parseFloat(stack.style.left)).toBe(col.x);
      expect(parseFloat(stack.style.top)).toBe(col.y);
      expect(parseFloat(stack.style.width)).toBe(col.w);
      const chromeBottom = following
        ? grid.zones.follow_strip!.y + grid.zones.follow_strip!.h
        : grid.zones.top_bar!.y + grid.zones.top_bar!.h;
      expect(col.y).toBeGreaterThanOrEqual(chromeBottom);
      // The ring and the countdown are in the column, not centred on the screen.
      const ring = screen.getByTestId("gate-ring");
      expect(stack.contains(ring)).toBe(true);
      expect(ring.className).not.toContain("top-1/2");
      expect(stack.contains(screen.getByTestId("link-loss-countdown"))).toBe(true);
    });
  }
});

describe("no-video placeholder", () => {
  it("starts below the centre marks (a 200 px box) on a full picture", () => {
    expect(placeholderTop(800)).toBe(400 + PLACEHOLDER_DROP_PX);
    expect(placeholderTop(800)).toBeGreaterThan(400 + 100);
  });

  it("stays inside a short portrait picture", () => {
    const h = 232;
    expect(placeholderTop(h)).toBeGreaterThan(h / 2);
    expect(placeholderTop(h)).toBeLessThanOrEqual(h - 96);
  });

  it("is set on the main picture's frame, not on the card in the Map view", () => {
    const grid = flightGrid({ width: 1280, height: 800, widthClass: "expanded" });
    const { container, rerender } = render(
      <FlightGridContext.Provider value={grid}><FlightVideoFrame droneId="ph" view="pilot">{null}</FlightVideoFrame></FlightGridContext.Provider>,
    );
    const frame = () => container.querySelector(".fs-video") as HTMLElement;
    expect(frame().style.getPropertyValue("--fs-ph-top")).toBe(`${placeholderTop(videoRect("pilot", grid).h)}px`);
    rerender(<FlightGridContext.Provider value={grid}><FlightVideoFrame droneId="ph" view="map">{null}</FlightVideoFrame></FlightGridContext.Provider>);
    expect(frame().style.getPropertyValue("--fs-ph-top")).toBe("");
  });
});
