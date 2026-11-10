/**
 * The pad's safety holds with a sheet open: L2 + R2 + Circle (emergency
 * stop) and Options + Circle (return home) held to completion send their
 * action, and the Circle in the combo never reaches its bare binding (Stop /
 * back, which closes the skill picker), whichever way round the buttons go
 * down and come up. Options in the combo never toggles quick settings.
 *
 * @license GPL-3.0-only
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type * as PickerCommands from "@/lib/cockpit/picker-commands";
import type * as Skills from "@/lib/skills";

const spies = vi.hoisted(() => ({
  activate: vi.fn(async (_id: string, _ctx: unknown, _opts?: unknown) => undefined),
  picker: vi.fn((_cmd: string) => true),
}));

vi.mock("@/lib/skills", async (importOriginal) => ({
  ...(await importOriginal<typeof Skills>()),
  activate: (id: string, ctx: unknown, opts?: unknown) => spies.activate(id, ctx, opts),
  buildSkillContext: () => ({}),
}));
vi.mock("@/lib/cockpit/picker-commands", async (importOriginal) => ({
  ...(await importOriginal<typeof PickerCommands>()),
  sendPickerCommand: (cmd: string) => spies.picker(cmd),
}));
vi.mock("@/lib/input/pilot-stream", () => ({ sendPilotAction: vi.fn() }));
vi.mock("@/lib/video/webrtc-client", () => ({
  captureScreenshot: vi.fn(async () => new Blob(["png"])),
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
}));
vi.mock("@/lib/input/ds4-feedback", () => ({
  rumble: vi.fn(),
  rumbleHoldTick: vi.fn(),
  setLightbar: vi.fn(async () => false),
  lightbarState: () => "idle",
  lightbarColour: () => [0, 0, 0],
}));

import { useDs4Dispatcher } from "@/hooks/use-ds4-dispatcher";
import { usePickerStore } from "@/lib/cockpit/picker-commands";
import { WEB_BUTTON_INDEX } from "@/lib/input/ds4-bindings";
import { useControlsStore } from "@/stores/controls-store";
import { useFlyQuickSettingsStore } from "@/stores/fly-quick-settings-store";
import { useInputStore } from "@/stores/input-store";
import { useSkillConfirmStore } from "@/stores/skill-confirm-store";

function Dispatcher() {
  useDs4Dispatcher("pad-drone");
  return null;
}

/** Put exactly these controls down. */
function hold(controls: string[]): void {
  const down: boolean[] = [];
  for (const c of controls) down[WEB_BUTTON_INDEX[c]] = true;
  act(() => useInputStore.setState({ buttons: down }));
}

/** Press `order` one at a time, hold past `ms`, release `release` one at a time. */
function combo(order: string[], ms: number, release: string[]): void {
  const down: string[] = [];
  for (const c of order) {
    down.push(c);
    hold(down);
  }
  act(() => vi.advanceTimersByTime(ms + 200));
  let left = [...down];
  for (const c of release) {
    left = left.filter((x) => x !== c);
    hold(left);
  }
  act(() => vi.advanceTimersByTime(500));
}

const builtins = () => spies.activate.mock.calls.map((c) => c[0]);

beforeEach(() => {
  vi.useFakeTimers();
  spies.activate.mockClear();
  spies.picker.mockClear();
  useControlsStore.setState({ bindings: null, tourVisible: false });
  useInputStore.setState({ buttons: [] });
  usePickerStore.setState({ open: true });
  useFlyQuickSettingsStore.setState({ isOpen: true, focusPluginId: null });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  usePickerStore.setState({ open: false });
  useFlyQuickSettingsStore.setState({ isOpen: false, focusPluginId: null });
  useSkillConfirmStore.setState({ pending: null });
});

const KILL_ORDERS: [string, string[], string[]][] = [
  ["Circle last down, first up", ["l2", "r2", "circle"], ["circle", "r2", "l2"]],
  ["Circle first down, last up", ["circle", "l2", "r2"], ["l2", "r2", "circle"]],
];
const RTH_ORDERS: [string, string[], string[]][] = [
  ["Circle last down, first up", ["options", "circle"], ["circle", "options"]],
  ["Circle first down, last up", ["circle", "options"], ["options", "circle"]],
];

describe("pad safety holds with a sheet open", () => {
  it.each(KILL_ORDERS)("L2 + R2 + Circle sends the emergency stop (%s)", (_name, order, release) => {
    render(<Dispatcher />);
    combo(order, 3000, release);
    expect(builtins()).toEqual(["kill"]);
    expect(spies.picker).not.toHaveBeenCalled();
    expect(usePickerStore.getState().open).toBe(true);
  });

  it.each(RTH_ORDERS)("Options + Circle sends return home (%s)", (_name, order, release) => {
    render(<Dispatcher />);
    combo(order, 2000, release);
    expect(builtins()).toContain("rth");
    expect(builtins().every((id) => id === "pause" || id === "rth")).toBe(true);
    expect(spies.picker).not.toHaveBeenCalled();
    expect(useFlyQuickSettingsStore.getState().isOpen).toBe(true);
  });

  it("still sends the emergency stop with a confirm sheet up", () => {
    useSkillConfirmStore.setState({ pending: {} as never });
    render(<Dispatcher />);
    combo(["l2", "r2", "circle"], 3000, ["circle", "r2", "l2"]);
    expect(builtins()).toEqual(["kill"]);
    expect(spies.picker).not.toHaveBeenCalled();
  });

  it("a bare Circle tap still backs out of the open picker", () => {
    render(<Dispatcher />);
    hold(["circle"]);
    hold([]);
    expect(spies.picker).toHaveBeenCalledWith("stop");
  });
});
