import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CockpitTopRight } from "@/components/cockpit/CockpitTopRight";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useVideoStreamsStore } from "@/stores/video-streams-store";
import { useVideoStore } from "@/stores/video-store";
import type { CameraCapability } from "@/lib/agent/feature-types";

function setCameras(cameras: CameraCapability[]) {
  useAgentCapabilitiesStore.setState({ cameras });
}

function pill(): HTMLElement | null {
  return document.querySelector(".camsel");
}

const USB_LIVE: CameraCapability = {
  name: "USB Camera",
  type: "usb",
  resolution: "1920x1080",
  streaming: true,
};
const CSI_IDLE: CameraCapability = {
  name: "CSI Downward",
  type: "csi",
  resolution: "1280x720",
  streaming: false,
};

function renderTopRight() {
  return render(<CockpitTopRight density="standard" onDensity={vi.fn()} />);
}

describe("CockpitTopRight CAM pill", () => {
  beforeEach(() => {
    setCameras([]);
    useVideoStreamsStore.getState().clear();
  });
  afterEach(cleanup);

  it("omits the pill entirely when no camera is advertised (never fabricates 'main')", () => {
    renderTopRight();
    expect(pill()).toBeNull();
    expect(screen.queryByText(/CAM · main/)).toBeNull();
  });

  it("names the real streaming camera and marks it live", () => {
    setCameras([USB_LIVE]);
    renderTopRight();
    const el = pill();
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain("CAM · USB Camera");
    expect(el!.className).not.toContain("idle");
    expect(el!.getAttribute("data-camera-streaming")).toBe("true");
  });

  it("marks an idle-only camera as idle", () => {
    setCameras([CSI_IDLE]);
    renderTopRight();
    const el = pill();
    expect(el!.textContent).toContain("CAM · CSI Downward");
    expect(el!.className).toContain("idle");
    expect(el!.getAttribute("data-camera-streaming")).toBe("false");
  });

  it("prefers the streaming camera and hints the extra count", () => {
    // Idle first, streaming second: the pill must name the streaming one.
    setCameras([CSI_IDLE, USB_LIVE]);
    renderTopRight();
    const el = pill();
    expect(el!.textContent).toContain("CAM · USB Camera");
    expect(el!.textContent).toContain("+1");
  });

  it("omits the pill on a multi-stream node (the switcher owns the indicator)", () => {
    setCameras([USB_LIVE]);
    useVideoStreamsStore.getState().setStreams("node:d1", [
      { id: "eo", index: 1, label: "eo", kind: "concurrent" },
      { id: "ir", index: 2, label: "ir", kind: "concurrent" },
    ]);
    render(
      <CockpitTopRight density="standard" onDensity={vi.fn()} droneId="node:d1" />,
    );
    expect(pill()).toBeNull();
  });
});

describe("CockpitTopRight video stats", () => {
  afterEach(() => {
    cleanup();
    useVideoStore.getState().clearForSelection();
  });

  function statsText(): string {
    return document.querySelector(".vstats")!.textContent ?? "";
  }

  it("shows no-data glyphs while fps and latency are unmeasured", () => {
    useVideoStore.setState({ isStreaming: true, fps: null, latencyMs: null });
    renderTopRight();
    expect(statsText()).toContain("—fps");
    expect(statsText()).toContain("—ms net");
    expect(statsText()).not.toContain("0fps");
  });

  it("shows measured figures once the stats window reports them", () => {
    useVideoStore.setState({ isStreaming: true, fps: 29.6, latencyMs: 41 });
    renderTopRight();
    expect(statsText()).toContain("30fps");
    expect(statsText()).toContain("41ms net");
  });
});
