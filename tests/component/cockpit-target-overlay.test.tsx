/**
 * Tests for the host-owned cockpit target overlay: it draws a clickable box for
 * each live detection (letterbox-mapped from the detection frame into the
 * measured container), selecting a box populates the shared selected-target
 * store, and the target-action popup then lists the built-in Designate action.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
}));

const toastFn = vi.fn();
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: toastFn }),
}));

import { CockpitTargetOverlay } from "@/components/vision/CockpitTargetOverlay";
import { useTargetActionHotkeys } from "@/hooks/use-target-action-hotkeys";
import { useVisionDetectionsStore } from "@/stores/vision-detections-store";
import { useSelectedTargetStore, type SelectedTarget } from "@/stores/selected-target-store";
import {
  registerBuiltinTargetActions,
  useTargetActionRegistry,
} from "@/lib/skills/target-actions";

const A_TARGET: SelectedTarget = {
  droneId: "drone-1",
  cameraId: "cam0",
  trackId: 7,
  bbox: { x: 100, y: 80, width: 120, height: 200 },
  classLabel: "person",
  confidence: 0.91,
};

function HotkeyHarness() {
  useTargetActionHotkeys();
  return null;
}

// happy-dom does no layout, so clientWidth/Height are 0 and the overlay would
// draw nothing. Report a real 16:9 container so the letterbox math produces a
// rect (the stream/frame is 4:3, so it letterboxes with side bars).
const W = 1280;
const H = 720;

function seedBatch(droneId: string, frameId = 1, x = 100) {
  act(() => {
    useVisionDetectionsStore.getState().setBatch(droneId, {
      modelId: "yolo",
      cameraId: "cam0",
      frameId,
      tsMs: frameId,
      frameWidth: 640,
      frameHeight: 480,
      detections: [
        {
          bbox: { x, y: 80, width: 120, height: 200 },
          classLabel: "person",
          confidence: 0.91,
          trackId: 7,
          lockState: "locked",
        },
      ],
    });
  });
}

describe("CockpitTargetOverlay", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: () => W,
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get: () => H,
    });
    useVisionDetectionsStore.getState().clear();
    useSelectedTargetStore.getState().clear();
    useTargetActionRegistry.setState({ actions: [] });
    toastFn.mockClear();
  });
  afterEach(() => {
    cleanup();
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  });

  it("draws a clickable box for each fresh detection", () => {
    seedBatch("drone-1");
    const { container } = render(<CockpitTargetOverlay droneId="drone-1" />);
    const boxes = container.querySelectorAll(
      '[data-cockpit-layer="target-overlay"] button[data-target-interactive]',
    );
    expect(boxes.length).toBe(1);
  });

  it("selecting a box populates the shared selected-target store and opens the action popup", () => {
    registerBuiltinTargetActions();
    seedBatch("drone-1");
    const { container, getByText } = render(
      <CockpitTargetOverlay droneId="drone-1" />,
    );
    const box = container.querySelector(
      'button[data-target-interactive]',
    ) as HTMLElement;
    expect(box).not.toBeNull();

    fireEvent.click(box);

    const selected = useSelectedTargetStore.getState().selected;
    expect(selected).not.toBeNull();
    expect(selected!.droneId).toBe("drone-1");
    expect(selected!.trackId).toBe(7);
    expect(selected!.classLabel).toBe("person");

    // The popup lists the built-in Designate action.
    expect(getByText("Designate target")).toBeTruthy();
  });

  it("keeps a tracked box's element across batches, so a press spanning a frame still selects", () => {
    seedBatch("drone-1", 1);
    const { container } = render(<CockpitTargetOverlay droneId="drone-1" />);
    const box = container.querySelector("button[data-target-interactive]") as HTMLElement;

    fireEvent.mouseDown(box);
    // The next detection batch (same track, moved a little) lands before mouseup.
    seedBatch("drone-1", 2, 104);
    expect(box.isConnected).toBe(true);
    fireEvent.mouseUp(box);
    fireEvent.click(box);

    expect(useSelectedTargetStore.getState().selected?.trackId).toBe(7);
  });

  it("fires a target action by its hotkey on the selected target", async () => {
    const activate = vi.fn();
    useTargetActionRegistry.getState().register({
      id: "test.act",
      label: "Test",
      source: "builtin",
      defaultKey: "d",
      activate,
    });
    useSelectedTargetStore.getState().select(A_TARGET);
    render(<HotkeyHarness />);

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "d" }));
      await Promise.resolve();
    });

    expect(activate).toHaveBeenCalledTimes(1);
    expect(activate.mock.calls[0][0].target.trackId).toBe(7);
    // Selection clears after the action fires.
    expect(useSelectedTargetStore.getState().selected).toBeNull();
  });

  it("does not fire a hotkey when no target is selected", async () => {
    const activate = vi.fn();
    useTargetActionRegistry.getState().register({
      id: "test.act",
      label: "Test",
      source: "builtin",
      defaultKey: "d",
      activate,
    });
    render(<HotkeyHarness />);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "d" }));
      await Promise.resolve();
    });
    expect(activate).not.toHaveBeenCalled();
  });

  it("renders nothing when the batch is stale", () => {
    seedBatch("drone-1");
    // Age the batch past the staleness window.
    act(() => {
      const s = useVisionDetectionsStore.getState();
      const b = s.batches["drone-1"];
      useVisionDetectionsStore.setState({
        batches: { "drone-1": { ...b, receivedAt: Date.now() - 10_000 } },
      });
    });
    const { container } = render(<CockpitTargetOverlay droneId="drone-1" />);
    expect(
      container.querySelectorAll("button[data-target-interactive]").length,
    ).toBe(0);
  });
});
