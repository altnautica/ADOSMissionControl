/**
 * @license GPL-3.0-only
 *
 * The flight-flow overlays say what the pilot state says, so a stale pilot
 * frame hides them all: the countdowns, the centre-sticks ring, the handover
 * banner and "sticks with". Both countdowns use the critical severity colour.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

import { FlightFlowOverlays } from "../FlightFlowOverlays";
import { parsePilotState } from "@/lib/hud/cockpit-frames";
import tokens from "@/lib/cockpit-spec/tokens.json";
import layoutSpec from "@/lib/cockpit-spec/layout.json";
import { demoPilotWire } from "@/mock/mock-pilot";
import { usePadStatusStore } from "@/lib/input/pad-status";
import { useNavStreamStore } from "@/stores/nav-stream-store";

const DRONE = "flow-stale-test";

const WIRE = {
  rth_countdown_s: 8,
  link_loss_in_s: 4,
  link_loss_action: "rtl",
  gate: { pending: true, progress: 0.3 },
  banner: { text_key: "flow.sticks_with", args: { label: "Tablet" } },
  input_session: { src: "other-surface", label: "Tablet", session: 3 },
};

function mount(ageMs: number) {
  const pilot = parsePilotState(demoPilotWire(WIRE));
  if (!pilot) throw new Error("demo pilot wire did not parse");
  useNavStreamStore.getState().setPilot(DRONE, pilot, Date.now() - ageMs);
  usePadStatusStore.setState({ connected: true } as never);
  return render(<FlightFlowOverlays droneId={DRONE} pilot={pilot} />);
}

const OVERLAYS = ["low-battery-rth", "link-loss-countdown", "gate-ring", "handover-banner", "sticks-with"];

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useNavStreamStore.getState().clear(DRONE);
  usePadStatusStore.setState({ connected: false } as never);
});

describe("flight-flow overlays and pilot freshness", () => {
  it("shows the countdowns, ring, banner and sticks-with on a fresh pilot frame", () => {
    mount(0);
    for (const id of OVERLAYS) expect(screen.queryByTestId(id), id).not.toBeNull();
  });

  it("hides them all once the pilot frame is stale", () => {
    mount(3000);
    for (const id of OVERLAYS) expect(screen.queryByTestId(id), id).toBeNull();
  });

  it("hides them as the frame crosses 2 s with no new frame arriving", () => {
    vi.useFakeTimers();
    mount(1500);
    for (const id of OVERLAYS) expect(screen.queryByTestId(id), id).not.toBeNull();
    act(() => void vi.advanceTimersByTime(400));
    for (const id of OVERLAYS) expect(screen.queryByTestId(id), id).not.toBeNull();
    act(() => void vi.advanceTimersByTime(600));
    for (const id of OVERLAYS) expect(screen.queryByTestId(id), id).toBeNull();
  });

  it("draws both countdowns in the critical severity colour", () => {
    expect(layoutSpec.banners.severity).toEqual({ low_battery_rth: "critical", link_loss: "critical" });
    mount(0);
    const critical = document.createElement("div");
    critical.style.background = tokens.chrome.severity_critical;
    for (const id of ["low-battery-rth", "link-loss-countdown"]) {
      const banner = screen.getByTestId(id);
      expect(banner.getAttribute("data-severity"), id).toBe("critical");
      expect(banner.style.background, id).toBe(critical.style.background);
    }
  });
});

describe("alert_stack zone", () => {
  const zone = () => document.querySelector<HTMLElement>("[data-zone='alert_stack']");

  it("holds the countdowns and banners while they are up", () => {
    mount(0);
    expect(zone()).not.toBeNull();
    expect(zone()!.contains(screen.getByTestId("low-battery-rth"))).toBe(true);
    expect(zone()!.childElementCount).toBeGreaterThan(0);
  });

  it("is empty and drops out of layout when nothing is up", () => {
    mount(3000);
    expect(zone()!.childElementCount).toBe(0);
    expect(zone()!.textContent).toBe("");
    expect(zone()!.className.split(" ")).toContain("empty:hidden");
  });
});
