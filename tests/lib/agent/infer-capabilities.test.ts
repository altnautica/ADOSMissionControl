import { describe, expect, it } from "vitest";

import {
  inferCapabilities,
  type InferHeartbeatExtras,
} from "@/lib/agent/infer-capabilities";
import type { AgentStatus, PeripheralInfo } from "@/lib/agent/types";

const baseStatus: AgentStatus = {
  version: "0.18.4",
  uptime_seconds: 120,
  board: {
    name: "Rock 5C Lite",
    model: "rock-5c-lite",
    tier: 4,
    ram_mb: 16384,
    cpu_cores: 8,
    vendor: "Radxa",
    soc: "RK3582",
    arch: "aarch64",
    hw_video_codecs: [],
  },
  health: {
    cpu_percent: 12,
    memory_percent: 24,
    disk_percent: 33,
    temperature: 48,
    timestamp: new Date(0).toISOString(),
  },
  fc_connected: true,
  fc_port: "/dev/ttyACM0",
  fc_baud: 115200,
};

const lcdPeripheral: PeripheralInfo = {
  name: "Waveshare 3.5\" SPI LCD",
  type: "spi-lcd",
  category: "display",
  bus: "spi0.0",
  address: "spi0.0",
  rate_hz: 0,
  status: "ok",
  last_reading: "",
  extra: {
    controller: "ili9486",
    has_touch: true,
    resolution: "480x320",
    rotation: 0,
  },
};

const fullExtras: InferHeartbeatExtras = {
  lcdActivePage: "video",
  lcdTouchCalibrated: true,
  lcdRotation: 90,
  lcdSnapshotUrl: "http://testnode.local:8080/api/v1/display/snapshot",
  lcdLastTouchAt: 1_700_000_000_000,
  lcdLastGesture: "tap",
  videoLocalDecoderActive: true,
  videoLocalDecoderType: "mppvideodec",
  videoLocalDecoderFps: 30,
  videoRecording: true,
  uiTheme: "dark",
};

describe("inferCapabilities — heartbeat extras", () => {
  it("populates every new field when all heartbeat extras are present", () => {
    const caps = inferCapabilities(baseStatus, [lcdPeripheral], fullExtras);
    expect(caps).not.toBeNull();
    if (!caps) return;

    expect(caps.display).toBeDefined();
    expect(caps.display?.touchCalibrated).toBe(true);
    expect(caps.display?.activePage).toBe("video");
    expect(caps.display?.lastTouchAt).toBe(1_700_000_000_000);
    expect(caps.display?.lastGesture).toBe("tap");
    expect(caps.display?.snapshotUrl).toBe(
      "http://testnode.local:8080/api/v1/display/snapshot",
    );

    expect(caps.videoLocalTap).toEqual({
      active: true,
      decoderType: "mppvideodec",
      fps: 30,
    });
    expect(caps.videoRecording).toBe(true);
    expect(caps.uiTheme).toBe("dark");
  });

  it("leaves every new field undefined when no heartbeat extras are passed", () => {
    const caps = inferCapabilities(baseStatus, [lcdPeripheral]);
    expect(caps).not.toBeNull();
    if (!caps) return;

    expect(caps.display).toBeDefined();
    // Display peripheral exists, so the static fields are present...
    expect(caps.display?.controller).toBe("ili9486");
    expect(caps.display?.hasTouch).toBe(true);
    // ...but every live-state field stays undefined.
    expect(caps.display?.touchCalibrated).toBeUndefined();
    expect(caps.display?.activePage).toBeUndefined();
    expect(caps.display?.lastTouchAt).toBeUndefined();
    expect(caps.display?.lastGesture).toBeUndefined();
    expect(caps.display?.snapshotUrl).toBeUndefined();

    expect(caps.videoLocalTap).toBeUndefined();
    expect(caps.videoRecording).toBeUndefined();
    expect(caps.uiTheme).toBeUndefined();
  });

  it("leaves every new field undefined when an empty extras object is passed", () => {
    const caps = inferCapabilities(baseStatus, [lcdPeripheral], {});
    expect(caps).not.toBeNull();
    if (!caps) return;

    expect(caps.videoLocalTap).toBeUndefined();
    expect(caps.videoRecording).toBeUndefined();
    expect(caps.uiTheme).toBeUndefined();
    expect(caps.display?.activePage).toBeUndefined();
  });

  it("prefers the heartbeat rotation over the peripheral.extra.rotation", () => {
    const caps = inferCapabilities(baseStatus, [lcdPeripheral], {
      lcdRotation: 270,
    });
    expect(caps?.display?.rotation).toBe(270);
  });

  it("falls back to peripheral.extra.rotation when the heartbeat omits rotation", () => {
    const peripheralWithRotation: PeripheralInfo = {
      ...lcdPeripheral,
      extra: { ...lcdPeripheral.extra, rotation: 180 },
    };
    const caps = inferCapabilities(baseStatus, [peripheralWithRotation], {
      lcdActivePage: "dashboard",
    });
    expect(caps?.display?.rotation).toBe(180);
  });

  it("keeps videoLocalTap defined with active=false when the agent pauses the tap", () => {
    const caps = inferCapabilities(baseStatus, [lcdPeripheral], {
      videoLocalDecoderActive: false,
      videoLocalDecoderType: "mppvideodec",
      videoLocalDecoderFps: 0,
    });
    expect(caps?.videoLocalTap).toBeDefined();
    expect(caps?.videoLocalTap?.active).toBe(false);
    expect(caps?.videoLocalTap?.decoderType).toBe("mppvideodec");
    expect(caps?.videoLocalTap?.fps).toBe(0);
  });

  it("rejects an unknown gesture string and leaves lastGesture undefined", () => {
    const caps = inferCapabilities(baseStatus, [lcdPeripheral], {
      lcdLastGesture: "wiggle",
    });
    expect(caps?.display?.lastGesture).toBeUndefined();
  });

  it("rejects a non-dark / non-light theme value", () => {
    const caps = inferCapabilities(baseStatus, [lcdPeripheral], {
      uiTheme: "amoled",
    });
    expect(caps?.uiTheme).toBeUndefined();
  });

  it("does not synthesize a display block when no display peripheral is bound", () => {
    const caps = inferCapabilities(baseStatus, [], fullExtras);
    expect(caps).not.toBeNull();
    if (!caps) return;
    expect(caps.display).toBeUndefined();
    // But the non-display heartbeat fields still flow through.
    expect(caps.videoLocalTap?.active).toBe(true);
    expect(caps.videoRecording).toBe(true);
    expect(caps.uiTheme).toBe("dark");
  });

  it("returns null when the agent status is null (no regression on existing guard)", () => {
    expect(inferCapabilities(null, [lcdPeripheral], fullExtras)).toBeNull();
  });
});
