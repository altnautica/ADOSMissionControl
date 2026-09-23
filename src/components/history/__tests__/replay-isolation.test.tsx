/**
 * Replay writes into the same telemetry and trail stores the live link feeds.
 * These tests pin the isolation rule: while any vehicle is managed (connected,
 * armed, or with its link down) nothing on the replay path may touch those
 * stores, and the replay surfaces redraw from what playback pushes.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import type { TelemetryFrame, TelemetryRecording } from "@/lib/telemetry-recorder";
import type { StoreApi } from "zustand";
import type { PositionData } from "@/lib/types";
import type { FlightRecord } from "@/lib/types";

const recorder = vi.hoisted(() => ({ loadRecordingFrames: vi.fn<(id: string) => Promise<TelemetryFrame[]>>() }));

vi.mock("@/lib/telemetry-recorder", () => ({
  loadRecordingFrames: recorder.loadRecordingFrames,
  listRecordings: vi.fn(async () => []),
}));

// The managed-vehicle set is the only drone-manager state replay consults.
vi.mock("@/stores/drone-manager", async () => {
  const { create } = await import("zustand");
  return {
    useDroneManager: create(() => ({ drones: new Map<string, unknown>(), selectedDroneId: null as string | null })),
  };
});

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (k: string) => k,
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/components/history/ReplayPlaybackBar", () => ({ ReplayPlaybackBar: () => null }));

import { useDroneManager } from "@/stores/drone-manager";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useTrailStore } from "@/stores/trail-store";
import {
  loadPlayback,
  unloadPlayback,
  play,
  pause,
  resume,
  seek,
  getPlaybackState,
} from "@/lib/telemetry-player";
import { ReplayView } from "@/components/history/ReplayView";
import { ReplayTelemetryPanel } from "@/components/history/ReplayTelemetryPanel";

/** The slice of drone-manager state the mock above carries. */
interface ManagedSet {
  drones: Map<string, unknown>;
  selectedDroneId: string | null;
}
const manager = useDroneManager as unknown as StoreApi<ManagedSet>;

function position(lat: number, relativeAlt: number): PositionData {
  return {
    timestamp: 0,
    lat,
    lon: 77.6,
    alt: 900 + relativeAlt,
    relativeAlt,
    heading: 90,
    groundSpeed: 5,
    airSpeed: 5,
    climbRate: 0,
  };
}

const FRAMES: TelemetryFrame[] = [
  { offsetMs: 0, channel: "position", data: position(12.9, 10) },
  { offsetMs: 500, channel: "position", data: position(12.91, 20) },
  { offsetMs: 1000, channel: "position", data: position(12.92, 30) },
  { offsetMs: 5000, channel: "position", data: position(12.93, 40) },
];

/** The aircraft in front of the operator: armed, so its link state is not "connected". */
const LIVE = position(40.1, 55);

function manageArmedVehicle(): void {
  manager.setState({ drones: new Map([["d1", { id: "d1", armed: true }]]), selectedDroneId: "d1" });
}

function pushLiveSample(): void {
  useTelemetryStore.getState().pushPosition(LIVE);
  useTrailStore.getState().pushPoint(LIVE.lat, LIVE.lon, LIVE.relativeAlt);
}

function expectLiveUntouched(): void {
  expect(useTelemetryStore.getState().position.latest()).toEqual(LIVE);
  expect(useTrailStore.getState()._ring.toArray().map((p) => p.lat)).toEqual([LIVE.lat]);
}

/** Load and pause a recording with no vehicle managed, then bring the armed vehicle up. */
async function pausedReplayThenVehicle(): Promise<void> {
  await loadPlayback("rec-1");
  play();
  pause();
  useTelemetryStore.getState().clear();
  useTrailStore.getState().clear();
  manageArmedVehicle();
  pushLiveSample();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout", "clearTimeout"] });
  recorder.loadRecordingFrames.mockReset();
  recorder.loadRecordingFrames.mockResolvedValue(FRAMES.map((f) => ({ ...f })));
  manager.setState({ drones: new Map(), selectedDroneId: null });
  useTelemetryStore.getState().clear();
  useTrailStore.getState().clear();
});

afterEach(() => {
  cleanup();
  manager.setState({ drones: new Map(), selectedDroneId: null });
  unloadPlayback();
  vi.useRealTimers();
});

describe("replay with a managed vehicle", () => {
  it("refuses to load a recording and leaves the live stores alone", async () => {
    manageArmedVehicle();
    pushLiveSample();
    await expect(loadPlayback("rec-1")).rejects.toThrow(/Disconnect every vehicle/);
    expectLiveUntouched();
  });

  it("refuses to start playback of an armed vehicle's store", async () => {
    await pausedReplayThenVehicle();
    expect(() => play()).toThrow(/Disconnect every vehicle/);
    vi.advanceTimersByTime(2000);
    expectLiveUntouched();
  });

  it("refuses to seek into an armed vehicle's store", async () => {
    await pausedReplayThenVehicle();
    expect(() => seek(1000)).toThrow(/Disconnect every vehicle/);
    expectLiveUntouched();
  });

  it("refuses to resume into an armed vehicle's store", async () => {
    await pausedReplayThenVehicle();
    expect(() => resume()).toThrow(/Disconnect every vehicle/);
    vi.advanceTimersByTime(2000);
    expectLiveUntouched();
  });

  it("stops writing the moment a vehicle is managed mid-playback", async () => {
    await loadPlayback("rec-1");
    play();
    vi.advanceTimersByTime(100);
    manageArmedVehicle();
    pushLiveSample();
    vi.advanceTimersByTime(2000);
    expect(useTelemetryStore.getState().position.latest()).toEqual(LIVE);
    expect(getPlaybackState().state).toBe("paused");
  });

  it("does not clear the live stores when the replay is released", async () => {
    await pausedReplayThenVehicle();
    unloadPlayback();
    expectLiveUntouched();
  });
});

describe("replay surfaces", () => {
  it("rebuilds the map trail from every replayed position up to a seek point", async () => {
    await loadPlayback("rec-1");
    seek(1000);
    expect(useTrailStore.getState()._ring.toArray().map((p) => p.lat)).toEqual([12.9, 12.91, 12.92]);
  });

  it("extends the map trail as playback runs", async () => {
    await loadPlayback("rec-1");
    play();
    vi.advanceTimersByTime(1200);
    expect(useTrailStore.getState()._ring.toArray().map((p) => p.lat)).toEqual([12.9, 12.91, 12.92]);
  });

  it("redraws the telemetry panel as playback pushes samples", async () => {
    await loadPlayback("rec-1");
    render(<ReplayTelemetryPanel />);
    act(() => {
      play();
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByText("ALT").nextElementSibling?.textContent).toContain("10.0");
    // Later samples land in the same ring, so only the version signal moves.
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(screen.getByText("ALT").nextElementSibling?.textContent).toContain("30.0");
  });
});

describe("ReplayView", () => {
  const recording: TelemetryRecording = {
    id: "rec-1",
    name: "Flight",
    startTime: 0,
    endTime: 5000,
    durationMs: 5000,
    frameCount: FRAMES.length,
    channels: ["position"],
  } as TelemetryRecording;
  const flight = { id: "f1", droneName: "Alpha", date: 0, events: [] } as unknown as FlightRecord;

  it("shows the guard's reason and keeps live telemetry when a vehicle is managed", async () => {
    manageArmedVehicle();
    pushLiveSample();
    render(<ReplayView recording={recording} flightRecord={flight} onExit={() => {}} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText(/Disconnect every vehicle/)).toBeTruthy();
    // Shortcuts are not armed in the error state.
    fireEvent.keyDown(window, { key: "Home" });
    fireEvent.keyDown(window, { key: "k" });
    vi.advanceTimersByTime(2000);
    expectLiveUntouched();
    expect(recorder.loadRecordingFrames).not.toHaveBeenCalled();
    cleanup();
    expectLiveUntouched();
  });

  it("gives way to the reason when a vehicle is managed mid-replay", async () => {
    render(<ReplayView recording={recording} flightRecord={flight} onExit={() => {}} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(screen.getByText("ALT")).toBeTruthy();
    act(() => {
      manageArmedVehicle();
      pushLiveSample();
    });
    expect(screen.getByText(/Disconnect every vehicle/)).toBeTruthy();
    expect(screen.queryByText("ALT")).toBeNull();
    fireEvent.keyDown(window, { key: " " });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(useTelemetryStore.getState().position.latest()).toEqual(LIVE);
  });
});
