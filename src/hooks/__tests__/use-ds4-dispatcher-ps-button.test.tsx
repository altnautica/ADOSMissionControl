/**
 * The PS button sits at standard-mapping index 16, past the 16 buttons a
 * MANUAL_CONTROL mask carries. Driven through the real poller, a PS press
 * reaches the dispatcher and pauses; the mask sent to the flight controller
 * still stops at 16 bits.
 *
 * @license GPL-3.0-only
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type * as Skills from "@/lib/skills";

const spies = vi.hoisted(() => ({
  activate: vi.fn(async (_id: string, _ctx: unknown, _opts?: unknown) => undefined),
}));

vi.mock("@/lib/skills", async (importOriginal) => ({
  ...(await importOriginal<typeof Skills>()),
  activate: (id: string, ctx: unknown, opts?: unknown) => spies.activate(id, ctx, opts),
  buildSkillContext: () => ({}),
}));
vi.mock("@/lib/input/pilot-stream", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  sendPilotAction: vi.fn(),
}));
vi.mock("@/lib/input/ds4-feedback", () => ({
  rumble: vi.fn(),
  rumbleHoldTick: vi.fn(),
  setLightbar: vi.fn(async () => false),
  lightbarState: () => "idle",
  lightbarColour: () => [0, 0, 0],
}));

import { useDs4Dispatcher } from "@/hooks/use-ds4-dispatcher";
import { acquireGamepadPolling } from "@/lib/input/gamepad-poller";
import { manualControlButtonMask } from "@/lib/input/gamepad-axes";
import { WEB_BUTTON_INDEX } from "@/lib/input/ds4-bindings";
import { useControlsStore } from "@/stores/controls-store";
import { useInputStore } from "@/stores/input-store";

function Dispatcher() {
  useDs4Dispatcher("pad-drone");
  return null;
}

let frame: (() => void) | null = null;
let release: (() => void) | null = null;
const pressed: boolean[] = new Array(18).fill(false);

function pad(): Gamepad {
  return {
    id: "Wireless Controller",
    connected: true,
    mapping: "standard",
    axes: [0, 0, 0, 0],
    buttons: pressed.map((p) => ({ pressed: p, touched: p, value: p ? 1 : 0 })),
  } as unknown as Gamepad;
}

/** Run one poll pass. */
function step(): void {
  const next = frame;
  frame = null;
  act(() => next?.());
}

beforeEach(() => {
  vi.useFakeTimers();
  pressed.fill(false);
  frame = null;
  spies.activate.mockClear();
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
    frame = cb;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("navigator", { getGamepads: () => [pad()] });
  useControlsStore.setState({ bindings: null, tourVisible: false });
  useInputStore.setState({ buttons: [] });
});

afterEach(() => {
  release?.();
  release = null;
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  useInputStore.getState().resetInput();
});

describe("PS button through the real poller", () => {
  it("publishes the PS and touchpad buttons to the input store", () => {
    release = acquireGamepadPolling();
    pressed[WEB_BUTTON_INDEX.ps] = true;
    pressed[WEB_BUTTON_INDEX.touchpad] = true;
    step();
    const buttons = useInputStore.getState().buttons;
    expect(buttons[WEB_BUTTON_INDEX.ps]).toBe(true);
    expect(buttons[WEB_BUTTON_INDEX.touchpad]).toBe(true);
    // The flight controller's button mask stays 16 bits wide.
    expect(manualControlButtonMask(buttons) >>> 16).toBe(0);
  });

  it("a PS press pauses", () => {
    render(<Dispatcher />);
    release = acquireGamepadPolling();
    pressed[WEB_BUTTON_INDEX.ps] = true;
    step();
    act(() => vi.advanceTimersByTime(150));
    pressed[WEB_BUTTON_INDEX.ps] = false;
    step();
    act(() => vi.advanceTimersByTime(500));
    expect(spies.activate.mock.calls.map((c) => c[0])).toContain("pause");
  });
});
