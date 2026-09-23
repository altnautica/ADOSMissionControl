/**
 * @module full-status-to-cloud-status.test
 * @description Pins how the LAN-direct `/api/status/full` response maps
 * into the `CommandCloudStatus` row. The air-side camera surface
 * (cameraState + cameraUsbRecovery) must reach a LAN-paired node card the
 * same way the cloud heartbeat path delivers it, with the recovery block
 * validated and absent / malformed values dropped rather than thrown.
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";

import { mapFullStatusToCloudStatus } from "@/lib/agent/full-status-to-cloud-status";
import type { FullStatusResponse } from "@/lib/agent/types";

const node = {
  deviceId: "dev-1",
  mdnsHost: "ados-dev-1.local",
  lastIp: "192.168.1.40",
  name: "Dev 1",
};

function baseResp(overrides: Partial<FullStatusResponse> = {}): FullStatusResponse {
  return {
    version: "0.52.0",
    uptime_seconds: 600,
    board: {
      name: "Pi 4B",
      model: "",
      tier: 2,
      ram_mb: 4096,
      cpu_cores: 4,
      vendor: "",
      soc: "BCM2711",
      arch: "aarch64",
      hw_video_codecs: [],
    },
    health: {
      cpu_percent: 10,
      memory_percent: 30,
      disk_percent: 40,
      temperature: 45,
      timestamp: new Date().toISOString(),
    },
    fc_connected: true,
    fc_port: "/dev/ttyACM0",
    fc_baud: 115200,
    services: [],
    resources: { cpu_percent: 10, memory_percent: 30, disk_percent: 40, temperature: 45 },
    video: { state: "running", whep_url: "http://192.168.1.40:8889/main/whep" },
    telemetry: {},
    ...overrides,
  };
}

describe("mapFullStatusToCloudStatus camera surface", () => {
  it("forwards cameraState + a well-formed cameraUsbRecovery", () => {
    const out = mapFullStatusToCloudStatus(
      baseResp({
        cameraState: "missing",
        cameraUsbRecovery: {
          state: "port_cycling",
          case: "present_wedged",
          attempts: 1,
          cooldownSeconds: 5,
          cameraPresent: false,
          expected: true,
          pppsCapable: true,
          powerContention: false,
          contentionPeer: null,
        },
      }),
      node,
    );
    expect(out.cameraState).toBe("missing");
    expect(out.cameraUsbRecovery?.state).toBe("port_cycling");
    expect(out.cameraUsbRecovery?.case).toBe("present_wedged");
    expect(out.cameraUsbRecovery?.attempts).toBe(1);
    expect(out.cameraUsbRecovery?.expected).toBe(true);
  });

  it("drops an unknown cameraState and an invalid recovery block", () => {
    const out = mapFullStatusToCloudStatus(
      baseResp({
        cameraState: "weird",
        // @ts-expect-error intentionally malformed wire payload
        cameraUsbRecovery: { state: "nope" },
      }),
      node,
    );
    expect(out.cameraState).toBeUndefined();
    expect(out.cameraUsbRecovery).toBeUndefined();
  });

  it("leaves both fields undefined on a legacy response", () => {
    const out = mapFullStatusToCloudStatus(baseResp(), node);
    expect(out.cameraState).toBeUndefined();
    expect(out.cameraUsbRecovery).toBeUndefined();
  });
});

describe("mapFullStatusToCloudStatus FC-link diagnostic", () => {
  it("forwards the gated truth + the fc_link_hint to the fleet row", () => {
    const out = mapFullStatusToCloudStatus(
      baseResp({
        fc_connected: false,
        transport_open: true,
        mavlink_alive: false,
        heartbeat_age_s: null,
        fc_source: "serial",
        fc_link_hint: "msp_detected",
      }),
      node,
    );
    expect(out.transportOpen).toBe(true);
    expect(out.mavlinkAlive).toBe(false);
    expect(out.heartbeatAgeS).toBeNull();
    expect(out.fcSource).toBe("serial");
    expect(out.fcLinkHint).toBe("msp_detected");
  });

  it("leaves fcLinkHint undefined on a legacy response", () => {
    const out = mapFullStatusToCloudStatus(baseResp(), node);
    expect(out.fcLinkHint).toBeUndefined();
  });
});
