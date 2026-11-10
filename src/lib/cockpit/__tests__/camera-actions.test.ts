import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  LIVE_CAMERA_DEPS,
  cockpitZoom,
  digitalZoomLabel,
  mavlinkCameraFor,
  photoResultText,
  stepZoom,
  takePhoto,
  zoomRoute,
  type CameraAnswer,
  type CameraDeps,
  type MavlinkCamera,
} from "@/lib/cockpit/camera-actions";
import { useViewZoomStore, type ViewZoom } from "@/components/cockpit/flight/view-zoom-store";
import {
  VEHICLE_ZOOM_STEPS,
  nextVehicleZoom,
  useMavlinkCameraStore,
  type VehicleZoomPosition,
} from "@/stores/mavlink-camera-store";
import { useDroneManager } from "@/stores/drone-manager";
import type { CommandResult, DroneProtocol } from "@/lib/protocol/types";

const ACCEPTED: CameraAnswer = { ok: true, answered: true, reason: "" };

interface Fakes {
  extension?: boolean;
  camera?: Partial<MavlinkCamera> | null;
  frame?: Blob | null;
}

function deps(f: Fakes = {}) {
  const calls: string[] = [];
  const failures: string[] = [];
  let zoom: ViewZoom = 1;
  let vehicle: VehicleZoomPosition = { steps: 0, dir: 1 };
  const camera: MavlinkCamera | null = f.camera
    ? {
        zoom: false,
        capture: async () => {
          calls.push("mavlink.capture");
          return ACCEPTED;
        },
        zoomStep: async (by) => {
          calls.push(`mavlink.zoom ${by}`);
          return ACCEPTED;
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
    vehicleZoom: {
      next: () => vehicle.dir,
      moved: (_id, by) => {
        vehicle = nextVehicleZoom(vehicle, by);
      },
    },
    zoomFailed: (reason) => failures.push(reason),
  };
  return { d, calls, failures };
}

/** Let the zoom's answer settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

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

  it("steps a vehicle camera that advertises zoom", async () => {
    const { d, calls } = deps({ camera: { zoom: true } });
    expect(stepZoom("d1", 1, d)).toBe("mavlink");
    expect(stepZoom("d1", -1, d)).toBe("mavlink");
    await settle();
    expect(calls).toEqual(["mavlink.zoom 1", "mavlink.zoom -1"]);
  });

  it("cycles a vehicle camera in to the end of its travel, then back out", async () => {
    const { d, calls } = deps({ camera: { zoom: true } });
    for (let i = 0; i < 2 * VEHICLE_ZOOM_STEPS + 1; i += 1) {
      expect(stepZoom("d1", "cycle", d)).toBe("mavlink");
      await settle();
    }
    const steps = calls.map((c) => Number(c.split(" ")[1]));
    expect(steps).toEqual([
      ...Array<number>(VEHICLE_ZOOM_STEPS).fill(1),
      ...Array<number>(VEHICLE_ZOOM_STEPS).fill(-1),
      1,
    ]);
  });

  it("holds the cycle's position when the camera refuses a step, and says why", async () => {
    const { d, calls, failures } = deps({
      camera: {
        zoom: true,
        zoomStep: async (by) => {
          calls.push(`mavlink.zoom ${by}`);
          return { ok: false, answered: true, reason: "Denied" };
        },
      },
    });
    stepZoom("d1", "cycle", d);
    await settle();
    stepZoom("d1", "cycle", d);
    await settle();
    expect(calls).toEqual(["mavlink.zoom 1", "mavlink.zoom 1"]);
    expect(failures).toEqual(["Denied", "Denied"]);
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

  it("says the photo failed, with the camera's reason, when the camera refuses", async () => {
    const { d, calls } = deps({
      camera: {
        capture: async () => {
          calls.push("mavlink.capture");
          return { ok: false, answered: true, reason: "Denied" };
        },
      },
    });
    const r = await takePhoto("d1", d);
    expect(r).toEqual({ failed: "Denied" });
    expect(calls).toEqual(["mavlink.capture"]);
    expect(photoResultText(r)).toBe("Photo failed: Denied");
  });

  it("grabs the shown frame only when no camera answered", async () => {
    const silent = deps({ camera: { capture: async () => ({ ok: false, answered: false, reason: "timed out" }) } });
    expect(await takePhoto("d1", silent.d)).toBe("saved");
    expect(silent.calls).toEqual(["frame"]);
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

describe("the live vehicle camera", () => {
  function cameraProtocol(result: CommandResult = { success: true, resultCode: 0, message: "" }) {
    const sent: string[] = [];
    const protocol = {
      imageStartCapture: async () => {
        sent.push("capture");
        return result;
      },
      setCameraZoom: async (step: 1 | -1) => {
        sent.push(`zoom ${step}`);
        return result;
      },
    } as Partial<DroneProtocol> as DroneProtocol;
    return { protocol, sent };
  }

  function connect(protocol: DroneProtocol) {
    useDroneManager.setState({ drones: new Map([["d1", { protocol }]]) } as never);
  }

  beforeEach(() => {
    useMavlinkCameraStore.setState({ byDrone: {}, zoomByDrone: {} });
    useDroneManager.setState({ drones: new Map() });
  });

  it("is absent until the drone advertises a camera", () => {
    connect(cameraProtocol().protocol);
    expect(LIVE_CAMERA_DEPS.mavlinkCamera("d1")).toBeNull();
    useMavlinkCameraStore.getState().setCamera("d1", { capture: false, zoom: false });
    expect(LIVE_CAMERA_DEPS.mavlinkCamera("d1")).toBeNull();
  });

  it("is absent when the advertising drone is not connected", () => {
    useMavlinkCameraStore.getState().setCamera("d1", { capture: true, zoom: true });
    expect(LIVE_CAMERA_DEPS.mavlinkCamera("d1")).toBeNull();
  });

  it("captures and zooms through the drone's protocol once advertised", async () => {
    const { protocol, sent } = cameraProtocol();
    connect(protocol);
    useMavlinkCameraStore.getState().setCamera("d1", { capture: true, zoom: true });
    const cam = LIVE_CAMERA_DEPS.mavlinkCamera("d1");
    expect(cam?.zoom).toBe(true);
    expect(await cam?.capture()).toEqual(ACCEPTED);
    expect(await cam?.zoomStep(-1)).toEqual(ACCEPTED);
    expect(sent).toEqual(["capture", "zoom -1"]);
  });

  it("sends only what the camera advertised, and reports a refusal with its reason", async () => {
    const { protocol, sent } = cameraProtocol({ success: false, resultCode: 4, message: "Failed" });
    const captureOnly = mavlinkCameraFor({ capture: true, zoom: false }, protocol);
    expect(captureOnly?.zoom).toBe(false);
    expect(await captureOnly?.zoomStep(1)).toMatchObject({ ok: false, answered: false });
    expect(await captureOnly?.capture()).toEqual({ ok: false, answered: true, reason: "Failed" });
    expect(sent).toEqual(["capture"]);
  });

  it("tells an unanswered command from a refusal", async () => {
    const { protocol } = cameraProtocol({ success: false, resultCode: -1, message: "Command 2000 timed out after 3000ms" });
    const cam = mavlinkCameraFor({ capture: true, zoom: true }, protocol);
    expect(await cam?.capture()).toEqual({ ok: false, answered: false, reason: "Command 2000 timed out after 3000ms" });
  });

  it("is absent for a protocol without the camera commands", () => {
    expect(mavlinkCameraFor({ capture: true, zoom: true }, {} as DroneProtocol)).toBeNull();
  });

  it("keeps the cycle's position per drone and drops it with the camera", () => {
    const s = useMavlinkCameraStore.getState();
    s.setCamera("d1", { capture: false, zoom: true });
    for (let i = 0; i < VEHICLE_ZOOM_STEPS; i += 1) LIVE_CAMERA_DEPS.vehicleZoom.moved("d1", 1);
    expect(LIVE_CAMERA_DEPS.vehicleZoom.next("d1")).toBe(-1);
    expect(LIVE_CAMERA_DEPS.vehicleZoom.next("d2")).toBe(1);
    useMavlinkCameraStore.getState().clear("d1");
    expect(LIVE_CAMERA_DEPS.vehicleZoom.next("d1")).toBe(1);
  });
});
