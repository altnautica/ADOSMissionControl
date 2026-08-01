import { describe, it, expect } from "vitest";

import { decodeCameraImageCaptured } from "@/lib/protocol/messages/peripheral";
import { handleCameraImageCaptured } from "@/lib/protocol/handlers/debug-handlers";
import type { CameraImageCapturedCallback } from "@/lib/protocol/types/callbacks";

/**
 * Synthesize a CAMERA_IMAGE_CAPTURED (msg 263) wire payload. Layout:
 * 0 uint64 timeUtcUs, 8 float32[4] q, 24 int32 lat, 28 int32 lon,
 * 32 int32 alt, 36 int32 relativeAlt, 40 uint32 timeBootMs,
 * 44 int32 imageIndex, 48 uint8 cameraId, 49 int8 captureResult,
 * 50 char[205] fileUrl (null-terminated).
 */
function makeCameraPayload(
  cameraId: number,
  captureResult: number,
  imageIndex: number,
  fileUrl: string,
): DataView {
  const buf = new ArrayBuffer(50 + 205);
  const dv = new DataView(buf);
  dv.setUint32(0, 0, true);
  dv.setUint32(4, 0, true);
  for (let i = 0; i < 4; i++) dv.setFloat32(8 + i * 4, 0, true);
  dv.setInt32(24, 0, true);
  dv.setInt32(28, 0, true);
  dv.setInt32(32, 0, true);
  dv.setInt32(36, 0, true);
  dv.setUint32(40, 0, true);
  dv.setInt32(44, imageIndex, true);
  dv.setUint8(48, cameraId);
  dv.setInt8(49, captureResult);
  const bytes = new TextEncoder().encode(fileUrl);
  for (let i = 0; i < bytes.length; i++) dv.setUint8(50 + i, bytes[i]);
  // Remaining fileUrl bytes stay 0 (null terminator + padding).
  return dv;
}

describe("decodeCameraImageCaptured", () => {
  it("decodes cameraId (uint8 @48) and a null-terminated UTF-8 fileUrl @50", () => {
    const dv = makeCameraPayload(3, 1, 7, "IMG_0042.jpg");
    const msg = decodeCameraImageCaptured(dv);
    expect(msg.cameraId).toBe(3);
    expect(msg.captureResult).toBe(1);
    expect(msg.imageIndex).toBe(7);
    expect(msg.fileUrl).toBe("IMG_0042.jpg");
  });

  it("decodes a multi-byte UTF-8 fileUrl and stops at the null terminator", () => {
    const dv = makeCameraPayload(0, 0, 1, "cámara/照片.jpg");
    const msg = decodeCameraImageCaptured(dv);
    expect(msg.fileUrl).toBe("cámara/照片.jpg");
  });

  it("decodes an empty fileUrl when the field is all zeros", () => {
    const dv = new DataView(new ArrayBuffer(50 + 205));
    dv.setUint8(48, 9);
    const msg = decodeCameraImageCaptured(dv);
    expect(msg.cameraId).toBe(9);
    expect(msg.fileUrl).toBe("");
  });
});

describe("handleCameraImageCaptured", () => {
  it("passes cameraId and fileUrl through instead of hardcoding an empty string", () => {
    const dv = makeCameraPayload(5, 0, 2, "IMG_0009.jpg");
    const received: Parameters<CameraImageCapturedCallback>[0][] = [];
    const cb: CameraImageCapturedCallback = (evt) => received.push(evt);

    handleCameraImageCaptured(dv, [cb]);

    expect(received).toHaveLength(1);
    expect(received[0].cameraId).toBe(5);
    expect(received[0].fileUrl).toBe("IMG_0009.jpg");
    expect(received[0].imageIndex).toBe(2);
  });
});
