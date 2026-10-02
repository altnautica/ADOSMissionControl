/**
 * @license GPL-3.0-only
 *
 * A failed AP_Periph OTA hands no disposer back, so it must close the CAN
 * session it opened itself; otherwise the FC stays in CAN forwarding / SLCAN.
 * The run is verified against the published version and refused before
 * BeginFirmwareUpdate when the node names a different board.
 */

import { beforeEach, describe, it, expect, vi } from "vitest";

import { flashApPeriph } from "../flashApPeriph";
import type { ApPeriphManifest } from "@/lib/protocol/firmware/ap-periph-manifest";
import type { DroneProtocol } from "@/lib/protocol/types/protocol";

const sessionClose = vi.fn(async () => undefined);
const start = vi.fn<(opts: unknown) => Promise<void>>();
const getNodeInfo = vi.fn(async () => ({ name: "org.ardupilot.f303-GPS" }));

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
  startDroneCanSession: vi.fn(async () => ({ client: { getNodeInfo }, close: sessionClose })),
}));
vi.mock("@/lib/dronecan/ota", () => ({
  DroneCanOtaOrchestrator: class {
    subscribe = () => () => undefined;
    start = start;
  },
}));

function makeManifest(version: string | null) {
  return {
    downloadFirmware: vi.fn(async () => new Uint8Array([1, 2, 3])),
    getBoardManifest: vi.fn(async () => ({ version })),
  } as unknown as ApPeriphManifest;
}

const baseParams = {
  protocol: {} as DroneProtocol,
  targetNodeId: 42,
  board: "f303-GPS",
  channel: "stable",
  transport: "can-forward" as const,
};

beforeEach(() => {
  sessionClose.mockClear();
  start.mockReset();
  getNodeInfo.mockClear();
});

describe("flashApPeriph", () => {
  it("closes the CAN session when the OTA run fails", async () => {
    start.mockRejectedValueOnce(new Error("node did not answer"));
    await expect(
      flashApPeriph({ ...baseParams, manifest: makeManifest("1.7.0") }),
    ).rejects.toThrow("node did not answer");
    expect(sessionClose).toHaveBeenCalledTimes(1);
  });

  it("asks the OTA to verify the published version", async () => {
    start.mockResolvedValueOnce(undefined);
    await flashApPeriph({ ...baseParams, manifest: makeManifest("1.7.0-dev") });
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ expectedSwVersion: { major: 1, minor: 7 } }),
    );
  });

  it("refuses before BeginFirmwareUpdate when the node names another board", async () => {
    getNodeInfo.mockResolvedValueOnce({ name: "org.ardupilot.MatekL431-GPS" });
    await expect(
      flashApPeriph({ ...baseParams, manifest: makeManifest("1.7.0") }),
    ).rejects.toThrow(/MatekL431-GPS/);
    expect(start).not.toHaveBeenCalled();
    expect(sessionClose).toHaveBeenCalledTimes(1);
  });

  it("refuses to flash an image whose version cannot be verified", async () => {
    await expect(
      flashApPeriph({ ...baseParams, manifest: makeManifest(null) }),
    ).rejects.toThrow(/no version/);
    expect(start).not.toHaveBeenCalled();
  });
});
