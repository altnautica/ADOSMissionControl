/**
 * The flight screen's tip queue: the first tip 2.5 s after opening, the next
 * 4 s after a dismissal, none while armed, a reset shows them again.
 *
 * @license GPL-3.0-only
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import tipsJson from "@/lib/cockpit-spec/tips.json";
import { useCockpitTips, type CockpitTipsUi } from "../use-cockpit-tips";
import { useCockpitTipsStore } from "@/stores/cockpit-tips-store";
import { useControlsStore } from "@/stores/controls-store";
import { useDroneStore } from "@/stores/drone-store";

const anchorsVisible = Object.fromEntries(tipsJson.tips.map((t) => [t.anchor, true]));
const ui: CockpitTipsUi = { anchorsVisible, sheetOrMenuOpen: false, skillsAvailable: false, gimbalAvailable: false };

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
  afterEach(() => vi.useRealTimers());

  it("shows the status pill tip after the first delay, then the chip tip after the gap", () => {
    const { result } = renderHook(() => useCockpitTips("d1", ui));
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
    const { result } = renderHook(() => useCockpitTips("d1", ui));
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
    const { result, unmount } = renderHook(() => useCockpitTips("d1", ui));
    advance(5000);
    expect(result.current.tip).toBeNull();
    unmount();

    useControlsStore.setState({ tourVisible: false });
    useCockpitTipsStore.getState().reset();
    const again = renderHook(() => useCockpitTips("d1", ui));
    advance(3000);
    expect(again.result.current.tip?.id).toBe("status_pill");
  });

  it("auto-dismisses without marking seen", () => {
    const { result } = renderHook(() => useCockpitTips("d1", ui));
    advance(3000 + tipsJson.rules.auto_dismiss_ms);
    expect(result.current.tip?.id).not.toBe("status_pill");
    expect(useCockpitTipsStore.getState().seen).not.toContain("status_pill");
  });
});
