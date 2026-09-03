/**
 * Tests for the cockpit `video.overlay` host: the letterbox geometry math,
 * that a contributed overlay iframe mounts in the slot, and that the host
 * streams `video.overlay.props` to the overlay when a fresh detection batch
 * lands (mapping the store batch + latest attitude into the props shape).
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, cleanup } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import {
  VideoOverlayHost,
  computeRenderedRect,
} from "@/components/cockpit/VideoOverlayHost";
import type { PluginSlotContribution } from "@/components/plugins/PluginHostProvider";
import { slotToCapability } from "@/lib/plugins/types";
import { useVisionDetectionsStore } from "@/stores/vision-detections-store";
import { useTelemetryStore } from "@/stores/telemetry-store";
import {
  VIDEO_OVERLAY_PROPS_EVENT,
  type VideoOverlayHostProps,
} from "@/lib/plugins/video-overlay-props";

const OVERLAY_CONTRIBUTION: PluginSlotContribution & { slot: "video.overlay" } = {
  pluginId: "com.example.overlay",
  panelId: "main",
  slot: "video.overlay",
  bundleUrl: "blob:overlay",
  grantedCapabilities: new Set([slotToCapability("video.overlay")]),
  handlers: {},
};

interface PostedMessage {
  data: unknown;
}

/** Replace each iframe's contentWindow with a capturing stub. */
function captureIframePosts(container: HTMLElement): PostedMessage[] {
  const posted: PostedMessage[] = [];
  const fakeWindow = {
    postMessage(data: unknown) {
      posted.push({ data });
    },
  } as unknown as Window;
  for (const iframe of Array.from(container.querySelectorAll("iframe"))) {
    Object.defineProperty(iframe, "contentWindow", {
      configurable: true,
      get: () => fakeWindow,
    });
  }
  return posted;
}

describe("computeRenderedRect", () => {
  it("letterboxes a wide stream inside a square wrapper (vertical bars)", () => {
    // 200x100 stream in a 100x100 wrapper -> scale 0.5 -> 100x50 centered.
    const r = computeRenderedRect(100, 100, 200, 100);
    expect(r.width).toBe(100);
    expect(r.height).toBe(50);
    expect(r.left).toBe(0);
    expect(r.top).toBe(25);
  });

  it("falls back to filling the wrapper when the stream size is unknown", () => {
    const r = computeRenderedRect(120, 80, 0, 0);
    expect(r).toEqual({ left: 0, top: 0, width: 120, height: 80 });
  });
});

describe("VideoOverlayHost", () => {
  beforeEach(() => {
    useVisionDetectionsStore.getState().clear();
    useTelemetryStore.getState().clear?.();
  });
  afterEach(() => cleanup());

  it("mounts a contributed overlay iframe in the video.overlay slot", () => {
    const { container } = render(
      <VideoOverlayHost
        droneId="drone-1"
        contributions={[OVERLAY_CONTRIBUTION]}
      />,
    );
    const slot = container.querySelector('[data-plugin-slot="video.overlay"]');
    expect(slot).not.toBeNull();
    expect(container.querySelectorAll("iframe").length).toBe(1);
  });

  it("streams video.overlay.props to the overlay when a fresh batch lands", () => {
    const { container } = render(
      <VideoOverlayHost
        droneId="drone-1"
        contributions={[OVERLAY_CONTRIBUTION]}
      />,
    );
    const posted = captureIframePosts(container);

    // Seed attitude so the coalesced read is non-zero.
    act(() => {
      useTelemetryStore.getState().pushAttitude({
        timestamp: Date.now(),
        roll: 5,
        pitch: -3,
        yaw: 90,
        rollSpeed: 0,
        pitchSpeed: 0,
        yawSpeed: 0,
      });
      // A fresh detection batch drives the push.
      useVisionDetectionsStore.getState().setBatch("drone-1", {
        modelId: "yolo",
        cameraId: "cam0",
        frameId: 7,
        tsMs: 1234,
        frameWidth: 640,
        frameHeight: 480,
        detections: [
          {
            bbox: { x: 10, y: 20, width: 30, height: 40 },
            classLabel: "person",
            confidence: 0.9,
            trackId: 3,
            lockState: "locked",
          },
        ],
      });
    });

    const overlayEvents = posted
      .map((p) => p.data as { method?: string; args?: VideoOverlayHostProps })
      .filter((d) => d.method === VIDEO_OVERLAY_PROPS_EVENT);
    expect(overlayEvents.length).toBeGreaterThan(0);

    const latest = overlayEvents[overlayEvents.length - 1].args!;
    expect(latest.droneId).toBe("drone-1");
    expect(latest.cameraId).toBe("cam0");
    expect(latest.attitude).toEqual({ rollDeg: 5, pitchDeg: -3, yawDeg: 90 });
    expect(latest.detections).not.toBeNull();
    expect(latest.detections!.frameWidth).toBe(640);
    expect(latest.detections!.items[0]).toEqual({
      bbox: { x: 10, y: 20, width: 30, height: 40 },
      classLabel: "person",
      confidence: 0.9,
      trackId: 3,
      lockState: "locked",
    });
  });

  it("collapses a stale attitude to null instead of a wings-level lie", () => {
    const { container } = render(
      <VideoOverlayHost
        droneId="drone-1"
        contributions={[OVERLAY_CONTRIBUTION]}
      />,
    );
    const posted = captureIframePosts(container);

    act(() => {
      // A sample from well beyond TELEMETRY_STALE_MS: the link is gone and
      // the ring is still holding its last value, as a ring should.
      useTelemetryStore.getState().pushAttitude({
        timestamp: Date.now() - 60_000,
        roll: 5,
        pitch: -3,
        yaw: 90,
        rollSpeed: 0,
        pitchSpeed: 0,
        yawSpeed: 0,
      });
      useVisionDetectionsStore.getState().setBatch("drone-1", {
        modelId: "yolo",
        cameraId: "cam0",
        frameId: 8,
        tsMs: 1234,
        frameWidth: 640,
        frameHeight: 480,
        detections: [],
      });
    });

    const events = posted
      .map((p) => p.data as { method?: string; args?: VideoOverlayHostProps })
      .filter((d) => d.method === VIDEO_OVERLAY_PROPS_EVENT);
    expect(events.length).toBeGreaterThan(0);

    // This used to be `roll ?? 0`, which handed every overlay a perfectly
    // wings-level aircraft forever after the link died — the one reading a
    // pilot must never be shown when the attitude is unknown, and the one
    // indistinguishable from a correct reading.
    expect(events[events.length - 1].args!.attitude).toBeNull();
  });
});
