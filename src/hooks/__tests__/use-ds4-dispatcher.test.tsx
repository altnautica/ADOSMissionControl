/**
 * The controller's spec bindings: Photo and Zoom take the same camera route
 * as the on-screen buttons, and while the controller tour shows, the bare
 * D-pad and Cross drive the tour and nothing else.
 *
 * @license GPL-3.0-only
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type * as CameraActions from "@/lib/cockpit/camera-actions";
import type * as PickerCommands from "@/lib/cockpit/picker-commands";
import type * as Registry from "@/lib/skills/registry";

const spies = vi.hoisted(() => ({
  photo: vi.fn(async (_droneId: string): Promise<CameraActions.PhotoResult> => "saved"),
  zoom: vi.fn((_droneId: string, _step: CameraActions.ZoomStep): CameraActions.ZoomResult => ({ digital: 2 })),
  pilotAction: vi.fn((_action: string) => undefined),
  picker: vi.fn((_cmd: string) => true),
  screenshot: vi.fn(async () => new Blob(["png"])),
  notify: vi.fn((_text: string, _level?: string) => undefined),
}));

vi.mock("@/lib/cockpit/camera-actions", async (importOriginal) => ({
  ...(await importOriginal<typeof CameraActions>()),
  cockpitPhoto: (droneId: string) => spies.photo(droneId),
  cockpitZoom: (droneId: string, step: CameraActions.ZoomStep) => spies.zoom(droneId, step),
}));
vi.mock("@/lib/cockpit/picker-commands", async (importOriginal) => ({
  ...(await importOriginal<typeof PickerCommands>()),
  sendPickerCommand: (cmd: string) => spies.picker(cmd),
}));
vi.mock("@/lib/input/pilot-stream", () => ({ sendPilotAction: (a: string) => spies.pilotAction(a) }));
vi.mock("@/lib/video/webrtc-client", () => ({
  captureScreenshot: () => spies.screenshot(),
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
vi.mock("@/lib/skills/registry", async (importOriginal) => ({
  ...(await importOriginal<typeof Registry>()),
  notifySkill: (text: string, level?: string) => spies.notify(text, level),
}));

import { useDs4Dispatcher } from "@/hooks/use-ds4-dispatcher";
import { WEB_BUTTON_INDEX } from "@/lib/input/ds4-bindings";
import { useCockpitLayersStore } from "@/stores/cockpit-layers-store";
import { useControlsStore } from "@/stores/controls-store";
import { useInputStore } from "@/stores/input-store";
import { useViewZoomStore } from "@/components/cockpit/flight/view-zoom-store";

function Dispatcher() {
  useDs4Dispatcher("pad-drone");
  return null;
}

/** Press and release one control (a tap). */
function tap(control: string): void {
  const down: boolean[] = [];
  down[WEB_BUTTON_INDEX[control]] = true;
  act(() => useInputStore.setState({ buttons: down }));
  act(() => useInputStore.setState({ buttons: [] }));
}

beforeEach(() => {
  for (const s of Object.values(spies)) s.mockClear();
  useControlsStore.setState({ bindings: null, tourVisible: false });
  useInputStore.setState({ buttons: [] });
  useViewZoomStore.setState({ byDrone: {} });
});

afterEach(() => cleanup());

describe("controller camera buttons", () => {
  it("Square takes the cockpit photo and toasts its result", async () => {
    render(<Dispatcher />);
    tap("square");
    await act(async () => {});
    expect(spies.photo).toHaveBeenCalledWith("pad-drone");
    expect(spies.screenshot).not.toHaveBeenCalled();
    expect(spies.notify).toHaveBeenCalledWith("Photo saved", "success");
  });

  it("R1 and L1 step the cockpit zoom in and out", () => {
    render(<Dispatcher />);
    tap("r1");
    tap("l1");
    expect(spies.zoom.mock.calls).toEqual([
      ["pad-drone", 1],
      ["pad-drone", -1],
    ]);
    expect(useViewZoomStore.getState().byDrone["pad-drone"]).toBeUndefined();
  });
});

describe("controller while the tour shows", () => {
  it("Cross and the bare D-pad drive the tour only", () => {
    const stepLevel = vi.spyOn(useCockpitLayersStore.getState(), "stepLevel");
    useControlsStore.setState({ tourVisible: true });
    render(<Dispatcher />);
    for (const c of ["cross", "dpad_left", "dpad_right", "dpad_up", "dpad_down"]) tap(c);
    expect(spies.picker).not.toHaveBeenCalled();
    expect(spies.pilotAction).not.toHaveBeenCalled();
    expect(stepLevel).not.toHaveBeenCalled();
    stepLevel.mockRestore();
  });

  it("other buttons keep working", () => {
    useControlsStore.setState({ tourVisible: true });
    render(<Dispatcher />);
    tap("r1");
    expect(spies.zoom).toHaveBeenCalledWith("pad-drone", 1);
  });

  it("Cross selects in the picker once the tour is gone", () => {
    render(<Dispatcher />);
    tap("cross");
    expect(spies.picker).toHaveBeenCalledWith("select");
  });
});
