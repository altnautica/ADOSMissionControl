/**
 * @module status-mapper-transforms.test
 * @description Pins the cloud→UI transforms beyond the install-health
 * surface: the video / MAVLink URL fallback cascades, the System-tab
 * resource forwarding, the ground-station patch builder, and the
 * heartbeat-extras coercion. These run on every heartbeat tick, so a
 * regression here silently breaks video connect, the System tab, or the
 * ground-station fan-out.
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";

import {
  buildGroundStationPatch,
  buildHeartbeatExtras,
  buildSystemUpdate,
  mapCloudStatus,
  resolveMavlinkUrl,
  resolveVideoUrls,
  type GroundStationFanOutCurrent,
} from "@/components/command/bridges/status-mapper";

const base = {
  deviceId: "dev-1",
  version: "0.39.0",
  uptimeSeconds: 600,
  updatedAt: 1_700_000_000_000,
};

describe("resolveVideoUrls", () => {
  it("prefers an IPv4 host over a .local absolute URL when running", () => {
    const out = resolveVideoUrls(
      {
        videoState: "running",
        videoWhepUrl: "http://skynode.local:8889/main/whep",
        lastIp: "192.168.1.50",
      },
      "skynode.local",
    );
    expect(out.state).toBe("running");
    expect(out.whepUrl).toBe("http://192.168.1.50:8889/main/whep");
  });

  it("leaves an already-IPv4 absolute URL untouched", () => {
    const out = resolveVideoUrls(
      {
        videoState: "running",
        videoWhepUrl: "http://10.0.0.7:8889/main/whep",
      },
      null,
    );
    expect(out.whepUrl).toBe("http://10.0.0.7:8889/main/whep");
  });

  it("builds a WHEP URL from lastIp + port when no absolute URL is present", () => {
    const out = resolveVideoUrls(
      {
        videoState: "running",
        lastIp: "192.168.1.51",
        videoWhepPort: 9001,
      },
      "skynode.local",
    );
    expect(out.whepUrl).toBe("http://192.168.1.51:9001/main/whep");
  });

  it("falls back to the LAN host on the stable :8889 default", () => {
    const out = resolveVideoUrls(
      { videoState: "running" },
      "skynode.local",
    );
    expect(out.whepUrl).toBe("http://skynode.local:8889/main/whep");
  });

  it("returns a null WHEP URL when the pipeline is not running", () => {
    const out = resolveVideoUrls(
      {
        videoState: "stopped",
        videoWhepUrl: "http://10.0.0.7:8889/main/whep",
        lastIp: "10.0.0.7",
      },
      "skynode.local",
    );
    expect(out.state).toBe("stopped");
    expect(out.whepUrl).toBeNull();
    expect(out.lanHost).toBe("skynode.local");
  });

  it("ignores a zero / missing WHEP port and a null LAN host", () => {
    const out = resolveVideoUrls(
      { videoState: "running", lastIp: "10.0.0.7", videoWhepPort: 0 },
      null,
    );
    expect(out.whepUrl).toBeNull();
  });
});

describe("resolveMavlinkUrl", () => {
  it("prefers the heartbeat-published WS URL, IPv4-resolved", () => {
    const out = resolveMavlinkUrl(
      {
        mavlinkWsUrl: "ws://skynode.local:8765/",
        lastIp: "192.168.1.50",
      },
      "skynode.local",
    );
    expect(out.url).toBe("ws://192.168.1.50:8765/");
  });

  it("builds ws:// from lastIp + port when no URL is published", () => {
    const out = resolveMavlinkUrl(
      { lastIp: "192.168.1.52", mavlinkWsPort: 8770 },
      "skynode.local",
    );
    expect(out.url).toBe("ws://192.168.1.52:8770/");
  });

  it("falls back to the LAN host on the stable :8765 default", () => {
    const out = resolveMavlinkUrl({}, "skynode.local");
    expect(out.url).toBe("ws://skynode.local:8765/");
  });

  it("returns null when no URL, port hint, or LAN host is available", () => {
    const out = resolveMavlinkUrl({}, null);
    expect(out.url).toBeNull();
  });

  it("ignores a zero MAVLink port and falls through to the LAN host", () => {
    const out = resolveMavlinkUrl(
      { lastIp: "192.168.1.52", mavlinkWsPort: 0 },
      "skynode.local",
    );
    expect(out.url).toBe("ws://skynode.local:8765/");
  });
});

describe("buildSystemUpdate", () => {
  it("forwards cpu/mem/temp from the mapped status and resource fields from the row", () => {
    const cloudStatus = {
      ...base,
      cpuPercent: 42,
      memoryPercent: 55,
      diskPercent: 30,
      temperature: 47.5,
      memoryUsedMb: 600,
      memoryTotalMb: 1024,
      memoryAvailableMb: 424,
      diskUsedGb: 8,
      diskTotalGb: 32,
    };
    const mapped = mapCloudStatus(cloudStatus);
    const update = buildSystemUpdate(mapped, cloudStatus, true);
    expect(update.stale).toBe(false);
    expect(update.lastUpdatedAt).toBe(base.updatedAt);
    expect(update.resources.cpu_percent).toBe(42);
    expect(update.resources.memory_percent).toBe(55);
    expect(update.resources.disk_percent).toBe(30);
    expect(update.resources.temperature).toBe(47.5);
    expect(update.resources.memory_used_mb).toBe(600);
    expect(update.resources.memory_total_mb).toBe(1024);
    expect(update.resources.disk_total_gb).toBe(32);
  });

  it("tolerates missing resource fields without producing NaN", () => {
    const cloudStatus = { ...base };
    const mapped = mapCloudStatus(cloudStatus);
    const update = buildSystemUpdate(mapped, cloudStatus, false);
    expect(update.stale).toBe(true);
    for (const v of Object.values(update.resources)) {
      if (typeof v === "number") expect(Number.isNaN(v)).toBe(false);
    }
    expect(update.resources.memory_used_mb).toBe(0);
    expect(update.resources.swap_percent).toBe(0);
    expect(update.resources.temperature).toBeNull();
    // No history / services / logs blocks when the row omits them.
    expect(update.cpuHistory).toBeUndefined();
    expect(update.services).toBeUndefined();
    expect(update.logs).toBeUndefined();
  });

  it("reports an unknown service status as degraded and carries process metrics", () => {
    const cloudStatus = {
      ...base,
      services: [
        { name: "ados-supervisor", status: "running", pid: 100, cpuPercent: 1.2, memoryMb: 30, uptimeSeconds: 500 },
        { name: "ados-mystery", status: "bogus", pid: 101 },
        { name: "ados-nopid", status: "stopped" },
      ],
      processCpuPercent: 3.5,
      processMemoryMb: 120,
    };
    const mapped = mapCloudStatus(cloudStatus);
    const update = buildSystemUpdate(mapped, cloudStatus, true);
    expect(update.services).toHaveLength(3);
    expect(update.services?.[0].status).toBe("running");
    // An unrecognised status reads as degraded, never as stopped: claiming a
    // service is down because we did not recognise its state would fabricate a
    // negative. The pid is preserved verbatim.
    expect(update.services?.[1].status).toBe("degraded");
    expect(update.services?.[1].cpu_percent).toBe(0);
    expect(update.services?.[1].pid).toBe(101);
    // A service with no pid falls back to null.
    expect(update.services?.[2].pid).toBeNull();
    expect(update.processCpuPercent).toBe(3.5);
    expect(update.processMemoryMb).toBe(120);
  });

  it("forwards per-service config errors and drops malformed entries", () => {
    const cloudStatus = {
      ...base,
      configErrors: [
        { service: "ados-video", error: "invalid type: string, expected u32" },
        { service: "ados-atlas", error: "missing field `camera`" },
        { service: "ados-broken" }, // no error → dropped
        { error: "orphan error" }, // no service → dropped
        "not-an-object", // wrong shape → dropped
      ],
    };
    const mapped = mapCloudStatus(cloudStatus);
    const update = buildSystemUpdate(mapped, cloudStatus, true);
    expect(update.configErrors).toEqual([
      { service: "ados-video", error: "invalid type: string, expected u32" },
      { service: "ados-atlas", error: "missing field `camera`" },
    ]);
  });

  it("maps an absent configErrors field to an empty list (clears prior errors)", () => {
    const cloudStatus = { ...base };
    const mapped = mapCloudStatus(cloudStatus);
    const update = buildSystemUpdate(mapped, cloudStatus, true);
    expect(update.configErrors).toEqual([]);
  });
});

describe("buildGroundStationPatch", () => {
  const current: GroundStationFanOutCurrent = {
    linkHealth: {
      rssi_dbm: null,
      bitrate_mbps: null,
      fec_rec: 0,
      fec_lost: 0,
      channel: null,
    },
    status: { paired_drone: null, profile: "", uplink_active: null },
    role: { info: null },
    uplink: { active: null, cloud_relay: null },
    peripherals: { list: [] },
  };

  it("returns null when the agent is not a ground station", () => {
    expect(buildGroundStationPatch({ profile: "drone" }, current)).toBeNull();
    expect(buildGroundStationPatch({}, current)).toBeNull();
  });

  it("maps radio link health and pair status, normalising kbps to mbps", () => {
    const patch = buildGroundStationPatch(
      {
        profile: "ground-station",
        radio: {
          rssiDbm: -53,
          bitrateKbps: 5700,
          fecRecovered: 4,
          fecLost: 1,
          channel: 149,
          pairedWithDeviceId: "ados-drone1",
        },
        wfbFailoverState: "local",
      },
      current,
    );
    expect(patch).not.toBeNull();
    const linkHealth = patch?.linkHealth as Record<string, unknown>;
    expect(linkHealth.rssi_dbm).toBe(-53);
    expect(linkHealth.bitrate_mbps).toBe(5.7);
    expect(linkHealth.fec_rec).toBe(4);
    expect(linkHealth.channel).toBe(149);
    const status = patch?.status as Record<string, unknown>;
    expect(status.paired_drone).toBe("ados-drone1");
    expect(status.profile).toBe("ground_station");
    expect(status.uplink_active).toBe("local");
  });

  it("maps the role and uplink blocks, accepting the snake_case profile alias", () => {
    const patch = buildGroundStationPatch(
      {
        profile: "ground_station",
        role: "relay",
        wfbFailoverState: "cloud_relay",
      },
      current,
    );
    const role = (patch?.role as Record<string, unknown>).info as Record<string, unknown>;
    expect(role.current).toBe("relay");
    expect(role.configured).toBe("relay");
    expect(role.supported).toEqual(["direct", "relay", "receiver"]);
    expect((patch?.uplink as Record<string, unknown>).active).toBe("cloud_relay");
  });

  it("maps the cloud-relay forwarding state from a relaying ground station", () => {
    const patch = buildGroundStationPatch(
      {
        profile: "ground-station",
        uplink: "eth0",
        mqttConnected: true,
        throttleState: "throttle_95",
        forwardingVideo: false,
        forwardingTelemetry: true,
      },
      current,
    );
    const uplink = patch?.uplink as Record<string, unknown>;
    expect(uplink.active).toBe("eth0");
    const relay = uplink.cloud_relay as Record<string, unknown>;
    expect(relay.mqtt_connected).toBe(true);
    expect(relay.throttle_state).toBe("throttle_95");
    expect(relay.forwarding_video).toBe(false);
    expect(relay.forwarding_telemetry).toBe(true);
  });

  it("returns null when a ground station sends no patchable fields", () => {
    // No radio/role/uplink/peripherals → nothing to patch even though it
    // is a ground station, so the builder returns null.
    const patch = buildGroundStationPatch({ profile: "ground-station" }, current);
    expect(patch).toBeNull();
  });
});

describe("buildHeartbeatExtras", () => {
  it("returns safe defaults for an older agent that omits the extras", () => {
    const extras = buildHeartbeatExtras({ ...base });
    expect(extras.videoRestartAttempts).toBe(0);
    expect(extras.pairingCodeExpiresAt).toBeNull();
    expect(extras.mavlinkWsUrlPrev).toBeNull();
    // Unknown / absent failover state clamps to the local default.
    expect(extras.wfbFailoverState).toBe("local");
    expect(extras.manualConnectionUrls).toBeNull();
    expect(extras.cloudRelayUrl).toBeNull();
    expect(extras.macStability).toBeUndefined();
    expect(extras.managementLink).toBeUndefined();
    expect(extras.wifiPowersave).toBeUndefined();
    expect(extras.cameraState).toBeNull();
    expect(extras.peerChannel).toBeNull();
  });

  it("coerces and clamps populated heartbeat fields", () => {
    const extras = buildHeartbeatExtras({
      ...base,
      videoRestartAttempts: 3.9,
      pairingCodeExpiresAt: 1_700_000_500_000,
      wfbFailoverState: "cloud_relay",
      cloudRelayUrl: "https://relay.example/abc",
      cameraState: "ready",
      peerDeviceId: "ados-peer01",
      peerChannel: 149,
      manualConnectionUrls: {
        mavlinkTcp: "tcp://10.0.0.7:5760",
        mavlinkWs: "",
        videoViewer: null,
      },
    });
    // 3.9 floors to 3, not rounded.
    expect(extras.videoRestartAttempts).toBe(3);
    expect(extras.pairingCodeExpiresAt).toBe(1_700_000_500_000);
    expect(extras.wfbFailoverState).toBe("cloud_relay");
    expect(extras.cloudRelayUrl).toBe("https://relay.example/abc");
    expect(extras.cameraState).toBe("ready");
    expect(extras.peerDeviceId).toBe("ados-peer01");
    expect(extras.peerChannel).toBe(149);
    // Empty / null sub-fields collapse to null.
    expect(extras.manualConnectionUrls?.mavlinkTcp).toBe("tcp://10.0.0.7:5760");
    expect(extras.manualConnectionUrls?.mavlinkWs).toBeNull();
    expect(extras.manualConnectionUrls?.videoViewer).toBeNull();
  });

  it("drops a malformed cameraState and clamps a negative restart count", () => {
    const extras = buildHeartbeatExtras({
      ...base,
      cameraState: "exploded",
      videoRestartAttempts: -2,
    });
    expect(extras.cameraState).toBeNull();
    // A negative restart count is rejected back to 0.
    expect(extras.videoRestartAttempts).toBe(0);
  });
});
