/**
 * @module protocol/mavlink-camera.test
 * @description The vehicle's MAVLink camera: CAMERA_INFORMATION decoding,
 * the capture and zoom commands, and how the adapter finds the camera and
 * addresses it.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { MAVLinkAdapter } from "../mavlink-adapter";
import { buildFrame } from "../encoders/frame";
import { decodeCameraInformation } from "../messages";
import { handleCameraInformation } from "../handlers/debug-handlers";
import { cmdImageStartCapture, cmdSetCameraZoom, type CommandContext } from "../mavlink-adapter-commands";
import type { CameraInformationCallback, Transport, TransportEventMap } from "../types";
import { useSettingsStore } from "@/stores/settings-store";

const COMMAND_LONG = 76;
const CAMERA_COMPID = 100;

/** A CAMERA_INFORMATION payload with `flags`, full length unless `length` trims it. */
function cameraInformation(flags: number, cameraDeviceId = 0, length = 237): Uint8Array {
  const p = new Uint8Array(237);
  const dv = new DataView(p.buffer);
  dv.setUint32(0, 1234, true);
  dv.setUint32(20, flags, true);
  dv.setUint8(236, cameraDeviceId);
  return p.slice(0, length);
}

describe("CAMERA_INFORMATION", () => {
  it("decodes the capability flags and the camera device id", () => {
    const d = decodeCameraInformation(new DataView(cameraInformation(2 | 64, 3).buffer));
    expect(d).toEqual({ timeBootMs: 1234, flags: 66, cameraDeviceId: 3 });
  });

  it("reads a base-length payload without the extension as device 0", () => {
    const d = decodeCameraInformation(new DataView(cameraInformation(2, 3, 235).buffer));
    expect(d.flags).toBe(2);
    expect(d.cameraDeviceId).toBe(0);
  });

  it("reports still capture and zoom from the flags, with the sending component", () => {
    const got: Parameters<CameraInformationCallback>[0][] = [];
    handleCameraInformation(new DataView(cameraInformation(2).buffer), CAMERA_COMPID, [(d) => got.push(d)]);
    handleCameraInformation(new DataView(cameraInformation(64 | 1).buffer), 1, [(d) => got.push(d)]);
    expect(got.map(({ compId, capture, zoom }) => ({ compId, capture, zoom }))).toEqual([
      { compId: CAMERA_COMPID, capture: true, zoom: false },
      { compId: 1, capture: false, zoom: true },
    ]);
  });
});

describe("camera commands", () => {
  type Sent = { command: number; params: number[]; targetCompId?: number };

  function ctx(sent: Sent[]): CommandContext {
    return {
      sendCommandLong: (command, params, _timeout, targetCompId) => {
        sent.push({ command, params: [...params], targetCompId });
        return Promise.resolve({ success: true, resultCode: 0, message: "ok" });
      },
    } as CommandContext;
  }

  it("captures one image with MAV_CMD_IMAGE_START_CAPTURE and its sequence number", async () => {
    const sent: Sent[] = [];
    await cmdImageStartCapture(ctx(sent), 7, CAMERA_COMPID);
    expect(sent).toEqual([{ command: 2000, params: [0, 0, 1, 7, 0, 0, 0], targetCompId: CAMERA_COMPID }]);
  });

  it("steps the zoom with MAV_CMD_SET_CAMERA_ZOOM, ZOOM_TYPE_STEP", async () => {
    const sent: Sent[] = [];
    await cmdSetCameraZoom(ctx(sent), 1);
    await cmdSetCameraZoom(ctx(sent), -1, CAMERA_COMPID);
    expect(sent).toEqual([
      { command: 531, params: [0, 1, 0, 0, 0, 0, 0], targetCompId: undefined },
      { command: 531, params: [0, -1, 0, 0, 0, 0, 0], targetCompId: CAMERA_COMPID },
    ]);
  });
});

// ── Adapter ─────────────────────────────────────────────────

type Handler = (data: unknown) => void;

class FakeTransport implements Transport {
  readonly type = "websocket" as const;
  isConnected = true;
  canCommand = true;
  readonly sent: Uint8Array[] = [];
  private readonly handlers = new Map<keyof TransportEventMap, Set<Handler>>();

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {
    this.isConnected = false;
  }
  send(data: Uint8Array): void {
    this.sent.push(data);
  }
  on<K extends keyof TransportEventMap>(event: K, handler: (data: TransportEventMap[K]) => void): void {
    const set = this.handlers.get(event) ?? new Set<Handler>();
    set.add(handler as Handler);
    this.handlers.set(event, set);
  }
  off<K extends keyof TransportEventMap>(event: K, handler: (data: TransportEventMap[K]) => void): void {
    this.handlers.get(event)?.delete(handler as Handler);
  }
  emit(bytes: Uint8Array): void {
    for (const h of [...(this.handlers.get("data") ?? [])]) h(bytes);
  }
  /** Every COMMAND_LONG sent, decoded. */
  commands(): { command: number; params: number[]; targetComp: number }[] {
    return this.sent
      .filter((f) => (f[7] | (f[8] << 8) | (f[9] << 16)) === COMMAND_LONG)
      .map((f) => {
        // MAVLink 2 trims trailing zero bytes; restore the 33-byte payload.
        const p = new Uint8Array(33);
        p.set(f.subarray(10, 10 + f[1]));
        const dv = new DataView(p.buffer);
        return {
          command: dv.getUint16(28, true),
          params: Array.from({ length: 7 }, (_, i) => dv.getFloat32(i * 4, true)),
          targetComp: p[31],
        };
      });
  }
}

function heartbeat(type: number, autopilot: number, compId: number): Uint8Array {
  const p = new Uint8Array(9);
  p[4] = type;
  p[5] = autopilot;
  p[8] = 3;
  return buildFrame(0, p, 1, compId, 0);
}

function commandAck(command: number, compId: number): Uint8Array {
  const p = new Uint8Array(10);
  new DataView(p.buffer).setUint16(0, command, true);
  p[8] = 255;
  p[9] = 190;
  return buildFrame(77, p, 1, compId, 0);
}

const open: MAVLinkAdapter[] = [];

async function connected(): Promise<{ adapter: MAVLinkAdapter; link: FakeTransport }> {
  const link = new FakeTransport();
  const adapter = new MAVLinkAdapter();
  open.push(adapter);
  const pending = adapter.connect(link);
  link.emit(heartbeat(2, 3, 1)); // quadrotor, ArduPilot
  await pending;
  return { adapter, link };
}

const cameraRequests = (link: FakeTransport) =>
  link.commands().filter((c) => c.command === 512 && c.params[0] === 259).map((c) => c.targetComp);

beforeEach(() => {
  useSettingsStore.setState({ gcsManagesTelemetryRates: false });
});

afterEach(async () => {
  for (const a of open.splice(0)) await a.disconnect();
});

describe("adapter camera discovery", () => {
  it("asks the autopilot for CAMERA_INFORMATION once on connect", async () => {
    const { link } = await connected();
    expect(cameraRequests(link)).toEqual([1]);
  });

  it("asks a camera component once, when its heartbeat first appears", async () => {
    const { link } = await connected();
    link.emit(heartbeat(30, 8, CAMERA_COMPID));
    link.emit(heartbeat(30, 8, CAMERA_COMPID));
    expect(cameraRequests(link)).toEqual([1, CAMERA_COMPID]);
  });

  it("reports the advertised camera and sends capture and zoom to it", async () => {
    const { adapter, link } = await connected();
    const seen: { compId: number; capture: boolean; zoom: boolean }[] = [];
    adapter.onCameraInformation(({ compId, capture, zoom }) => seen.push({ compId, capture, zoom }));
    link.emit(buildFrame(259, cameraInformation(2 | 64), 1, CAMERA_COMPID, 0));
    expect(seen).toEqual([{ compId: CAMERA_COMPID, capture: true, zoom: true }]);

    const shot = adapter.imageStartCapture();
    link.emit(commandAck(2000, CAMERA_COMPID));
    expect(await shot).toMatchObject({ success: true });
    const zoom = adapter.setCameraZoom(-1);
    link.emit(commandAck(531, CAMERA_COMPID));
    expect(await zoom).toMatchObject({ success: true });
    const second = adapter.imageStartCapture();
    link.emit(commandAck(2000, CAMERA_COMPID));
    expect(await second).toMatchObject({ success: true });

    // Single captures count up from 1 (common.xml, param 4).
    const sent = link.commands().filter((c) => c.command === 2000 || c.command === 531);
    expect(sent).toEqual([
      { command: 2000, params: [0, 0, 1, 1, 0, 0, 0], targetComp: CAMERA_COMPID },
      { command: 531, params: [0, -1, 0, 0, 0, 0, 0], targetComp: CAMERA_COMPID },
      { command: 2000, params: [0, 0, 1, 2, 0, 0, 0], targetComp: CAMERA_COMPID },
    ]);
  });

  it("sends the camera commands to the autopilot until a camera advertises", async () => {
    const { adapter, link } = await connected();
    link.emit(buildFrame(259, cameraInformation(1), 1, CAMERA_COMPID, 0)); // video only
    const zoom = adapter.setCameraZoom(1);
    link.emit(commandAck(531, 1));
    expect(await zoom).toMatchObject({ success: true });
    expect(link.commands().find((c) => c.command === 531)?.targetComp).toBe(1);
  });
});
