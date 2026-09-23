/**
 * @module fc/motors/attitude-hud-fresh.test
 * @description The frame view's attitude readout drops a sample older than the
 * staleness window instead of holding the last pose as live.
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { TELEMETRY_STALE_MS } from "@/lib/telemetry/freshness";
import { AttitudeHUD } from "../motor-3d-parts";

const pose = { roll: 12.3, pitch: -4.5, yaw: 90, rollSpeed: 0, pitchSpeed: 0, yawSpeed: 0 };

beforeEach(() => useTelemetryStore.getState().clear());

describe("AttitudeHUD", () => {
  it("shows a fresh attitude", () => {
    useTelemetryStore.getState().pushAttitude({ ...pose, timestamp: Date.now() });
    render(<AttitudeHUD />);
    expect(screen.getByText(/12\.3/)).toBeTruthy();
  });

  it("reads NO TELEMETRY once the last attitude is stale", () => {
    useTelemetryStore.getState().pushAttitude({ ...pose, timestamp: Date.now() - TELEMETRY_STALE_MS - 1000 });
    render(<AttitudeHUD />);
    expect(screen.getByText("NO TELEMETRY")).toBeTruthy();
    expect(screen.queryByText(/12\.3/)).toBeNull();
  });
});
