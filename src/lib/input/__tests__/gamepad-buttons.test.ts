/**
 * @license GPL-3.0-only
 *
 * Each poll pass publishes the button state to the input store. The published
 * value has to be the frame's own, not a buffer the next frame rewrites: a
 * shared array makes every consumer see the same reference forever, so the
 * idiomatic selector subscription never fires and a held value can change
 * underneath whoever kept it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { startGamepadPolling, stopGamepadPolling } from "../gamepad-poller";
import { useInputStore } from "@/stores/input-store";

describe("published buttons array", () => {
  let frame: (() => void) | null = null;
  let pressed: boolean[] = [];

  function pad(): Gamepad {
    return {
      axes: [0, 0, 0, 0],
      buttons: pressed.map((p) => ({ pressed: p, touched: p, value: p ? 1 : 0 })),
    } as unknown as Gamepad;
  }

  /** Run exactly one poll pass. */
  function step(): void {
    const next = frame;
    frame = null;
    next?.();
  }

  beforeEach(() => {
    pressed = new Array(16).fill(false);
    frame = null;
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      frame = cb;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.stubGlobal("navigator", { getGamepads: () => [pad()] });
  });

  afterEach(() => {
    stopGamepadPolling();
    vi.unstubAllGlobals();
    useInputStore.getState().resetInput();
  });

  it("publishes a distinct array each frame so a change is observable", () => {
    startGamepadPolling();

    pressed[0] = true;
    step();
    const first = useInputStore.getState().buttons;
    expect(first[0]).toBe(true);

    pressed[0] = false;
    pressed[1] = true;
    step();
    const second = useInputStore.getState().buttons;

    // A consumer holding the previous value must be able to tell it changed.
    expect(second).not.toBe(first);
    expect(second[0]).toBe(false);
    expect(second[1]).toBe(true);
  });

  it("does not rewrite an already-published frame when the next one arrives", () => {
    startGamepadPolling();

    pressed[3] = true;
    step();
    const captured = useInputStore.getState().buttons;
    expect(captured[3]).toBe(true);

    pressed[3] = false;
    step();

    // The earlier frame is a value someone may still be holding; releasing the
    // button later must not reach back and edit it.
    expect(captured[3]).toBe(true);
  });

  it("publishes all sixteen button slots", () => {
    startGamepadPolling();
    step();
    expect(useInputStore.getState().buttons).toHaveLength(16);
  });
});
