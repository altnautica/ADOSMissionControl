/**
 * Tests for the per-drone Atlas readiness store: set / get / clear, snapshot
 * expiry, and the `isCapturing(deviceId, now)` helper the node-detail panel
 * reads to decide whether the Live World tab is shown.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useAtlasReadinessStore } from "@/stores/atlas-readiness-store";
import type { AtlasReadiness } from "@/lib/agent/atlas-control-client";

function readiness(overrides: Partial<AtlasReadiness>): AtlasReadiness {
  return {
    enabled: true,
    profile: "drone",
    captureProfile: "balanced",
    reconstructSteps: 30000,
    camerasConfigured: 6,
    poseSource: "local_vio",
    serviceRunning: true,
    capturing: false,
    state: "idle",
    sessionId: null,
    cameraCount: 6,
    keyframes: 0,
    ingestRateHz: 0,
    ...overrides,
  };
}

const NOW = 1_000_000;
/** A polled snapshot still current at NOW. */
const FRESH = NOW + 4_500;

beforeEach(() => {
  useAtlasReadinessStore.setState({ snapshots: {} });
});

describe("atlas-readiness-store", () => {
  it("stores and reads readiness per device id", () => {
    const s = useAtlasReadinessStore.getState();
    s.setReadiness("dev1", readiness({ sessionId: "a" }), FRESH);
    expect(useAtlasReadinessStore.getState().getReadiness("dev1", NOW)?.sessionId).toBe("a");
    expect(useAtlasReadinessStore.getState().getReadiness("dev2", NOW)).toBeNull();
  });

  it("isCapturing reflects the capturing flag, keyed by device", () => {
    const s = useAtlasReadinessStore.getState();
    s.setReadiness("dev1", readiness({ capturing: true }), FRESH);
    s.setReadiness("dev2", readiness({ capturing: false }), FRESH);
    const g = useAtlasReadinessStore.getState();
    expect(g.isCapturing("dev1", NOW)).toBe(true);
    expect(g.isCapturing("dev2", NOW)).toBe(false);
    expect(g.isCapturing("missing", NOW)).toBe(false);
  });

  it("isCapturing derives an active session from state, not just the bool", () => {
    const s = useAtlasReadinessStore.getState();
    // An agent may report capturing:false while paused/finalizing — the Live
    // World tab must stay visible through those states.
    s.setReadiness("paused", readiness({ capturing: false, state: "paused" }), FRESH);
    s.setReadiness("finalizing", readiness({ capturing: false, state: "finalizing" }), FRESH);
    s.setReadiness("bagged", readiness({ capturing: false, state: "bagged" }), FRESH);
    const g = useAtlasReadinessStore.getState();
    expect(g.isCapturing("paused", NOW)).toBe(true);
    expect(g.isCapturing("finalizing", NOW)).toBe(true);
    expect(g.isCapturing("bagged", NOW)).toBe(false);
  });

  it("an expired snapshot is neither readiness nor a capture", () => {
    // The node powered off mid-capture: its last answer said capturing, and
    // nothing has answered since.
    const s = useAtlasReadinessStore.getState();
    s.setReadiness("dev1", readiness({ capturing: true, state: "capturing" }), FRESH);
    const g = useAtlasReadinessStore.getState();
    expect(g.isCapturing("dev1", FRESH - 1)).toBe(true);
    expect(g.isCapturing("dev1", FRESH)).toBe(false);
    expect(g.getReadiness("dev1", FRESH + 60_000)).toBeNull();
  });

  it("a simulated (demo) snapshot never expires", () => {
    useAtlasReadinessStore.getState().setReadiness("demo1", readiness({ capturing: true }), null);
    expect(useAtlasReadinessStore.getState().isCapturing("demo1", Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it("clear drops one device without touching others", () => {
    const s = useAtlasReadinessStore.getState();
    s.setReadiness("dev1", readiness({ capturing: true }), FRESH);
    s.setReadiness("dev2", readiness({ capturing: true }), FRESH);
    useAtlasReadinessStore.getState().clear("dev1");
    const g = useAtlasReadinessStore.getState();
    expect(g.getReadiness("dev1", NOW)).toBeNull();
    expect(g.isCapturing("dev2", NOW)).toBe(true);
  });
});
