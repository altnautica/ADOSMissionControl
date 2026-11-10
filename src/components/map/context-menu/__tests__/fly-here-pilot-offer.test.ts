/**
 * The map's right-click offers Fly here whenever the ADOS pilot accepts a
 * goto (live state listing `goto`, ADOS control, flying), whatever the FC
 * mode; without it the FC path stays GUIDED-only.
 *
 * @license GPL-3.0-only
 */

import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import pilotFixture from "@/lib/cockpit/layers/fixtures/pilot-frame.json";
import { parsePilotState, type PilotState } from "@/lib/hud/cockpit-frames";
import { useDroneManager } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { useMenuContext, useMenuItems } from "../use-menu-items";

const flying: PilotState = {
  ...parsePilotState(pilotFixture)!,
  controlMode: "ados",
  surfaceOps: ["goto"],
  armed: true,
  landed: false,
};

function setPilot(p: PilotState, ageMs: number) {
  useNavStreamStore.setState({
    byDrone: { d1: { pilot: { data: p, receivedAt: Date.now() - ageMs } } } as never,
  });
}

function itemIds(): string[] {
  const ctx = renderHook(() => useMenuContext()).result.current;
  return renderHook(() => useMenuItems(ctx)).result.current.map((i) => i.id);
}

describe("Fly here on the map context menu", () => {
  afterEach(() => {
    vi.useRealTimers();
    useNavStreamStore.setState({ byDrone: {} });
  });

  it("is offered through the pilot outside the FC guided modes", () => {
    useDroneManager.setState({ selectedDroneId: "d1" });
    useDroneStore.setState({ connectionState: "armed", armState: "armed", flightMode: "ALT_HOLD" });
    setPilot(flying, 100);
    expect(itemIds()).toContain("fly-here");
    expect(itemIds()).not.toContain("loiter-here");
  });

  it("is hidden outside the FC guided modes with a stale pilot state", () => {
    useDroneManager.setState({ selectedDroneId: "d1" });
    useDroneStore.setState({ connectionState: "armed", armState: "armed", flightMode: "ALT_HOLD" });
    setPilot(flying, 5000);
    expect(itemIds()).not.toContain("fly-here");
  });

  it("is hidden once the pilot state is exactly 2 s old", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(80_000);
    useDroneManager.setState({ selectedDroneId: "d1" });
    useDroneStore.setState({ connectionState: "armed", armState: "armed", flightMode: "ALT_HOLD" });
    setPilot(flying, 1999);
    expect(itemIds()).toContain("fly-here");
    setPilot(flying, 2000);
    expect(itemIds()).not.toContain("fly-here");
  });

  it("is hidden while the pilot reports an FC failsafe", () => {
    useDroneManager.setState({ selectedDroneId: "d1" });
    useDroneStore.setState({ connectionState: "armed", armState: "armed", flightMode: "RTL" });
    setPilot({ ...flying, fcFailsafe: true, failsafeCause: "fc" }, 100);
    expect(itemIds()).not.toContain("fly-here");
  });

  it("takes the FC route in GUIDED only while the drone is off the ground", () => {
    useDroneManager.setState({ selectedDroneId: "d1" });
    useDroneStore.setState({ connectionState: "armed", armState: "armed", flightMode: "GUIDED" });
    setPilot({ ...flying, controlMode: "fc_manual", landed: true }, 100);
    expect(itemIds()).not.toContain("fly-here");
    setPilot({ ...flying, controlMode: "fc_manual", landed: false }, 100);
    expect(itemIds()).toContain("fly-here");
  });
});
