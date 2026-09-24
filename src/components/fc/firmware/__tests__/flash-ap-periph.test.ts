/**
 * @license GPL-3.0-only
 *
 * A failed AP_Periph OTA hands no disposer back, so it must close the CAN
 * session it opened itself; otherwise the FC stays in CAN forwarding / SLCAN.
 */

import { describe, it, expect, vi } from "vitest";

import { flashApPeriph } from "../flashApPeriph";
import type { ApPeriphManifest } from "@/lib/protocol/firmware/ap-periph-manifest";
import type { DroneProtocol } from "@/lib/protocol/types/protocol";

const sessionClose = vi.fn(async () => undefined);
const start = vi.fn<() => Promise<void>>();

vi.mock("@/lib/protocol/transport/can-transport", () => ({
  MavlinkCanForwardTransport: class {
    open = vi.fn(async () => undefined);
  },
}));
vi.mock("@/lib/protocol/transport/slcan-flash-arbiter", () => ({
  enterSlcanMode: vi.fn(),
  SLCAN_TIMEOUT_MAX_S: 127,
}));
vi.mock("@/lib/dronecan/session", () => ({
  startDroneCanSession: vi.fn(async () => ({ client: {}, close: sessionClose })),
}));
vi.mock("@/lib/dronecan/ota", () => ({
  DroneCanOtaOrchestrator: class {
    subscribe = () => () => undefined;
    start = start;
  },
}));

const manifest: Pick<ApPeriphManifest, "downloadFirmware"> = {
  downloadFirmware: vi.fn(async () => new Uint8Array([1, 2, 3])),
};

describe("flashApPeriph", () => {
  it("closes the CAN session when the OTA run fails", async () => {
    start.mockRejectedValueOnce(new Error("node did not answer"));
    await expect(
      flashApPeriph({
        protocol: {} as DroneProtocol,
        targetNodeId: 42,
        board: "f303",
        channel: "stable",
        manifest: manifest as ApPeriphManifest,
        transport: "can-forward",
      }),
    ).rejects.toThrow("node did not answer");
    expect(sessionClose).toHaveBeenCalledTimes(1);
  });
});
