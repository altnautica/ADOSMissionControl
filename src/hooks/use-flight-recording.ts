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
 * State is derived from the persistent recorders (the video store + the
 * per-drone recorder), so switching away from the Cockpit tab and back never
 * leaves the button stuck or double-starts.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useRef, useState } from "react";
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

// Drone ids whose per-drone telemetry recording was started by the REC button
// (as opposed to the connect/arm auto-recorder). Module-level so it survives the
// cockpit unmounting when the operator switches tabs mid-recording, and so stop
// only tears down what the button started.
const btnStartedTelemetry = new Set<string>();

export interface FlightRecording {
  /** True while the video or a button-started telemetry recording is active. */
  isRecording: boolean;
  /** Recording duration in ms (0 while idle). */
  durationMs: number;
  /** Start both if idle, stop both if recording. */
  toggle: () => void;
}

export function useFlightRecording(droneId: string): FlightRecording {
  const videoRecording = useVideoStore((s) => s.isRecording);
  // Seeded from the persistent recorder truth so a remount (tab switch) reflects
  // reality instead of a stale idle state — the fix for a stuck REC button.
  const [telemetryActive, setTelemetryActive] = useState(
    () => btnStartedTelemetry.has(droneId) && isRecordingFor(droneId),
  );
  const [durationMs, setDurationMs] = useState(0);
  const startedAtRef = useRef<number | null>(null);
  const isRecording = videoRecording || telemetryActive;

  useEffect(() => {
    if (!isRecording) {
      startedAtRef.current = null;
      return;
    }
    if (startedAtRef.current === null) startedAtRef.current = Date.now();
    // Only tick inside the interval (never synchronously in the effect body).
    const id = setInterval(() => {
      setDurationMs(Date.now() - (startedAtRef.current ?? Date.now()));
    }, 250);
    return () => clearInterval(id);
  }, [isRecording]);

  const start = useCallback(() => {
    setDurationMs(0);
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
        const drone = useDroneManager.getState().getSelectedDrone();
        startRecordingFor(droneId, drone?.name);
        btnStartedTelemetry.add(droneId);
        setTelemetryActive(true);
      } catch {
        /* raced with the auto-recorder */
      }
    }
  }, [droneId]);

  const stop = useCallback(async () => {
    try {
      stopVideoRecording(); // auto-downloads the WebM when it was recording
    } catch {
      /* wasn't recording video */
    }
    // Only stop + export the telemetry recording if the button started it; a
    // recording owned by the auto lifecycle keeps running.
    if (btnStartedTelemetry.has(droneId)) {
      btnStartedTelemetry.delete(droneId);
      setTelemetryActive(false);
      try {
        const recording = await stopRecordingFor(droneId);
        if (recording && recording.frameCount > 0) {
          await downloadTelemetryCSV(recording);
        }
      } catch {
        /* recorder already torn down (e.g. disarm) */
      }
    }
  }, [droneId]);

  const toggle = useCallback(() => {
    if (isRecording) void stop();
    else start();
  }, [isRecording, start, stop]);

  return { isRecording, durationMs, toggle };
}
