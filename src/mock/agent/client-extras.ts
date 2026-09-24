/**
 * @module mock/agent/client-extras
 * @description The part of the `AgentClient` surface demo mode answers with
 * "not reported" rather than invented readings: version and capability
 * probes, the consolidated status, display and touch calibration, the video
 * pipeline, the clock and recording. `MockAgentClient` extends this so the
 * demo client carries every public `AgentClient` method; the parity is
 * pinned by `tests/unit/mock-agent-client-parity.test.ts`.
 *
 * Nullable reads resolve `null`, the same answer an agent that predates the
 * route gives, so every caller takes its existing "not reported" path.
 * @license GPL-3.0-only
 */

import type {
  AgentVersionInfo,
  FullStatusResponse,
  TelemetrySnapshot,
  VideoStatus,
} from "@/lib/agent/types";
import type {
  TouchCalibrationStart,
  TouchCalibrationStatus,
} from "@/lib/agent/agent-client/setup";
import type {
  RecordingControlResponse,
  RecordingListResponse,
} from "@/lib/agent/agent-client/types";
import { delay } from "./utils";

/** Simulated round trip, the same order as the rest of the demo client. */
const DEMO_LATENCY_MS = 60;

/** The demo vehicle sits on the ground, disarmed, with no GPS fix. */
const DEMO_TELEMETRY: TelemetrySnapshot = {
  lat: 0,
  lon: 0,
  alt: 0,
  relative_alt: 0,
  heading: 0,
  groundspeed: 0,
  airspeed: 0,
  roll: 0,
  pitch: 0,
  yaw: 0,
  battery_voltage: 0,
  battery_current: 0,
  battery_remaining: 0,
  gps_fix: 0,
  satellites: 0,
  mode: "STABILIZE",
  armed: false,
};

export class MockAgentClientExtras {
  private demoRecording: { filename: string; startedAt: number } | null = null;

  async getVersion(_opts?: { force?: boolean }): Promise<AgentVersionInfo | null> {
    await delay(DEMO_LATENCY_MS);
    return null;
  }

  async supports(_capability: string): Promise<boolean> {
    return false;
  }

  async getTelemetry(): Promise<TelemetrySnapshot> {
    await delay(DEMO_LATENCY_MS);
    return { ...DEMO_TELEMETRY };
  }

  async getParams(): Promise<Record<string, number>> {
    await delay(DEMO_LATENCY_MS);
    return {};
  }

  /** `null` sends the status poll down its per-endpoint path. */
  async getFullStatus(): Promise<FullStatusResponse | null> {
    await delay(DEMO_LATENCY_MS);
    return null;
  }

  async setDisplayPage(page: string): Promise<{ ok?: boolean; activePage?: string }> {
    await delay(DEMO_LATENCY_MS);
    return { ok: true, activePage: page };
  }

  async startDisplayCalibration(): Promise<{ ok?: boolean; message?: string }> {
    await delay(DEMO_LATENCY_MS);
    return { ok: true, message: "Demo mode: no display is attached." };
  }

  async startTouchCalibration(): Promise<TouchCalibrationStart> {
    await delay(DEMO_LATENCY_MS);
    return { requested: true, target_count: 5 };
  }

  async getTouchCalibrationStatus(): Promise<TouchCalibrationStatus> {
    await delay(DEMO_LATENCY_MS);
    return { calibrated: false, requested: false };
  }

  async applySetup(_update: Record<string, unknown>): Promise<{ ok?: boolean }> {
    await delay(DEMO_LATENCY_MS);
    return { ok: true };
  }

  async getVideoStatus(): Promise<VideoStatus | null> {
    await delay(DEMO_LATENCY_MS);
    return null;
  }

  async getVideoConfig(): Promise<unknown | null> {
    await delay(DEMO_LATENCY_MS);
    return null;
  }

  async setVideoConfig(_body: Record<string, number | boolean>): Promise<unknown | null> {
    await delay(DEMO_LATENCY_MS);
    return null;
  }

  async getVideoLatency(): Promise<unknown | null> {
    await delay(DEMO_LATENCY_MS);
    return null;
  }

  async getTime(): Promise<
    { time_ns: number; monotonic_ns: number; ntp_synced: boolean } | null
  > {
    await delay(DEMO_LATENCY_MS);
    return null;
  }

  async startRecording(): Promise<RecordingControlResponse> {
    await delay(DEMO_LATENCY_MS);
    const startedAt = Date.now();
    const filename = `demo-${startedAt}.mp4`;
    this.demoRecording = { filename, startedAt };
    return { filename, started_at: startedAt };
  }

  async stopRecording(): Promise<RecordingControlResponse> {
    await delay(DEMO_LATENCY_MS);
    const rec = this.demoRecording;
    this.demoRecording = null;
    if (!rec) return {};
    const stoppedAt = Date.now();
    return {
      filename: rec.filename,
      started_at: rec.startedAt,
      stopped_at: stoppedAt,
      duration_seconds: Math.round((stoppedAt - rec.startedAt) / 1000),
    };
  }

  async listRecordings(): Promise<RecordingListResponse> {
    await delay(DEMO_LATENCY_MS);
    return {
      recording: this.demoRecording !== null,
      current_filename: this.demoRecording?.filename ?? null,
      items: [],
    };
  }
}
