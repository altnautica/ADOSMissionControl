import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";

import messages from "../../../../locales/en.json";
import { FollowRangePanel } from "@/components/cockpit/FollowRangePanel";
import { CockpitLayoutContext } from "@/hooks/use-cockpit-width-class";
import type { CockpitWidthClass } from "@/lib/cockpit/width-class";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { useSelectedTargetStore } from "@/stores/selected-target-store";
import { NO_DATA_GLYPH } from "@/lib/hud-draw";
import { followState } from "./follow-fixtures";

const DRONE = "node:frp-test";

function renderPanel(widthClass: CockpitWidthClass, variant?: "line" | "detail") {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CockpitLayoutContext.Provider value={{ widthClass, width: 1280, height: 720 }}>
        <FollowRangePanel droneId={DRONE} variant={variant} />
      </CockpitLayoutContext.Provider>
    </NextIntlClientProvider>,
  );
}

function rows(): string[] {
  return Array.from(document.querySelectorAll("[data-row]")).map(
    (el) => el.getAttribute("data-row") ?? "",
  );
}

describe("FollowRangePanel", () => {
  beforeEach(() => {
    useNavStreamStore.getState().clear(DRONE);
    useSelectedTargetStore.setState({ designated: null });
  });
  afterEach(cleanup);

  it("is hidden outside following mode", () => {
    useNavStreamStore.getState().setFollow(DRONE, followState({ phase: "idle" }));
    renderPanel("expanded");
    expect(screen.queryByTestId("follow-range-panel")).toBeNull();
  });

  it("merges range and height into one line at compact", () => {
    useNavStreamStore.getState().setFollow(DRONE, followState());
    renderPanel("compact");
    const panel = screen.getByTestId("follow-range-panel");
    expect(panel.textContent).toContain("10.2 m");
    expect(panel.textContent).toContain("±0.3");
    expect(panel.textContent).not.toContain("AGL");
    expect(rows()).toEqual([]);
  });

  it("shows rows 1–3 at medium", () => {
    useNavStreamStore.getState().setFollow(DRONE, followState());
    renderPanel("medium");
    expect(rows()).toEqual(["range", "interval"]);
    expect(screen.getByText("Following")).toBeTruthy();
    expect(screen.getByText("9.6 – 10.8 m")).toBeTruthy();
  });

  it("shows all five rows at expanded with cues, latency and mode", () => {
    useNavStreamStore
      .getState()
      .setFollow(DRONE, followState({ pipelineLatencyMs: 300, aglSource: "baro", phase: "coasting" }));
    renderPanel("expanded");
    expect(rows()).toEqual(["range", "interval", "geometry", "cues"]);
    const geometry = document.querySelector("[data-row='geometry']")?.textContent ?? "";
    expect(geometry).toContain("DEP 22°");
    expect(geometry).toContain("BRG 064");
    expect(geometry).toContain("1.4 m/s");
    const cues = Array.from(document.querySelectorAll(".frp-cue")).map((el) => [
      el.textContent,
      el.getAttribute("data-lit"),
    ]);
    expect(cues).toEqual([
      ["GND", "true"],
      ["Box", "false"],
      ["LIDAR", "true"],
    ]);
    const lat = screen.getByText("LAT 300 ms");
    expect(lat.getAttribute("style")).toContain("--hud-warn");
    // The bottom row owns the height above the ground; the panel never repeats it.
    expect(screen.queryByText("BARO")).toBeNull();
    expect(document.body.textContent).not.toContain("AGL");
    expect(screen.getByText("Smart")).toBeTruthy();
    expect(screen.getByText("Coasting").getAttribute("style")).toContain("--hud-coast");
  });

  it("blanks every value and reads Stale when the report is older than 2 s", () => {
    useNavStreamStore.getState().setFollow(DRONE, followState(), Date.now() - 3000);
    renderPanel("tv");
    const panel = screen.getByTestId("follow-range-panel");
    expect(panel.getAttribute("data-stale")).toBe("true");
    expect(screen.getByText("Stale")).toBeTruthy();
    expect(panel.textContent).not.toContain("10.2");
    expect(panel.querySelector(".frp-range")?.textContent).toBe(NO_DATA_GLYPH);
  });

  // The follow strip's readout and its sheet (FollowDock) force a variant.
  it("keeps the strip's line variant on one line at expanded", () => {
    useNavStreamStore.getState().setFollow(DRONE, followState());
    renderPanel("expanded", "line");
    const panel = screen.getByTestId("follow-range-panel");
    expect(panel.querySelector(".frp-line")).not.toBeNull();
    expect(rows()).toEqual([]);
    expect(screen.getByTestId("follow-range-value").textContent).toBe("10.2 m");
    expect(panel.textContent).toContain("±0.3");
    expect(panel.textContent).toContain("Following");
  });

  it("blanks the line variant's range when stale, keeping its slot", () => {
    useNavStreamStore.getState().setFollow(DRONE, followState(), Date.now() - 3000);
    renderPanel("expanded", "line");
    expect(screen.getByTestId("follow-range-value").textContent).toBe(NO_DATA_GLYPH);
    expect(screen.getByText("Stale")).toBeTruthy();
  });

  it("opens the sheet's detail variant as rows even on a compact cockpit", () => {
    useNavStreamStore.getState().setFollow(DRONE, followState());
    renderPanel("compact", "detail");
    expect(rows()).toEqual(["range", "interval"]);
    expect(screen.getByText("9.6 – 10.8 m")).toBeTruthy();
  });

  it("shows every row in the detail variant at expanded", () => {
    useNavStreamStore.getState().setFollow(DRONE, followState());
    renderPanel("expanded", "detail");
    expect(rows()).toEqual(["range", "interval", "geometry", "cues"]);
  });
});
