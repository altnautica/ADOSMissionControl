import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BatteryBar } from "@/components/shared/battery-bar";
import { flightModeChoices } from "@/components/shared/flight-mode-selector";
import { formatAltitudeWithDatum } from "@/lib/mission/altitude-frame";
import { useSettingsStore } from "@/stores/settings-store";

describe("BatteryBar", () => {
  it("shows an unknown reading as '--' with no fill, never 0 %", () => {
    const { container } = render(<BatteryBar percentage={null} />);
    expect(screen.getByText("--")).toBeTruthy();
    expect(screen.queryByText("0%")).toBeNull();
    expect(container.querySelector(".bg-status-error")).toBeNull();
  });

  it("treats a non-finite reading as unknown", () => {
    render(<BatteryBar percentage={Number.NaN} />);
    expect(screen.getByText("--")).toBeTruthy();
  });

  it("shows a known reading", () => {
    render(<BatteryBar percentage={42.4} />);
    expect(screen.getByText("42%")).toBeTruthy();
  });
});

describe("flightModeChoices", () => {
  it("offers the firmware's own modes", () => {
    const choices = flightModeChoices(["MANUAL", "TAKEOFF", "MISSION", "OFFBOARD"], "MISSION");
    expect(choices.map((c) => c.mode)).toEqual(["MANUAL", "TAKEOFF", "MISSION", "OFFBOARD"]);
    expect(choices.every((c) => !c.disabled)).toBe(true);
  });

  it("keeps a live mode the table lacks visible but disabled", () => {
    const choices = flightModeChoices(["STABILIZE", "LOITER"], "FOLLOW");
    expect(choices[0]).toEqual({ mode: "FOLLOW", disabled: true });
    expect(choices.slice(1).map((c) => c.mode)).toEqual(["STABILIZE", "LOITER"]);
  });
});

describe("formatAltitudeWithDatum", () => {
  it("labels AGL only for terrain-frame altitudes", () => {
    expect(formatAltitudeWithDatum(50, "terrain")).toBe("50m AGL");
    expect(formatAltitudeWithDatum(50, "relative")).toBe("50m above home");
    expect(formatAltitudeWithDatum(500, "absolute")).toBe("500m MSL");
  });
});

describe("guidance line setters", () => {
  it("clamp lengths and widths and reject non-finite values and bad colours", () => {
    const s = useSettingsStore.getState();
    s.setGuidanceHdgLength(150);
    s.setGuidanceHdgLength(-100);
    expect(useSettingsStore.getState().guidanceHdgLength).toBe(20);
    s.setGuidanceHdgLength(Number.NaN);
    expect(useSettingsStore.getState().guidanceHdgLength).toBe(20);
    s.setGuidanceTrackWpWidth(99);
    expect(useSettingsStore.getState().guidanceTrackWpWidth).toBe(5);
    s.setGuidanceTgtHdgColor("#12ab34");
    s.setGuidanceTgtHdgColor("red");
    expect(useSettingsStore.getState().guidanceTgtHdgColor).toBe("#12ab34");
  });
});
