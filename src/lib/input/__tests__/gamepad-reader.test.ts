/**
 * @license GPL-3.0-only
 *
 * What the gamepad reader publishes decides whether sticks reach an armed
 * aircraft: a pad that drops must revoke the opt-in, a pad that stops
 * reporting must not keep refreshing the liveness stamp, and the operator's
 * stick mode must decide which physical stick is throttle.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { startGamepadPolling, stopGamepadPolling } from "../gamepad-poller";
import { useInputStore } from "@/stores/input-store";

describe("gamepad reader", () => {
  let frame: (() => void) | null = null;
  let connected = true;
  let axes = [0, 0, 0, 0];
  let timestamp = 1;

  function pad(): Gamepad {
    return {
      axes,
      timestamp,
      buttons: new Array(16).fill({ pressed: false, touched: false, value: 0 }),
    } as unknown as Gamepad;
  }

  /** Run exactly one poll pass. */
  function step(): void {
    const next = frame;
    frame = null;
    next?.();
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    frame = null;
    connected = true;
    axes = [0, 0, 0, 0];
    timestamp = 1;
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      frame = cb;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.stubGlobal("navigator", { getGamepads: () => [connected ? pad() : null] });
    useInputStore.setState({ txMode: 2 });
  });

  afterEach(() => {
    stopGamepadPolling();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    useInputStore.setState({ txMode: 2 });
    useInputStore.getState().resetInput();
  });

  it("revokes stick control when the pad drops, and a returning pad does not restore it", () => {
    startGamepadPolling();
    step();
    useInputStore.getState().setManualControlEnabled(true);

    connected = false;
    step();
    expect(useInputStore.getState().manualControlEnabled).toBe(false);

    connected = true;
    step();
    expect(useInputStore.getState().activeController).toBe("gamepad");
    expect(useInputStore.getState().manualControlEnabled).toBe(false);
  });

  it("stops refreshing the liveness stamp when a deflected pad stops reporting", () => {
    axes = [0.8, 0, 0, 0];
    startGamepadPolling();
    step();
    const reportedAt = useInputStore.getState().axesAt;
    expect(reportedAt).toBe(10_000);

    // Same device timestamp for longer than a hand can hold a stick still.
    vi.setSystemTime(10_600);
    step();
    expect(useInputStore.getState().axesAt).toBe(reportedAt);

    // The pad reports again: live again.
    timestamp = 2;
    vi.setSystemTime(10_620);
    step();
    expect(useInputStore.getState().axesAt).toBe(10_620);
  });

  it("keeps a centred pad live when its timestamp does not move", () => {
    startGamepadPolling();
    step();
    vi.setSystemTime(12_000);
    step();
    expect(useInputStore.getState().axesAt).toBe(12_000);
  });

  it("reads throttle from the right stick in mode 1", () => {
    // Right stick pushed fully up (standard axis 3 reads -1 when up).
    axes = [0, 0, 0, -1];
    useInputStore.setState({ txMode: 1 });
    startGamepadPolling();
    step();
    expect(useInputStore.getState().axes[2]).toBeCloseTo(1);
    expect(useInputStore.getState().axes[1]).toBe(0);
  });
});
