import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cockpitZoom,
  digitalZoomLabel,
  photoResultText,
  stepZoom,
  takePhoto,
  zoomRoute,
  type CameraDeps,
  type MavlinkCamera,
} from "@/lib/cockpit/camera-actions";
import { useViewZoomStore, type ViewZoom } from "@/components/cockpit/flight/view-zoom-store";

interface Fakes {
  extension?: boolean;
  camera?: Partial<MavlinkCamera> | null;
  frame?: Blob | null;
}

function deps(f: Fakes = {}) {
  const calls: string[] = [];
  let zoom: ViewZoom = 1;
  const camera: MavlinkCamera | null = f.camera
    ? {
        zoom: false,
        capture: async () => {
          calls.push("mavlink.capture");
          return true;
        },
        zoomStep: async (by) => {
          calls.push(`mavlink.zoom ${by}`);
          return true;
        },
        ...f.camera,
      }
    : null;
  const d: CameraDeps = {
    extensionOffers: () => f.extension === true,
    fireExtension: (_id, ids) => {
      if (!f.extension) return false;
      calls.push(`extension ${ids[0]}`);
      return true;
    },
    mavlinkCamera: () => camera,
    grabFrame: async () => {
      calls.push("frame");
      return f.frame === undefined ? new Blob(["png"]) : f.frame;
    },
    digitalZoom: {
      get: () => zoom,
      cycle: () => {
        zoom = zoom === 1 ? 2 : zoom === 2 ? 4 : 1;
      },
      step: (_id, by) => {
        zoom = (by === 1 ? (zoom === 1 ? 2 : 4) : zoom === 4 ? 2 : 1) as ViewZoom;
      },
    },
  };
  return { d, calls };
}

describe("zoom route", () => {
  it("prefers the extension, then the vehicle camera, then digital", () => {
    expect(zoomRoute({ extensionZoom: true, mavlinkCameraZoom: true })).toBe("extension");
    expect(zoomRoute({ extensionZoom: false, mavlinkCameraZoom: true })).toBe("mavlink");
    expect(zoomRoute({ extensionZoom: false, mavlinkCameraZoom: false })).toBe("digital");
  });

  it("labels the digital steps from the spec", () => {
    expect(digitalZoomLabel(1)).toBe("Digital ×1");
    expect(digitalZoomLabel(2)).toBe("Digital ×2");
    expect(digitalZoomLabel(4)).toBe("Digital ×4");
    expect(digitalZoomLabel(3)).toBe("Digital ×2");
  });

  it("steps the extension's zoom over a vehicle camera's", () => {
    const { d, calls } = deps({ extension: true, camera: { zoom: true } });
    expect(stepZoom("d1", 1, d)).toBe("extension");
    expect(stepZoom("d1", -1, d)).toBe("extension");
    expect(calls).toEqual(["extension zoom-in", "extension zoom-out"]);
  });

  it("steps a vehicle camera that advertises zoom; the button steps in", () => {
    const { d, calls } = deps({ camera: { zoom: true } });
    expect(stepZoom("d1", "cycle", d)).toBe("mavlink");
    expect(stepZoom("d1", -1, d)).toBe("mavlink");
    expect(calls).toEqual(["mavlink.zoom 1", "mavlink.zoom -1"]);
  });

  it("falls back to the digital zoom, also for a camera without zoom", () => {
    const { d, calls } = deps({ camera: { zoom: false } });
    expect(stepZoom("d1", "cycle", d)).toEqual({ digital: 2 });
    expect(stepZoom("d1", 1, d)).toEqual({ digital: 4 });
    expect(stepZoom("d1", "cycle", d)).toEqual({ digital: 1 });
    expect(calls).toEqual([]);
  });
});

describe("cockpit zoom on the live view", () => {
  beforeEach(() => useViewZoomStore.setState({ byDrone: {} }));

  it("cycles and steps the shared view zoom without an extension", () => {
    expect(cockpitZoom("d1", "cycle")).toEqual({ digital: 2 });
    expect(cockpitZoom("d1", 1)).toEqual({ digital: 4 });
    expect(cockpitZoom("d1", 1)).toEqual({ digital: 4 });
    expect(cockpitZoom("d1", -1)).toEqual({ digital: 2 });
    expect(useViewZoomStore.getState().byDrone.d1).toBe(2);
  });
});

describe("photo", () => {
  it("uses the extension's capture first", async () => {
    const { d, calls } = deps({ extension: true, camera: {} });
    expect(await takePhoto("d1", d)).toBe("extension");
    expect(calls).toEqual(["extension capture"]);
  });

  it("then the vehicle camera, saying the photo was saved", async () => {
    const { d, calls } = deps({ camera: {} });
    const r = await takePhoto("d1", d);
    expect(r).toBe("mavlink");
    expect(calls).toEqual(["mavlink.capture"]);
    expect(photoResultText(r)).toBe("Photo saved");
  });

  it("grabs the shown frame when the camera refuses or fails", async () => {
    const refused = deps({ camera: { capture: async () => false } });
    expect(await takePhoto("d1", refused.d)).toBe("saved");
    const failed = deps({ camera: { capture: vi.fn().mockRejectedValue(new Error("timeout")) } });
    expect(await takePhoto("d1", failed.d)).toBe("saved");
    expect(failed.calls).toEqual(["frame"]);
  });

  it("grabs the shown frame with no camera at all", async () => {
    const { d, calls } = deps();
    const r = await takePhoto("d1", d);
    expect(r).toBe("saved");
    expect(calls).toEqual(["frame"]);
    expect(photoResultText(r)).toBe("Photo saved");
  });

  it("reads No video with no picture and no camera", async () => {
    const { d } = deps({ frame: null });
    const r = await takePhoto("d1", d);
    expect(r).toBe("no_video");
    expect(photoResultText(r)).toBe("No video");
    expect(photoResultText("extension")).toBeNull();
  });
});
