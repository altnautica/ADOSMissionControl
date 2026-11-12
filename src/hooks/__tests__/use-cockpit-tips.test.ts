/**
 * The flight screen's tip queue: the first tip 2.5 s after opening, the next
 * 4 s after a dismissal, none while armed, a reset shows them again; an
 * auto-dismissed tip returns on the next open, one open counts once, and a
 * stale pilot state neither arms nor offers Fly here.
 *
 * @license GPL-3.0-only
 */

import { act, configure, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import tipsJson from "@/lib/cockpit-spec/tips.json";
import { tipsArmFacts, useCockpitTips, type CockpitTipsUi } from "../use-cockpit-tips";
import { useCockpitTipsStore } from "@/stores/cockpit-tips-store";
import { useControlsStore } from "@/stores/controls-store";
import { useDroneStore } from "@/stores/drone-store";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { parsePilotState } from "@/lib/hud/cockpit-frames";
import { demoPilotWire } from "@/mock/mock-pilot";

/** Pin a pilot state received `ageMs` ago. */
function pinPilot(over: Record<string, unknown>, ageMs: number): void {
  const pilot = parsePilotState(demoPilotWire(over));
  if (!pilot) throw new Error("demo pilot wire did not parse");
  useNavStreamStore.getState().setPilot("d1", pilot, Date.now() - ageMs);
}

/** Every tip before Fly here, seen. */
const BEFORE_FLY_HERE = ["status_pill", "flight_state_chip", "layer_level", "stop", "skills_chip"];

const anchorsVisible = Object.fromEntries(tipsJson.tips.map((t) => [t.anchor, true]));
const ui: CockpitTipsUi = {
  anchorsVisible,
  sheetOrMenuOpen: false,
  skillsAvailable: false,
  gimbalAvailable: false,
  alertBannerVisible: false,
};

function advance(ms: number) {
  act(() => void vi.advanceTimersByTime(ms));
}

describe("useCockpitTips", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useCockpitTipsStore.getState().reset();
    useControlsStore.setState({ tourVisible: false });
    useDroneStore.setState({ armState: "disarmed" });
  });
  afterEach(() => {
    vi.useRealTimers();
    useNavStreamStore.getState().clear("d1");
  });

  it("shows the status pill tip after the first delay, then the chip tip after the gap", () => {
    const { result } = renderHook(() => useCockpitTips("d1", () => ui));
    advance(tipsJson.rules.first_delay_ms - 300);
    expect(result.current.tip).toBeNull();
    advance(600);
    expect(result.current.tip).toMatchObject({ id: "status_pill", text: "Warnings collect here. Select to see them." });

    act(() => result.current.dismiss());
    expect(result.current.tip).toBeNull();
    advance(tipsJson.rules.gap_between_ms + 300);
    expect(result.current.tip?.id).toBe("flight_state_chip");
    expect(useCockpitTipsStore.getState().seen).toEqual(["status_pill"]);
  });

  it("hides the tip on arm, marks it seen, and shows none while armed", () => {
    const { result } = renderHook(() => useCockpitTips("d1", () => ui));
    advance(3000);
    expect(result.current.tip?.id).toBe("status_pill");
    act(() => useDroneStore.setState({ armState: "armed" }));
    advance(30_000);
    expect(result.current.tip).toBeNull();
    expect(useCockpitTipsStore.getState().seen).toContain("status_pill");
  });

  it("waits for the controller tour, and a reset shows seen tips again", () => {
    useCockpitTipsStore.setState({ seen: ["status_pill"], openCount: 3 });
    useControlsStore.setState({ tourVisible: true });
    const { result, unmount } = renderHook(() => useCockpitTips("d1", () => ui));
    advance(5000);
    expect(result.current.tip).toBeNull();
    unmount();

    useControlsStore.setState({ tourVisible: false });
    useCockpitTipsStore.getState().reset();
    const again = renderHook(() => useCockpitTips("d1", () => ui));
    advance(3000);
    expect(again.result.current.tip?.id).toBe("status_pill");
  });

  it("auto-dismisses without marking seen, and shows the tip again on the next open", () => {
    const { result, unmount } = renderHook(() => useCockpitTips("d1", () => ui));
    advance(3000 + tipsJson.rules.auto_dismiss_ms);
    expect(result.current.tip?.id).not.toBe("status_pill");
    expect(useCockpitTipsStore.getState().seen).not.toContain("status_pill");
    unmount();
    const again = renderHook(() => useCockpitTips("d1", () => ui));
    advance(3000);
    expect(again.result.current.tip?.id).toBe("status_pill");
  });

  it("counts one flight-screen open per mount under StrictMode", () => {
    configure({ reactStrictMode: true });
    try {
      renderHook(() => useCockpitTips("d1", () => ui));
      expect(useCockpitTipsStore.getState().openCount).toBe(1);
    } finally {
      configure({ reactStrictMode: false });
    }
  });

  it("offers the Fly here tip only from a fresh pilot state", () => {
    useCockpitTipsStore.setState({ seen: BEFORE_FLY_HERE, openCount: 0 });
    pinPilot({ surface_ops: ["goto"] }, 3_000);
    const stale = renderHook(() => useCockpitTips("d1", () => ui));
    advance(5000);
    expect(stale.result.current.tip).toBeNull();
    stale.unmount();

    const fresh = renderHook(() => useCockpitTips("d1", () => ui));
    advance(tipsJson.rules.first_delay_ms - 500);
    act(() => pinPilot({ surface_ops: ["goto"] }, 0));
    advance(800);
    expect(fresh.result.current.tip?.id).toBe("fly_here");
  });

  it("does not read a stale pilot's armed flag as armed", () => {
    pinPilot({ armed: true, landed: true }, 3_000);
    const { result } = renderHook(() => useCockpitTips("d1", () => ui));
    advance(3000);
    expect(result.current.tip?.id).toBe("status_pill");
  });

  it("treats an unknown arm state with no fresh pilot as possibly airborne", () => {
    useDroneStore.setState({ armState: "unknown" });
    const { result } = renderHook(() => useCockpitTips("d1", () => ui));
    advance(10_000);
    expect(result.current.tip).toBeNull();
    // A fresh pilot reporting disarmed on the ground settles it.
    act(() => pinPilot({ armed: false, landed: true }, 0));
    advance(500);
    expect(result.current.tip?.id).toBe("status_pill");
  });

  it("shows no tip while an alert banner is up, and hides one when a banner arrives", () => {
    const { result, rerender } = renderHook((u: CockpitTipsUi) => useCockpitTips("d1", () => u), {
      initialProps: { ...ui, alertBannerVisible: true },
    });
    advance(5000);
    expect(result.current.tip).toBeNull();
    rerender(ui);
    advance(3000);
    expect(result.current.tip?.id).toBe("status_pill");
    rerender({ ...ui, alertBannerVisible: true });
    advance(300);
    expect(result.current.tip).toBeNull();
    expect(useCockpitTipsStore.getState().seen).not.toContain("status_pill");
  });
});

describe("tipsArmFacts", () => {
  it("keeps a fresh pilot's unknown arm unknown, even over an FC disarm", () => {
    expect(tipsArmFacts({ armed: null, landed: null }, "disarmed", null)).toEqual({ armed: null, airborne: null });
  });
  it("reads a known ground and a known flight", () => {
    expect(tipsArmFacts({ armed: false, landed: true }, "unknown", null)).toEqual({ armed: false, airborne: false });
    expect(tipsArmFacts({ armed: true, landed: false }, "armed", null)).toEqual({ armed: true, airborne: true });
    expect(tipsArmFacts(null, "unknown", null)).toEqual({ armed: null, airborne: null });
    expect(tipsArmFacts(null, "disarmed", null)).toEqual({ armed: false, airborne: false });
  });
});
