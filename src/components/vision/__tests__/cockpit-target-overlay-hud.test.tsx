/**
 * The cockpit target layer end to end: resolver states drawn from the live
 * stores, follow-me events mirrored into the designation, the video-lost
 * blank, keyboard focus, drag-to-designate, the double-click wait, and the
 * PiP layer.
 *
 * @license GPL-3.0-only
 */

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const designate = vi.hoisted(() => vi.fn(async (_target: SelectedTarget, _notify: unknown) => true));
vi.mock("@/lib/skills/target-actions", async (orig) => ({
  ...(await orig<typeof import("@/lib/skills/target-actions")>()),
  designateTarget: designate,
}));

import messages from "../../../../locales/en.json";
import { CockpitTargetOverlay } from "@/components/vision/CockpitTargetOverlay";
import { parseFollowState } from "@/lib/agent/nav-types";
import { DOUBLE_CLICK_MS } from "@/lib/vision/target-interaction";
import { useDroneManager } from "@/stores/drone-manager";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { useSelectedTargetStore, type SelectedTarget } from "@/stores/selected-target-store";
import { useVideoStore } from "@/stores/video-store";
import { useVideoStreamsStore } from "@/stores/video-streams-store";
import { useVisionDetectionsStore, type VisionDetection } from "@/stores/vision-detections-store";

const DRONE = "node:d1";
const W = 1280;
const H = 720;

function ui(node: ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <div data-testid="video-host">{node}</div>
    </NextIntlClientProvider>,
  );
}

function seed(cameraId: string, detections: VisionDetection[]) {
  act(() => {
    useVisionDetectionsStore.getState().setBatch(DRONE, {
      modelId: "m",
      cameraId,
      frameId: 1,
      tsMs: 1,
      frameWidth: W,
      frameHeight: H,
      detections,
    });
  });
}

const person = (trackId: number | undefined, x: number, confidence = 0.9): VisionDetection => ({
  bbox: { x, y: 200, width: 80, height: 200 },
  classLabel: "person",
  confidence,
  trackId,
  lockState: trackId != null ? "locked" : undefined,
});

function designate12() {
  useSelectedTargetStore.getState().setDesignated({
    droneId: DRONE,
    cameraId: "main",
    trackId: 12,
    bbox: { x: 600, y: 200, width: 80, height: 200 },
    classLabel: "person",
    confidence: 0.9,
  });
}

const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

describe("CockpitTargetOverlay (HUD target layer)", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => W });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => H });
    useVisionDetectionsStore.getState().clear();
    useSelectedTargetStore.getState().reset();
    useNavStreamStore.getState().clear(DRONE);
    useVideoStreamsStore.setState({
      streamsByDrone: {
        [DRONE]: [
          { id: "main", index: 1, label: "main", kind: "concurrent" },
          { id: "rear", index: 2, label: "rear", kind: "concurrent", role: "down" },
        ],
      },
      activeStreamIdByDrone: { [DRONE]: "main" },
      pipStreamIdByDrone: { [DRONE]: "rear" },
    });
    useVideoStore.setState({ isStreaming: false, degradedReason: null });
    designate.mockClear();
  });
  afterEach(() => {
    cleanup();
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  });

  it("draws a followed target with reticle, feet tick and range tags", () => {
    seed("main", [person(12, 600)]);
    designate12();
    act(() => {
      useNavStreamStore
        .getState()
        .setFollow(DRONE, parseFollowState({ phase: "following", track_id: 12, range_m: 10.2, range_sigma_m: 0.3 })!);
    });
    const { container } = ui(<CockpitTargetOverlay droneId={DRONE} />);
    const g = container.querySelector('[data-kind="FOLLOWING"]')!;
    expect(g).not.toBeNull();
    expect(g.querySelector(".tgt-reticle")).not.toBeNull();
    expect(g.querySelector(".tgt-feet")).not.toBeNull();
    expect(g.textContent).toBe("TRACK 90%10.2 m±0.6 m");
  });

  it("draws nothing over a frozen video", () => {
    seed("main", [person(12, 600)]);
    act(() => {
      useDroneManager.setState({ selectedDroneId: DRONE });
      useVideoStore.setState({ isStreaming: true, degradedReason: "no-progress" });
    });
    const { container } = ui(<CockpitTargetOverlay droneId={DRONE} />);
    expect(container.querySelector(".tgt")).toBeNull();
    expect(container.querySelector("button[data-target-interactive]")).toBeNull();
  });

  it("moves the designation on follow.reacquired and clears it on follow.lost", () => {
    seed("main", [person(12, 600), person(15, 200)]);
    designate12();
    ui(<CockpitTargetOverlay droneId={DRONE} />);
    act(() => {
      useNavStreamStore
        .getState()
        .pushFollowEvent(DRONE, { topic: "follow.reacquired", trackId: 15, similarity: 0.86, gapS: 1.8 });
    });
    const d = useSelectedTargetStore.getState().designated;
    expect(d?.trackId).toBe(15);
    expect(d?.cameraId).toBe("main");
    expect(d?.bbox.x).toBe(200);

    act(() => {
      useNavStreamStore.getState().pushFollowEvent(DRONE, { topic: "follow.lost", trackId: 15, reason: "lock_lost" });
    });
    expect(useSelectedTargetStore.getState().designated).toBeNull();
  });

  it("cycles a focus ring with [ ] and opens the menu with Enter", () => {
    seed("main", [person(2, 900), person(1, 100)]);
    const { container } = ui(<CockpitTargetOverlay droneId={DRONE} />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "]" }));
    });
    expect(container.querySelector('[data-key="t:1"] .tgt-focus')).not.toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "]" }));
    });
    expect(container.querySelector('[data-key="t:2"] .tgt-focus')).not.toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    });
    expect(useSelectedTargetStore.getState().popupTarget?.trackId).toBe(2);
    // Esc closes the menu first, then clears the focus.
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(useSelectedTargetStore.getState().popupTarget).toBeNull();
    expect(container.querySelector(".tgt-focus")).not.toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(container.querySelector(".tgt-focus")).toBeNull();
  });

  it("waits out the double-click interval before opening the menu", async () => {
    seed("main", [person(7, 600)]);
    const { container } = ui(<CockpitTargetOverlay droneId={DRONE} />);
    const box = container.querySelector("button[data-target-interactive]") as HTMLElement;

    fireEvent.click(box, { detail: 1 });
    expect(useSelectedTargetStore.getState().popupTarget).toBeNull();
    await wait(DOUBLE_CLICK_MS + 30);
    expect(useSelectedTargetStore.getState().popupTarget?.trackId).toBe(7);

    act(() => useSelectedTargetStore.getState().closePopup());
    fireEvent.click(box, { detail: 1 });
    fireEvent.click(box, { detail: 2 });
    await wait(DOUBLE_CLICK_MS + 30);
    expect(useSelectedTargetStore.getState().popupTarget).toBeNull();
  });

  it("designates a dragged rect in frame px through the designate path", () => {
    seed("main", []);
    const { getByTestId, queryByTestId } = ui(<CockpitTargetOverlay droneId={DRONE} />);
    const host = getByTestId("video-host");
    fireEvent.pointerDown(host, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 300, clientY: 250 });
    expect(queryByTestId("target-drag-selection")).not.toBeNull();
    fireEvent.pointerUp(window, { clientX: 300, clientY: 250 });
    expect(queryByTestId("target-drag-selection")).toBeNull();
    expect(designate).toHaveBeenCalledTimes(1);
    const target = designate.mock.calls[0][0];
    expect(target.cameraId).toBe("main");
    expect(target.trackId).toBeNull();
    expect(target.bbox).toEqual({ x: 100, y: 100, width: 200, height: 150 });
  });

  it("ignores a dragged rect under 1 % of the frame, and Esc cancels a drag", () => {
    seed("main", []);
    const { getByTestId, queryByTestId } = ui(<CockpitTargetOverlay droneId={DRONE} />);
    const host = getByTestId("video-host");
    fireEvent.pointerDown(host, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 115, clientY: 103 });
    fireEvent.pointerUp(window, { clientX: 115, clientY: 103 });
    expect(designate).not.toHaveBeenCalled();

    fireEvent.pointerDown(host, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 300, clientY: 300 });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(queryByTestId("target-drag-selection")).toBeNull();
    fireEvent.pointerUp(window, { clientX: 300, clientY: 300 });
    expect(designate).not.toHaveBeenCalled();
  });

  it("PiP draws its own camera with PiP tag rules and stays interactive", async () => {
    seed("main", [person(12, 600)]);
    seed("rear", [person(undefined, 100, 0.8), person(4, 600)]);
    designate12();
    const { container, unmount } = ui(
      <CockpitTargetOverlay droneId={DRONE} pip={{ cameraId: "rear", role: "down", videoLost: false, fit: "cover" }} />,
    );
    const layer = container.querySelector('[data-cockpit-layer="pip-target-overlay"]')!;
    expect(layer.querySelector('[data-kind="CANDIDATE"] .tgt-tag')).toBeNull();
    const tracked = layer.querySelector('[data-kind="TRACKED"]') as HTMLElement;
    expect(tracked.style.getPropertyValue("--tgt-font")).toBe("9px");
    // The main camera's track never shows in the PiP.
    expect(layer.querySelector('[data-kind="LOCKED"]')).toBeNull();

    fireEvent.click(layer.querySelector('button[data-kind="TRACKED"]') as HTMLElement, { detail: 1 });
    await wait(DOUBLE_CLICK_MS + 30);
    expect(useSelectedTargetStore.getState().popupTarget?.cameraId).toBe("rear");

    // Hiding the PiP keeps the designation.
    unmount();
    expect(useSelectedTargetStore.getState().designated?.trackId).toBe(12);
  });
});
