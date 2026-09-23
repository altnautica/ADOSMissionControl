import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CockpitCameraRoster } from "@/components/vision/CockpitCameraRoster";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import type { CameraCapability } from "@/lib/agent/feature-types";
import { normalizeCapabilities } from "@/stores/agent-capabilities/normalizer";

function setCameras(cameras: CameraCapability[]) {
  useAgentCapabilitiesStore.setState({ cameras });
}

function roster(): HTMLElement | null {
  return document.querySelector('[data-cockpit-widget="camera-roster"]');
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

describe("CockpitCameraRoster", () => {
  beforeEach(() => setCameras([]));
  afterEach(cleanup);

  it("renders nothing with no cameras", () => {
    render(<CockpitCameraRoster />);
    expect(roster()).toBeNull();
  });

  it("renders nothing with a single camera (the CAM pill covers it)", () => {
    setCameras([USB_LIVE]);
    render(<CockpitCameraRoster />);
    expect(roster()).toBeNull();
  });

  it("lists a row per real camera once there are two or more", () => {
    setCameras([USB_LIVE, CSI_IDLE]);
    render(<CockpitCameraRoster />);
    expect(roster()).not.toBeNull();
    expect(roster()!.querySelectorAll(".crow")).toHaveLength(2);
    expect(screen.getByText("USB Camera")).toBeTruthy();
    expect(screen.getByText("CSI Downward")).toBeTruthy();
  });

  it("badges live vs idle from the agent's real streaming flag", () => {
    setCameras([USB_LIVE, CSI_IDLE]);
    render(<CockpitCameraRoster />);
    const rows = roster()!.querySelectorAll(".crow");
    // The streaming camera reads Live; the idle one reads Idle — no fabrication.
    expect(rows[0].className).toContain("live");
    expect(rows[0].getAttribute("data-streaming")).toBe("true");
    expect(rows[0].textContent).toContain("Live");
    expect(rows[1].className).not.toContain("live");
    expect(rows[1].getAttribute("data-streaming")).toBe("false");
    expect(rows[1].textContent).toContain("Idle");
  });

  it("shows the type and resolution sub-line when present", () => {
    setCameras([USB_LIVE, CSI_IDLE]);
    render(<CockpitCameraRoster />);
    expect(screen.getByText("USB · 1920x1080")).toBeTruthy();
    expect(screen.getByText("CSI · 1280x720")).toBeTruthy();
  });
  it("reads Unknown, not Live, for a detected camera with no reported streaming flag", () => {
    const caps = normalizeCapabilities({
      tier: 4,
      cameras: [
        { name: "USB Camera", type: "usb", resolution: "1920x1080", streaming: true },
        { name: "CSI Downward", type: "csi" },
      ],
    });
    setCameras(caps.cameras);
    render(<CockpitCameraRoster />);
    const rows = roster()!.querySelectorAll(".crow");
    expect(rows[1].className).not.toContain("live");
    expect(rows[1].textContent).toContain("Unknown");
    expect(rows[1].textContent).not.toContain("unknown ·");
  });
});
