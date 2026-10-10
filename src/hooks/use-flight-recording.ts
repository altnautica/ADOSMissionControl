"use client";

/**
 * @module hooks/use-flight-recording
 * @description One "flight recording" control that captures the video stream and
 * the telemetry log together. The cockpit surfaces a single REC button backed by
 * this hook instead of the two independent recorders.
 *
 * Telemetry uses the PER-DRONE recorder slot (`startRecordingFor`/
 * `recordFrameFor`/`stopRecordingFor`) — the one the telemetry bridge actually
 * feeds. That slot may already be running because of the connect/arm auto-record
 * settings; in that case the REC button leaves it to the auto lifecycle and only
 * drives the video. When auto-record is off, the button starts a per-drone
 * telemetry recording itself and downloads it as CSV on stop. Video is
 * opportunistic — recorded when a live stream is present (auto-downloads a WebM),
 * so an FC-only drone yields a telemetry-only flight recording.
 *
 * Start times live in stores, never in component state: the video start stamp
 * in the video store, the button-started telemetry stamp in the small store
 * below. Switching away from the cockpit and back therefore never resets the
 * timer, and the hook itself never ticks — the elapsed display is `RecTimer`'s
 * job, so a running recording does not re-render the surface that owns the
 * button.
 *
 * @license GPL-3.0-only
 */

import { useCallback } from "react";
import { create } from "zustand";
import { useTranslations } from "next-intl";
import {
  startRecording as startVideoRecording,
  stopRecording as stopVideoRecording,
} from "@/lib/video/webrtc-client";
import {
  startRecordingFor,
  stopRecordingFor,
  isRecordingFor,
} from "@/lib/telemetry-recorder";
import { downloadTelemetryCSV } from "@/lib/telemetry-export";
import { useVideoStore } from "@/stores/video-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useToast } from "@/components/ui/toast";

interface ButtonTelemetryState {
  /** droneId → `Date.now()` when the REC button started that drone's
   *  telemetry recording. Absent when the button did not start one (the
   *  auto-recorder may still own the slot). */
  startedAt: Record<string, number>;
  mark: (droneId: string, at: number) => void;
  clear: (droneId: string) => void;
}

/** Button-started telemetry recordings. Module scope so it outlives the cockpit. */
export const useButtonTelemetryRecordingStore = create<ButtonTelemetryState>((set) => ({
  startedAt: {},
  mark: (droneId, at) => set((s) => ({ startedAt: { ...s.startedAt, [droneId]: at } })),
  clear: (droneId) =>
    set((s) => {
      if (!(droneId in s.startedAt)) return s;
      const next = { ...s.startedAt };
      delete next[droneId];
      return { startedAt: next };
    }),
}));

export interface FlightRecording {
  /** True while the video or a button-started telemetry recording is active. */
  isRecording: boolean;
  /** `Date.now()` of the earliest active recording leg; `null` while idle. */
  startedAt: number | null;
  /** Start both if idle, stop both if recording. */
  toggle: () => void;
}

/**
 * The start stamp of the flight recording for `droneId`, or `null` when idle.
 * A button-started telemetry stamp whose recorder has since been torn down
 * (disconnect, auto lifecycle) does not count as recording.
 */
export function useFlightRecordingStartedAt(droneId: string): number | null {
  const videoStartedAt = useVideoStore((s) => (s.isRecording ? s.recordingStartedAt : null));
  const telemetryStamp = useButtonTelemetryRecordingStore((s) => s.startedAt[droneId] ?? null);
  const telemetryStartedAt =
    telemetryStamp !== null && isRecordingFor(droneId) ? telemetryStamp : null;
  if (videoStartedAt === null) return telemetryStartedAt;
  if (telemetryStartedAt === null) return videoStartedAt;
  return Math.min(videoStartedAt, telemetryStartedAt);
}

export function useFlightRecording(droneId: string): FlightRecording {
  const t = useTranslations("cockpit.band");
  const { toast } = useToast();
  const videoRecording = useVideoStore((s) => s.isRecording);
  const telemetryStamp = useButtonTelemetryRecordingStore((s) => s.startedAt[droneId] ?? null);
  const startedAt = useFlightRecordingStartedAt(droneId);
  const telemetryActive = telemetryStamp !== null && isRecordingFor(droneId);
  const isRecording = videoRecording || telemetryActive;

  const start = useCallback(() => {
    // Opportunistic video: no-op when there is no live stream to record.
    try {
      startVideoRecording();
    } catch {
      /* no active video stream */
    }
    // Telemetry: only start our own per-drone recording when one isn't already
    // running (the auto-recorder owns the slot otherwise).
    if (!isRecordingFor(droneId)) {
      try {
        const drone = useDroneManager.getState().drones.get(droneId);
        startRecordingFor(droneId, drone?.name);
        useButtonTelemetryRecordingStore.getState().mark(droneId, Date.now());
      } catch {
        /* raced with the auto-recorder */
      }
    }
  }, [droneId]);

  const stop = useCallback(async () => {
    let failed = false;
    if (useVideoStore.getState().isRecording) {
      try {
        await stopVideoRecording(); // auto-downloads the WebM
      } catch {
        failed = true;
      }
    }
    // Only stop + export the telemetry recording if the button started it; a
    // recording owned by the auto lifecycle keeps running.
    const store = useButtonTelemetryRecordingStore.getState();
    if (droneId in store.startedAt) {
      store.clear(droneId);
      if (isRecordingFor(droneId)) {
        try {
          const recording = await stopRecordingFor(droneId);
          if (recording && recording.frameCount > 0) {
            await downloadTelemetryCSV(recording);
          }
        } catch {
          failed = true;
        }
      }
    }
    if (failed) toast(t("recStopFailed"), "error");
  }, [droneId, t, toast]);

  const toggle = useCallback(() => {
    if (isRecording) void stop();
    else start();
  }, [isRecording, start, stop]);

  return { isRecording, startedAt, toggle };
}
