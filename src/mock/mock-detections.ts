/**
 * MockDetectionStream : a demo-mode synthetic vision-detection generator.
 *
 * Pushes per-frame detection batches into the vision-detections store at
 * inference cadence (~10 Hz) so the cockpit target layer, the video.overlay
 * plugin slot and the follow-me journey are explorable in `npm run demo` with
 * no agent attached. The store's setBatch is the same seam the live LAN
 * WebSocket client feeds, so the overlay code path is identical to production.
 *
 * The batches follow the scripted 32 s cycle in `mock-hud-script`: candidate
 * → tracked → locked → following → coasting → searching → re-acquired → lost,
 * 4 s each, over a couple of background boxes that keep the candidate and
 * tracked styles on screen. When a state begins the stream applies its
 * one-shot effects: it designates the followed track (and later its
 * re-acquired successor) in the selected-target store, pushes the
 * `follow.reacquired` / `follow.lost` events, and releases the designation
 * when the cycle restarts. Those effects run only while the demo pilot flies
 * the Follow-Me skill; when it ends the stream drops its designation. The
 * matching follow / nav / pose / scan / map feed runs in `mock-nav` on the
 * same clock, started and stopped from here.
 *
 * One demo drone ({@link VISION_OFF_DEMO_DRONE}) models a node whose vision
 * engine is not running: instead of batches it records the agent's
 * `available:false` report, so the "vision not running" copy is reachable in
 * the demo too.
 *
 * This is demo infrastructure, not a stub: it is loaded only when isDemoMode()
 * is true and produces complete, well-formed data.
 *
 * @license GPL-3.0-only
 */

import { useNavStreamStore } from "@/stores/nav-stream-store";
import { useSelectedTargetStore } from "@/stores/selected-target-store";
import {
  useVisionDetectionsStore,
  type VisionDetection,
} from "@/stores/vision-detections-store";
import { useVideoStreamsStore } from "@/stores/video-streams-store";
import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import {
  FRAME_HEIGHT,
  FRAME_WIDTH,
  entryEffect,
  hudStateAt,
  scriptDetections,
  type HudDemoState,
} from "./mock-hud-script";
import { demoActiveCameraId, mockNavStream } from "./mock-nav";
import { mockPilot } from "./mock-pilot";

/** The demo drone whose agent reports its vision engine unreachable. */
export const VISION_OFF_DEMO_DRONE = "lima-12";

/** Push rate (ms) — ~10 Hz, matching a typical on-companion inference loop. */
const TICK_MS = 100;

/** The background track the PiP camera also sees. */
const PIP_TRACK = 7;

class MockDetectionStream {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private droneId: string | null = null;
  private startMs = 0;
  private frameId = 0;
  /** `cycle:index` of the state whose entry effects already ran. */
  private enteredState: string | null = null;
  /** The current drone models a node whose vision engine is not running. */
  private visionOff = false;
  /** The follow skill flew at the last tick. */
  private following = false;

  /** Start (or retarget) the stream onto a drone id. Idempotent per drone. */
  start(droneId: string): void {
    if (this.droneId === droneId && (this.intervalId !== null || this.visionOff)) return;
    this.stop();
    this.droneId = droneId;
    if ((deviceIdFromNodeId(droneId) ?? droneId) === VISION_OFF_DEMO_DRONE) {
      this.visionOff = true;
      useVisionDetectionsStore.getState().setVisionAvailable(droneId, false);
      return;
    }
    this.startMs = Date.now();
    this.frameId = 0;
    this.enteredState = null;
    this.intervalId = setInterval(() => this.tick(), TICK_MS);
    mockNavStream.start(droneId, this.startMs);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    mockNavStream.stop();
    if (this.droneId) {
      useVisionDetectionsStore.getState().clearBatch(this.droneId);
      this.releaseDesignation(this.droneId);
    }
    this.droneId = null;
    this.visionOff = false;
    this.enteredState = null;
    this.following = false;
  }

  isRunning(): boolean {
    return this.intervalId !== null;
  }

  private tick(): void {
    const droneId = this.droneId;
    if (!droneId) return;

    const tSec = (Date.now() - this.startMs) / 1000;
    const detections = scriptDetections(tSec);

    // Tag the batch with the currently-active video leg so the demo models a
    // single-tracker pod that follows the active camera: the cockpit overlay
    // correlates boxes to the active leg id, so the boxes stay on the main view
    // as the operator switches legs (and never bleed onto another leg).
    const cameraId = demoActiveCameraId(droneId);
    useVisionDetectionsStore.getState().setBatch(droneId, {
      modelId: "demo-yolov8n",
      cameraId,
      frameId: this.frameId++,
      // Like the agent (contract v3): a monotonic frame time, not wall time.
      tsMs: Math.round(performance.now()),
      frameWidth: FRAME_WIDTH,
      frameHeight: FRAME_HEIGHT,
      detections,
    });

    // A second camera shown in the PiP runs its own tracker: give it the
    // background subjects (never the followed one) so its overlay is live.
    const pipId = useVideoStreamsStore.getState().pipStreamIdByDrone[droneId] ?? null;
    if (pipId && pipId !== cameraId) {
      useVisionDetectionsStore.getState().setBatch(droneId, {
        modelId: "demo-yolov8n",
        cameraId: pipId,
        frameId: this.frameId,
        tsMs: Math.round(performance.now()),
        frameWidth: FRAME_WIDTH,
        frameHeight: FRAME_HEIGHT,
        detections: detections.filter((d) => d.trackId == null || d.trackId === PIP_TRACK),
      });
    }

    // The follow-me journey's designation and events belong to the follow
    // skill: outside it they stay quiet, and its end drops the designation.
    if (!mockPilot.followSkillActive()) {
      if (this.following) this.releaseDesignation(droneId);
      this.following = false;
      this.enteredState = null;
      return;
    }
    this.following = true;
    const at = hudStateAt(tSec);
    const key = `${at.cycle}:${at.index}`;
    if (key === this.enteredState) return;
    this.enteredState = key;
    this.applyEntry(droneId, cameraId, at.state, detections);
  }

  /** Run the one-shot effects of a state that just began. */
  private applyEntry(
    droneId: string,
    cameraId: string,
    state: HudDemoState,
    detections: VisionDetection[],
  ): void {
    const effect = entryEffect(state);
    if (effect.release) this.releaseDesignation(droneId);
    if (effect.event) useNavStreamStore.getState().pushFollowEvent(droneId, effect.event);
    if (effect.designateTrack === null) return;
    const det = detections.find((d) => d.trackId === effect.designateTrack);
    if (!det?.bbox) return;
    useSelectedTargetStore.getState().setDesignated({
      droneId,
      cameraId,
      trackId: effect.designateTrack,
      bbox: det.bbox,
      classLabel: det.classLabel,
      confidence: det.confidence,
    });
  }

  /** Drop the designation only when the demo set it on this drone. */
  private releaseDesignation(droneId: string): void {
    const sel = useSelectedTargetStore.getState();
    if (sel.designated?.droneId === droneId) sel.release();
  }
}

/** Singleton demo detection stream. */
export const mockDetectionStream = new MockDetectionStream();
