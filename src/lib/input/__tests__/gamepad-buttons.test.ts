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

import {
  acquireGamepadPolling,
  isPolling,
  manualControlButtonMask,
} from "../gamepad-poller";
import { COCKPIT_GAMEPAD_BUTTON } from "@/lib/skills/chord";
import { useInputStore } from "@/stores/input-store";

describe("published buttons array", () => {
  let frame: (() => void) | null = null;
  let release: (() => void) | null = null;
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
    release?.();
    release = null;
    vi.unstubAllGlobals();
    useInputStore.getState().resetInput();
  });

  it("publishes a distinct array each frame so a change is observable", () => {
    release = acquireGamepadPolling();

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
    release = acquireGamepadPolling();

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
    release = acquireGamepadPolling();
    step();
    expect(useInputStore.getState().buttons).toHaveLength(16);
  });

  it("keeps the published array when no button changed, and notifies once per frame", () => {
    release = acquireGamepadPolling();
    pressed[2] = true;
    step();
    const first = useInputStore.getState().buttons;

    let notifications = 0;
    const unsubscribe = useInputStore.subscribe(() => {
      notifications += 1;
    });
    step();
    unsubscribe();

    expect(useInputStore.getState().buttons).toBe(first);
    expect(notifications).toBe(1);
  });
});

describe("acquireGamepadPolling", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.stubGlobal("navigator", { getGamepads: () => [] });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keeps polling until the last holder releases", () => {
    const a = acquireGamepadPolling();
    const b = acquireGamepadPolling();
    expect(isPolling()).toBe(true);
    a();
    expect(isPolling()).toBe(true);
    b();
    expect(isPolling()).toBe(false);
  });

  it("treats a repeated release as a no-op", () => {
    const a = acquireGamepadPolling();
    const b = acquireGamepadPolling();
    a();
    a();
    expect(isPolling()).toBe(true);
    b();
    expect(isPolling()).toBe(false);
  });
});

describe("manualControlButtonMask", () => {
  it("passes free buttons and masks the cockpit's reserved ones", () => {
    const buttons = new Array(16).fill(true);
    const mask = manualControlButtonMask(buttons);
    for (const reserved of Object.values(COCKPIT_GAMEPAD_BUTTON)) {
      expect(mask & (1 << reserved)).toBe(0);
    }
    for (const free of [0, 1, 2, 3, 6, 7, 10, 11]) {
      expect(mask & (1 << free)).not.toBe(0);
    }
  });

  it("ignores buttons past the sixteenth", () => {
    const buttons = new Array(20).fill(false);
    buttons[17] = true;
    expect(manualControlButtonMask(buttons)).toBe(0);
  });
});
