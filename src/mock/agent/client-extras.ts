/**
 * @module mock/agent/client-extras
 * @description The part of the `AgentClient` surface demo mode answers with
 * "not reported" rather than invented readings: version and capability
 * probes, the consolidated status, display and touch calibration, most of the
 * video pipeline, the clock and recording. `MockAgentClient` extends this so the
 * demo client carries every public `AgentClient` method; the parity is
 * pinned by `tests/unit/mock-agent-client-parity.test.ts`.
 *
 * Nullable reads resolve `null`, the same answer an agent that predates the
 * route gives, so every caller takes its existing "not reported" path.
 * @license GPL-3.0-only
 */

import type {
  AgentVersionInfo,
  LanStatusFull,
  VideoStatus,
} from "@/lib/agent/types";
import type { SetupApplyResponse } from "@/lib/agent/agent-client/setup";
import type {
  TouchCalibrationStart,
  TouchCalibrationStatus,
} from "@/lib/agent/agent-client/setup";
import type {
  RecordingControlResponse,
  RecordingListResponse,
} from "@/lib/agent/agent-client/types";
import type {
  VideoAttentionProfile,
  VideoProfileApplied,
  VideoProfileLeaseRequest,
} from "@/lib/agent/agent-client/extras";
import { delay } from "./utils";
import { parseAgentDiagnostics, type AgentDiagnostics } from "@/lib/agent/agent-diagnostics";
import { DEMO_STATUS_EXTRAS } from "./status-extras";

/** Simulated round trip, the same order as the rest of the demo client. */
const DEMO_LATENCY_MS = 60;

/** `GET /api/video/config` as a paired ground station answers it: static
 * radio and encoder blocks, no adaptive controller, and the listener-side hop
 * snapshot whose `key_status` the radio tab shows. */
export const DEMO_VIDEO_CONFIG = {
  radio: { channel: 149, band: "u-nii-3", mcs_index: 1, fec_k: 8, fec_n: 12, tx_power_dbm: 20, preset: "balanced" },
  encoder: { bitrate_kbps: 4000, width: 1280, height: 720, fps: 30, codec: "h264" },
  adaptive: { available: false },
  hopping: {
    enabled: true,
    band: "u-nii-3",
    hop_period_seconds: null,
    loss_threshold_percent: null,
    rssi_threshold_dbm: null,
    last_hop_at: 0,
    history: [],
    source: "listener",
    last_refusal: null,
    key_status: "bound",
  },
} as const;

export class MockAgentClientExtras {
  private demoRecording: { filename: string; startedAt: number } | null = null;
  private demoBaseProfile: VideoAttentionProfile = "hero";
  private demoLeases = new Map<string, number>();

  async getVersion(_opts?: { force?: boolean }): Promise<AgentVersionInfo | null> {
    await delay(DEMO_LATENCY_MS);
    return null;
  }

  async supports(_capability: string): Promise<boolean> {
    return false;
  }

  /** `null` sends the status poll down its per-endpoint path. */
  async getFullStatus(): Promise<LanStatusFull | null> {
    await delay(DEMO_LATENCY_MS);
    return null;
  }

  /** The demo node's command-path verdicts: a healthy drone at system id 1. */
  async getAgentDiagnostics(): Promise<AgentDiagnostics | null> {
    await delay(DEMO_LATENCY_MS);
    return parseAgentDiagnostics(DEMO_STATUS_EXTRAS);
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
    return { requested: true, target_count: 5, request_id: "demo" };
  }

  async getTouchCalibrationStatus(): Promise<TouchCalibrationStatus> {
    await delay(DEMO_LATENCY_MS);
    return { calibrated: false, requested: false, request_id: null, calib_mtime_ms: null };
  }

  async applySetup(_update: Record<string, unknown>): Promise<SetupApplyResponse> {
    await delay(DEMO_LATENCY_MS);
    return { overall: true, sections: {}, rolled_back: [] };
  }

  async getVideoStatus(): Promise<VideoStatus | null> {
    await delay(DEMO_LATENCY_MS);
    return null;
  }

  async getVideoConfig(): Promise<unknown | null> {
    await delay(DEMO_LATENCY_MS);
    return DEMO_VIDEO_CONFIG;
  }

  async setVideoConfig(
    _body: Record<string, number | boolean>,
    _opts?: { force?: boolean },
  ): Promise<unknown | null> {
    await delay(DEMO_LATENCY_MS);
    return null;
  }

  async getVideoLatency(): Promise<unknown | null> {
    await delay(DEMO_LATENCY_MS);
    return null;
  }

  /** The demo feed is a synthetic canvas with no encoder to retarget; the
   * answer is the agent's lease bookkeeping at its default settings. */
  async setVideoProfile(
    profile: VideoAttentionProfile,
    lease?: VideoProfileLeaseRequest,
  ): Promise<VideoProfileApplied> {
    await delay(DEMO_LATENCY_MS);
    if (lease) {
      if (profile === "hero") this.demoLeases.set(lease.holder, lease.leaseS);
      else this.demoLeases.delete(lease.holder);
    } else {
      this.demoBaseProfile = profile;
    }
    return this.demoProfileState();
  }

  async releaseVideoProfile(holder: string): Promise<VideoProfileApplied> {
    await delay(DEMO_LATENCY_MS);
    this.demoLeases.delete(holder);
    return this.demoProfileState();
  }

  private demoProfileState(): VideoProfileApplied {
    const profile: VideoAttentionProfile =
      this.demoLeases.size > 0 ? "hero" : this.demoBaseProfile;
    const leases = [...this.demoLeases].map(([holder, leaseS]) => ({
      holder,
      expires_in_s: leaseS,
    }));
    const encoder = profile === "hero"
      ? { width: 1280, height: 720, fps: 30, bitrate_kbps: 4000 }
      : { width: 320, height: 180, fps: 1, bitrate_kbps: 50 };
    return {
      profile,
      base_profile: this.demoBaseProfile,
      ...encoder,
      ceiling_kbps: null,
      leases,
    };
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
      segments: [rec.filename],
      interrupted_count: 0,
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
