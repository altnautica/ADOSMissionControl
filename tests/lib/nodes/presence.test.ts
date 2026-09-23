/**
 * `telemetryValue` picks the fresher of a node's streamed telemetry and its
 * heartbeat snapshot, and treats a stream that has gone quiet as absent, so a
 * broker that stopped forwarding cannot keep a node's last armed state and
 * mode on screen or behind the flight controls.
 */
import { describe, expect, it } from "vitest";

import { telemetryValue } from "@/lib/nodes/presence";
import type {
  CommandCloudStatus,
  StreamedTelemetry,
} from "@/stores/command-fleet-store";

const NOW = 1_000_000;

const stream = (receivedAt: number, armed: boolean): StreamedTelemetry => ({
  armed,
  mode: armed ? "AUTO" : "STABILIZE",
  receivedAt,
});

const heartbeat = (updatedAt: number, armed: boolean): CommandCloudStatus => ({
  deviceId: "dev-1",
  updatedAt,
  telemetry: { armed, mode: armed ? "GUIDED" : "LOITER" },
});

describe("telemetryValue", () => {
  it("prefers the stream when it is the fresher source", () => {
    expect(telemetryValue(stream(NOW - 500, true), heartbeat(NOW - 3_000, false), NOW)?.armed).toBe(true);
  });

  it("prefers the heartbeat snapshot when it is newer than the stream", () => {
    expect(telemetryValue(stream(NOW - 3_000, true), heartbeat(NOW - 500, false), NOW)?.armed).toBe(false);
  });

  it("drops a stream that went quiet and falls back to the heartbeat", () => {
    expect(telemetryValue(stream(NOW - 60_000, true), heartbeat(NOW - 90_000, false), NOW)?.armed).toBe(false);
  });

  it("reports nothing when only a quiet stream is left", () => {
    expect(telemetryValue(stream(NOW - 60_000, true), undefined, NOW)).toBeUndefined();
  });

  it("uses a live stream when the heartbeat carries no telemetry", () => {
    const status: CommandCloudStatus = { deviceId: "dev-1", updatedAt: NOW };
    expect(telemetryValue(stream(NOW - 500, true), status, NOW)?.mode).toBe("AUTO");
  });
});
