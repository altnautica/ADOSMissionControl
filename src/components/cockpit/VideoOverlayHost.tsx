/**
 * The cockpit's `video.overlay` slot host.
 *
 * Mounts the `video.overlay` `PluginSlot` inside the video rect and pushes a
 * `VideoOverlayHostProps` payload to every overlay iframe over the bridge's
 * one-way host-event channel. The payload is computed in the video's own
 * coordinate space:
 *
 *   - geometry (rendered letterbox rect + stream resolution) is measured from
 *     the `<video>` element and re-pushed only on resize / resolution change
 *     (a ResizeObserver on the wrapper + a `resize`/`loadedmetadata` listener
 *     on the video), never per frame;
 *   - detections + attitude are coalesced to the DETECTION rate: a new payload
 *     is pushed only when a fresh detection batch lands in the store, reading
 *     the latest attitude at batch time (not the 50 Hz telemetry tick);
 *   - when no batch has arrived within `staleAfterMs` the host pushes
 *     `detections: null` so overlays drop their boxes.
 *
 * The wrapper is `pointer-events-none`; a read-only overlay stays
 * non-interactive while an interactive overlay opts its own boxes back in.
 *
 * @module fly/VideoOverlayHost
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { PluginSlot } from "@/components/plugins/PluginSlot";
import {
  PluginHostProvider,
  type PluginSlotContribution,
} from "@/components/plugins/PluginHostProvider";
import { usePluginContributions } from "@/hooks/use-plugin-contributions";
import {
  useVisionDetectionsStore,
  type VisionDetectionBatch,
} from "@/stores/vision-detections-store";
import { useVideoStreamsStore } from "@/stores/video-streams-store";
import { useTelemetryStore } from "@/stores/telemetry-store";
import {
  VIDEO_OVERLAY_PROPS_CAPABILITY,
  VIDEO_OVERLAY_PROPS_EVENT,
  type RenderedRect,
  type VideoOverlayDetections,
  type VideoOverlayHostProps,
} from "@/lib/plugins/video-overlay-props";
import { useClockTick } from "@/lib/agent/freshness";
import { freshOnly } from "@/lib/telemetry/freshness";
import { useClockStore } from "@/stores/clock-store";

/** Mirror DetectionOverlay's default staleness window. */
const DEFAULT_STALE_MS = 2000;

interface VideoOverlayHostProps2 {
  /** Active drone/device id whose batch + plugins this overlay serves. */
  droneId: string;
  /** Drop detections older than this (ms). */
  staleAfterMs?: number;
  /**
   * Optional explicit overlay contributions. The cockpit normally feeds these
   * from the per-drone plugin install join; tests pass them directly. When
   * omitted the slot resolves from the surrounding provider's contributions.
   */
  contributions?: ReadonlyArray<
    PluginSlotContribution & { slot: "video.overlay" }
  >;
  className?: string;
}

/**
 * Compute the letterbox-corrected rendered rect for an `object-contain` video
 * inside a wrapper of `wrapperW x wrapperH`, given the stream's intrinsic
 * `streamW x streamH`. Returns the rect in CSS px relative to the wrapper's
 * top-left. Falls back to filling the wrapper when the stream size is unknown.
 */
/**
 * Pick the detection batch the overlay should paint for the active leg.
 *
 * Single-stream node: the latest batch (any camera) drives the overlay, as
 * before — there is no leg ambiguity. Multi-stream node: the boxes must belong
 * to the ACTIVE leg (correlated by the leg id == the batch `cameraId`), so the
 * newest per-(model,camera) batch whose `cameraId` matches the active leg is
 * chosen, and nothing is drawn when the active leg has no detections — never
 * another leg's boxes over this leg's video.
 */
export function pickActiveLegBatch(
  multiStream: boolean,
  latestBatch: VisionDetectionBatch | undefined,
  perStream: Record<string, VisionDetectionBatch> | undefined,
  activeLegId: string | null,
): VisionDetectionBatch | undefined {
  if (!multiStream) return latestBatch;
  if (!perStream || activeLegId == null) return undefined;
  let best: VisionDetectionBatch | undefined;
  for (const b of Object.values(perStream)) {
    if (
      b.cameraId === activeLegId &&
      (best == null || b.receivedAt > best.receivedAt)
    ) {
      best = b;
    }
  }
  return best;
}

export function computeRenderedRect(
  wrapperW: number,
  wrapperH: number,
  streamW: number,
  streamH: number,
): RenderedRect {
  if (streamW <= 0 || streamH <= 0 || wrapperW <= 0 || wrapperH <= 0) {
    return { left: 0, top: 0, width: wrapperW, height: wrapperH };
  }
  const scale = Math.min(wrapperW / streamW, wrapperH / streamH);
  const width = streamW * scale;
  const height = streamH * scale;
  return {
    left: (wrapperW - width) / 2,
    top: (wrapperH - height) / 2,
    width,
    height,
  };
}

export function VideoOverlayHost({
  droneId,
  staleAfterMs = DEFAULT_STALE_MS,
  contributions,
  className,
}: VideoOverlayHostProps2) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Geometry state (re-measured on resize / resolution change only).
  const [geometry, setGeometry] = useState<{
    rect: RenderedRect;
    streamWidth: number;
    streamHeight: number;
  }>({
    rect: { left: 0, top: 0, width: 0, height: 0 },
    streamWidth: 0,
    streamHeight: 0,
  });

  // The detection batch that drives the push cadence. On a single-stream node
  // the latest batch (any camera) is used, as before. On a MULTI-stream node
  // the boxes must belong to the ACTIVE leg — otherwise a batch from another
  // leg (e.g. the IR tracker) would draw its boxes over the EO video after the
  // operator switches legs. The correlation key is the leg id: pick the newest
  // per-(model,camera) batch whose cameraId matches the active leg, and draw
  // nothing when the active leg has no detections (never another leg's boxes).
  const latestBatch = useVisionDetectionsStore((s) => s.batches[droneId]);
  const perStream = useVisionDetectionsStore((s) => s.streams[droneId]);
  const streamDescriptors = useVideoStreamsStore(
    (s) => s.streamsByDrone[droneId],
  );
  const activeStreamId = useVideoStreamsStore(
    (s) => s.activeStreamIdByDrone[droneId],
  );
  const multiStream = (streamDescriptors?.length ?? 0) > 1;
  const activeLegId = activeStreamId ?? streamDescriptors?.[0]?.id ?? null;
  const batch = useMemo(
    () => pickActiveLegBatch(multiStream, latestBatch, perStream, activeLegId),
    [multiStream, latestBatch, perStream, activeLegId],
  );

  // When the cockpit does not hand explicit contributions, resolve the
  // live `video.overlay` set from this drone's installed plugins. Tests
  // pass `contributions` directly to skip the producer + Convex.
  const produced = usePluginContributions(droneId, "video.overlay");
  const resolved = contributions ?? produced;

  // ── Geometry: measure on resize + resolution change, not per frame ──
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    // The <video> is a sibling inside the same VideoCanvas container.
    const container = wrapper.parentElement;
    const video = container?.querySelector<HTMLVideoElement>("video") ?? null;

    const measure = () => {
      const rectBox = wrapper.getBoundingClientRect();
      const streamW = video?.videoWidth ?? 0;
      const streamH = video?.videoHeight ?? 0;
      const rect = computeRenderedRect(
        rectBox.width,
        rectBox.height,
        streamW,
        streamH,
      );
      setGeometry((prev) => {
        if (
          prev.streamWidth === streamW &&
          prev.streamHeight === streamH &&
          prev.rect.left === rect.left &&
          prev.rect.top === rect.top &&
          prev.rect.width === rect.width &&
          prev.rect.height === rect.height
        ) {
          return prev;
        }
        return { rect, streamWidth: streamW, streamHeight: streamH };
      });
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrapper);
    // Video resolution changes (resize event) and first-frame metadata.
    video?.addEventListener("resize", measure);
    video?.addEventListener("loadedmetadata", measure);
    return () => {
      ro.disconnect();
      video?.removeEventListener("resize", measure);
      video?.removeEventListener("loadedmetadata", measure);
    };
  }, [droneId]);

  // ── Staleness clock: the shared 1 Hz ticker, so both the detection window
  // and the telemetry-freshness gate below re-evaluate even when no new data
  // arrives — which is exactly the case that matters, because "nothing is
  // arriving" is what staleness means. This replaces a per-instance 500 ms
  // interval that only ran while a batch was present, so attitude could go
  // stale unobserved the moment detections stopped.
  //
  // `useClockTick` takes the refcounted subscription that keeps the one
  // process-wide interval running; `now` is the wall clock captured at that
  // tick, and it is the value every age below is measured against. The tick
  // itself is a COUNTER — using it as a clock would make every age hugely
  // negative, which both gates read as "from the future" and therefore
  // fresh: a gate that can never fire, which is the bug this closes.
  useClockTick();
  const now = useClockStore((s) => s.now);

  // ── Build the host-props payload when a batch lands or the clock ticks. ──
  const hostProps = useMemo<VideoOverlayHostProps>(() => {
    const fresh = batch != null && now - batch.receivedAt <= staleAfterMs;
    const detections: VideoOverlayDetections | null =
      fresh && batch
        ? {
            frameWidth: batch.frameWidth,
            frameHeight: batch.frameHeight,
            frameId: batch.frameId,
            receivedAt: batch.receivedAt,
            // A box-less percept (a mask/pose/depth-only reading) has no box to
            // paint, so it is dropped from the overlay items.
            items: batch.detections.flatMap((d) =>
              d.bbox
                ? [
                    {
                      bbox: {
                        x: d.bbox.x,
                        y: d.bbox.y,
                        width: d.bbox.width,
                        height: d.bbox.height,
                      },
                      classLabel: d.classLabel,
                      confidence: d.confidence,
                      trackId: d.trackId ?? null,
                      lockState: d.lockState ?? null,
                    },
                  ]
                : [],
            ),
          }
        : null;

    // Attitude, coalesced to the batch moment, gated through the telemetry
    // freshness contract. It used to be `att?.roll ?? 0`, which on a dead
    // link handed every overlay a perfectly wings-level aircraft forever.
    // `freshOnly` collapses a stale sample to absent and the prop is
    // nullable, so an overlay has to raise a flag rather than draw a lie.
    const att = freshOnly(
      useTelemetryStore.getState().attitude.latest(),
      now,
    );

    return {
      droneId,
      cameraId: batch?.cameraId ?? "",
      streamWidth: geometry.streamWidth,
      streamHeight: geometry.streamHeight,
      renderedRect: geometry.rect,
      frameTimestampMs: batch?.tsMs ?? 0,
      attitude: att
        ? { rollDeg: att.roll, pitchDeg: att.pitch, yawDeg: att.yaw }
        : null,
      detections,
    };
    // `now` is a dependency so a staleness transition re-pushes with
    // detections and attitude collapsed to null, with no new data arriving.
  }, [droneId, batch, geometry, staleAfterMs, now]);

  const hostEvent = useMemo(
    () => ({
      method: VIDEO_OVERLAY_PROPS_EVENT,
      capability: VIDEO_OVERLAY_PROPS_CAPABILITY,
      args: hostProps,
    }),
    [hostProps],
  );

  return (
    <div
      ref={wrapperRef}
      data-cockpit-layer="video-overlay"
      // Passive plugin `video.overlay` slot. Stays BELOW the host-owned
      // interactive layers (CockpitTargetOverlay / CockpitMarkLayer, z-[12])
      // so a sandboxed plugin iframe can never occlude the operator's click
      // targets or marks — host-owned interactive layers always sit above
      // passive plugin overlays.
      className={className ?? "absolute inset-0 z-10 pointer-events-none"}
    >
      <PluginHostProvider deviceId={droneId} contributions={resolved}>
        <PluginSlot
          name="video.overlay"
          contributions={resolved}
          className="absolute inset-0"
          iframeClassName="absolute inset-0 w-full h-full border-0"
          hostEvent={hostEvent}
        />
      </PluginHostProvider>
    </div>
  );
}
