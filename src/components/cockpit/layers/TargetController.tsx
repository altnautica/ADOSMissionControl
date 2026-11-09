"use client";

/**
 * @module cockpit/layers/TargetController
 * @description The interactive half of the `targets` layer. It resolves the
 * camera's detection batch, the designated target and the follow-me state into
 * laid-out target glyphs (`resolveTargets` → `layoutTargets`) and hands them,
 * with the composited cockpit marks and the designated target's lead, to the
 * layer engine, which paints them into the layer stack's canvas. It renders
 * only what takes input: the click areas over each target, the drag
 * selection, the detector status tag and the target-action popup.
 *
 * Interaction (unchanged from the SVG target layer it replaces):
 *  - click a target (hit area at least 44 px) → its target-action popup, after
 *    the double-click interval so a double click never also designates;
 *  - `[` / `]` cycle a focus ring, `Enter` opens the focused target's popup,
 *    `Esc` clears the focus;
 *  - drag on empty video → designate the dragged rect.
 *
 * It re-renders at detection rate (a few Hz), never at the AR or obstacle
 * frame rate.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useTranslations } from "next-intl";

import { computeRenderedRect } from "@/components/cockpit/VideoOverlayHost";
import { useToast } from "@/components/ui/toast";
import { useDisplayedDetectionBatch } from "@/hooks/use-detection-batch";
import { useDetectionDemand } from "@/hooks/use-detection-demand";
import { useFollowDesignationSync } from "@/hooks/use-follow-designation-sync";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { useResolvedTargets } from "@/hooks/use-resolved-targets";
import { useTargetDrag } from "@/hooks/use-target-drag";
import { useTargetFocus } from "@/hooks/use-target-focus";
import { useTargetLead } from "@/hooks/use-target-lead";
import { useTargetPopup } from "@/hooks/use-target-popup";
import { useCockpitWidthClass } from "@/hooks/use-cockpit-width-class";
import type { CockpitMark, MarkFrame } from "@/lib/cockpit/marks";
import type { LayerEngine } from "@/lib/cockpit/layers/engine";
import { designateTarget } from "@/lib/skills/target-actions";
import { reticleBox, setReticleSelect, useDesignateReticle } from "@/lib/cockpit/designate-reticle";
import { DOUBLE_CLICK_MS, focusOrder } from "@/lib/vision/target-interaction";
import { frameToScreen, type ScreenRect } from "@/lib/vision/target-geometry";
import { layoutTargets, tagFontPx, type GlyphLayout } from "@/lib/vision/target-layout";
import type { DrawItem } from "@/lib/vision/target-state";
import { useCockpitMarksStore } from "@/stores/cockpit-marks-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useSelectedTargetStore } from "@/stores/selected-target-store";
import { useVideoStore } from "@/stores/video-store";
import { useVideoStreamsStore } from "@/stores/video-streams-store";
import type { DetectionBox } from "@/stores/vision-detections-store";

import { DetectorStateTag } from "@/components/vision/DetectorStateTag";
import { TargetActionPopup } from "@/components/vision/TargetActionPopup";

type HitLayout = GlyphLayout & { hit: ScreenRect };

export interface TargetControllerProps {
  droneId: string;
  cameraId: string;
  engine: LayerEngine;
  /** The layer stack's container: drag selection listens on it. */
  layerRef: RefObject<HTMLDivElement | null>;
  size: { w: number; h: number } | null;
}

export function TargetController({ droneId, cameraId, engine, layerRef, size }: TargetControllerProps) {
  const reducedMotion = usePrefersReducedMotion();
  const { toast } = useToast();
  const tRoot = useTranslations();

  const displayed = useDisplayedDetectionBatch(droneId);
  const legs = useVideoStreamsStore((s) => s.streamsByDrone[droneId]);
  const pipStreamId = useVideoStreamsStore((s) => s.pipStreamIdByDrone[droneId]);
  const selected = useDroneManager((s) => s.selectedDroneId === droneId);
  const mainFrozen = useVideoStore((s) => s.isStreaming && s.degradedReason !== null);
  const openPopup = useSelectedTargetStore((s) => s.openPopup);
  const closePopup = useSelectedTargetStore((s) => s.closePopup);
  const reset = useSelectedTargetStore((s) => s.reset);
  const bySource = useCockpitMarksStore((s) => s.bySource);

  const videoLost = selected && mainFrozen;
  const role = legs?.find((l) => l.id === cameraId)?.role;

  const { resolved, freshBatch, ghost } = useResolvedTargets({
    droneId,
    batch: displayed,
    cameraId,
    videoLost,
    // The off-frame arrow belongs to forward cameras only.
    cameraYawOffsetDeg: role === "down" ? null : 0,
    pip: false,
    remember: true,
  });
  const camera = freshBatch?.cameraId ?? cameraId;
  useFollowDesignationSync(droneId, camera);
  useTargetLead(droneId);
  // Ask the engine to detect on the camera this layer shows while it is up.
  const demand = useDetectionDemand(droneId, cameraId, true);

  // This layer owns the cockpit target state: drop the popup and the
  // designation when the drone changes. Hiding the layer (level Off, the Map
  // view) unmounts it and keeps the designation.
  const shownDrone = useRef(droneId);
  useEffect(() => {
    if (shownDrone.current === droneId) return;
    shownDrone.current = droneId;
    reset();
  }, [droneId, reset]);

  const popup = useTargetPopup({
    droneId,
    camera,
    live: freshBatch !== null && !videoLost,
    otherCameras: [pipStreamId],
  });

  const { frameW, frameH } = resolved;
  const rendered = useMemo(() => {
    if (!size || size.w <= 0 || size.h <= 0 || frameW <= 0 || frameH <= 0) return null;
    return computeRenderedRect(size.w, size.h, frameW, frameH);
  }, [size, frameW, frameH]);
  const widthClass = useCockpitWidthClass();

  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [focusRaw, setFocusRaw] = useState<string | null>(null);

  const layouts = useMemo<GlyphLayout[]>(() => {
    if (!rendered) return [];
    const reveal = new Set<string>();
    if (hoverKey) reveal.add(hoverKey);
    if (focusRaw) reveal.add(focusRaw);
    return layoutTargets(resolved, {
      rendered,
      fontPx: tagFontPx(widthClass, false),
      widthClass,
      ghost,
      revealKeys: reveal,
    });
  }, [resolved, rendered, widthClass, ghost, hoverKey, focusRaw]);

  const order = useMemo(() => focusOrder(layouts), [layouts]);
  const focusKey = focusRaw !== null && order.includes(focusRaw) ? focusRaw : null;

  // Marks map from the displayed batch's frame into the rendered rect.
  const batchW = displayed?.frameWidth ?? 0;
  const batchH = displayed?.frameHeight ?? 0;
  const markFrame = useMemo<MarkFrame | null>(() => {
    if (!size || batchW <= 0 || batchH <= 0 || size.w <= 0 || size.h <= 0) return null;
    return { rect: computeRenderedRect(size.w, size.h, batchW, batchH), frameWidth: batchW, frameHeight: batchH };
  }, [size, batchW, batchH]);
  const marks = useMemo(() => {
    const list: CockpitMark[] = [];
    for (const m of bySource.values()) list.push(...m);
    return list;
  }, [bySource]);

  // Hand the scene to the canvas loop, with the batch's arrival so the layer
  // dims at 500 ms and hides at 2 s on its own.
  const batchAt = displayed?.receivedAt ?? null;
  const detector = batchAt !== null || demand === "detecting";
  useEffect(() => {
    engine.setTargets({ layouts, at: Date.now(), focusKey, reducedMotion, marks, markFrame, batchAt, detector });
  }, [engine, layouts, focusKey, reducedMotion, marks, markFrame, batchAt, detector]);
  useEffect(() => () => engine.setTargets(null), [engine]);

  const openFor = (item: DrawItem) => {
    const d = item.detection;
    if (!d?.bbox || !freshBatch) return;
    openPopup({
      droneId,
      cameraId: freshBatch.cameraId,
      trackId: d.trackId ?? null,
      bbox: d.bbox,
      classLabel: d.classLabel,
      confidence: d.confidence,
    });
  };

  useTargetFocus({
    enabled: true,
    order,
    focusKey,
    setFocusKey: setFocusRaw,
    menuOpen: popup !== null,
    onActivate: (key) => {
      const l = layouts.find((x) => x.key === key);
      if (l) openFor(l.item);
    },
  });

  // A single click waits out the double-click interval; a double click
  // (fullscreen) cancels it.
  const clickTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(clickTimer.current), []);
  const onHitClick = (e: React.MouseEvent, item: DrawItem) => {
    window.clearTimeout(clickTimer.current);
    if (e.detail >= 2) return;
    clickTimer.current = window.setTimeout(() => openFor(item), DOUBLE_CLICK_MS);
  };

  const onDragSelect = (bbox: DetectionBox) => {
    void designateTarget(
      { droneId, cameraId: camera, trackId: null, bbox, classLabel: "", confidence: 0 },
      (message, status) => toast(tRoot.has(message) ? tRoot(message) : message, status ?? "info"),
    );
  };
  // The controller's designate reticle (touchpad): Cross designates the
  // detection under it, or a small box around it on empty video.
  const reticle = useDesignateReticle();
  const designateAtRef = useRef<(x: number, y: number) => void>(() => {});
  useEffect(() => {
    designateAtRef.current = (x, y) => {
      if (frameW <= 0 || frameH <= 0) return;
      const boxes: DetectionBox[] = [];
      for (const l of layouts) if (l.item.detection?.bbox) boxes.push(l.item.detection.bbox);
      onDragSelect(reticleBox(x, y, frameW, frameH, boxes));
    };
  });
  // Registered only while this layer has a rendered frame to draw the
  // reticle on and designate in; otherwise the controls keep their bindings.
  const canDesignate = rendered !== null;
  useEffect(() => {
    if (!canDesignate) return;
    setReticleSelect((x, y) => designateAtRef.current(x, y));
    return () => setReticleSelect(null);
  }, [canDesignate]);
  const reticleAt =
    reticle.open && rendered
      ? frameToScreen({ x: reticle.x * frameW, y: reticle.y * frameH, w: 0, h: 0 }, frameW, frameH, rendered)
      : null;

  const selection = useTargetDrag(layerRef, rendered && !videoLost ? { rendered, frameW, frameH } : null, onDragSelect);

  // Largest first, so a smaller box nested in a larger one sits on top and
  // wins the click.
  const hits = layouts
    .filter((l): l is HitLayout => l.hit !== null)
    .sort((a, b) => b.hit.w * b.hit.h - a.hit.w * a.hit.h);

  const popupAt =
    popup && rendered
      ? frameToScreen(
          { x: popup.bbox.x, y: popup.bbox.y, w: popup.bbox.width, h: popup.bbox.height },
          frameW,
          frameH,
          rendered,
        )
      : null;

  return (
    <>
      {hits.map((l) => (
        <button
          key={l.key}
          type="button"
          className="tgt-hit"
          data-target-interactive
          data-kind={l.kind}
          data-key={l.key}
          aria-label={l.item.topTag?.text ?? l.item.detection?.classLabel ?? l.kind}
          style={{ left: l.hit.x, top: l.hit.y, width: l.hit.w, height: l.hit.h }}
          onClick={(e) => onHitClick(e, l.item)}
          onPointerEnter={() => setHoverKey(l.key)}
          onPointerLeave={() => setHoverKey(null)}
          onFocus={() => setHoverKey(l.key)}
          onBlur={() => setHoverKey(null)}
        />
      ))}
      {selection && (
        <div
          className="tgt-select"
          data-testid="target-drag-selection"
          style={{ left: selection.x, top: selection.y, width: selection.w, height: selection.h }}
        />
      )}
      {reticleAt && (
        <div
          aria-hidden="true"
          data-testid="designate-reticle"
          className="pointer-events-none absolute z-[6] h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent-primary"
          style={{ left: reticleAt.x, top: reticleAt.y }}
        />
      )}
      <DetectorStateTag status={demand} show={freshBatch === null && !videoLost} />
      {popup && popupAt && (
        <div className="absolute z-[7]" style={{ left: popupAt.x, top: popupAt.y + popupAt.h + 4 }}>
          <TargetActionPopup target={popup} onClose={closePopup} />
        </div>
      )}
    </>
  );
}
