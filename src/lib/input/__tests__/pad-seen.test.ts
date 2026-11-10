/**
 * @license GPL-3.0-only
 *
 * Whether a controller has been seen this session decides what the cockpit's
 * controller cell asks for: a pad the browser has reported once and then lost
 * needs a button press to come back, while no pad at all is "No controller".
 * The flag flips on the first read that returns a pad and stays set when the
 * pad drops.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { acquireGamepadPolling } from "../gamepad-poller";
import { usePadStatusStore } from "../pad-status";
import { useInputStore } from "@/stores/input-store";

describe("pad seen this session", () => {
  let frame: (() => void) | null = null;
  let connected = false;
  let release: (() => void) | null = null;

  const pad = () =>
    ({
      id: "pad-a",
      mapping: "standard",
      axes: [0, 0, 0, 0],
      timestamp: 1,
      buttons: new Array(16).fill({ pressed: false, touched: false, value: 0 }),
    }) as unknown as Gamepad;

  /** Run exactly one poll pass. */
  function step(): void {
    const next = frame;
    frame = null;
    next?.();
  }

  beforeEach(() => {
    frame = null;
    connected = false;
    usePadStatusStore.setState({ connected: false, seen: false, name: null, usable: false, needsCalibration: false });
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      frame = cb;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.stubGlobal("navigator", { getGamepads: () => [connected ? pad() : null] });
  });

  afterEach(() => {
    release?.();
    release = null;
    vi.unstubAllGlobals();
    useInputStore.getState().resetInput();
  });

  it("stays unset while the Gamepad API reports no pad", () => {
    release = acquireGamepadPolling();
    step();
    step();
    expect(usePadStatusStore.getState().seen).toBe(false);
  });

  it("flips on the first pad and stays set after the pad drops", () => {
    release = acquireGamepadPolling();
    step();
    expect(usePadStatusStore.getState().seen).toBe(false);

    connected = true;
    step();
    expect(usePadStatusStore.getState().seen).toBe(true);

    connected = false;
    step();
    expect(usePadStatusStore.getState()).toMatchObject({ seen: true, connected: false });
  });
});
