"use client";

/**
 * @module vision/CockpitTargetOverlay
 * @description The host-owned target layer for the cockpit video and, with
 * `pip`, for the picture-in-picture inset. It resolves the camera's detection
 * batch, the designated target and the follow-me state into HUD target items
 * (`resolveTargets`) and draws each through {@link TargetGlyph} over the
 * letterbox-corrected video rect.
 *
 * Interaction (host target layer, z 12; the container passes pointer events
 * through, hit areas take them):
 *  - click a target (hit area at least 44 px) → its target-action popup, after
 *    the double-click interval so a double click never also designates;
 *  - `[` / `]` cycle a focus ring, `Enter` opens the focused target's popup,
 *    `Esc` clears the focus (main video only);
 *  - drag on empty video → designate the dragged rect through the same
 *    designate call as the popup's Lock action.
 *
 * The main overlay mirrors follow-me events into the designation (re-acquired
 * moves it, lost clears it). Nothing is drawn while the video is lost.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { computeRenderedRect } from "@/components/cockpit/VideoOverlayHost";
import { useToast } from "@/components/ui/toast";
import { useBoxSmoothing, smoothKey } from "@/hooks/use-box-smoothing";
import { useCameraDetectionBatch, useDisplayedDetectionBatch } from "@/hooks/use-detection-batch";
import { useElementSize } from "@/hooks/use-element-size";
import { useFollowDesignationSync } from "@/hooks/use-follow-designation-sync";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { useResolvedTargets } from "@/hooks/use-resolved-targets";
import { useTargetDrag } from "@/hooks/use-target-drag";
import { useTargetFocus } from "@/hooks/use-target-focus";
import { useTargetPopup } from "@/hooks/use-target-popup";
import { designateTarget } from "@/lib/skills/target-actions";
import { useCockpitWidthClass } from "@/hooks/use-cockpit-width-class";
import { DOUBLE_CLICK_MS, focusOrder } from "@/lib/vision/target-interaction";
import { coverRect, frameToScreen, type ScreenRect } from "@/lib/vision/target-geometry";
import { layoutTargets, tagFontPx, type GlyphLayout } from "@/lib/vision/target-layout";
import type { DrawItem, FrameRect } from "@/lib/vision/target-state";
import { useDroneManager } from "@/stores/drone-manager";
import { useSelectedTargetStore } from "@/stores/selected-target-store";
import { useVideoStore } from "@/stores/video-store";
import { useVideoStreamsStore, type StreamRole } from "@/stores/video-streams-store";
import type { DetectionBox } from "@/stores/vision-detections-store";

import { TargetActionPopup } from "./TargetActionPopup";
import { TargetGlyph } from "./TargetGlyph";

export interface PipTargetSource {
  /** The PiP leg; its id is the camera id its detections carry. */
  cameraId: string;
  role?: StreamRole;
  videoLost: boolean;
  /** How the PiP video fills its box. */
  fit: "contain" | "cover";
}

export interface CockpitTargetOverlayProps {
  droneId: string;
  /** Draw the PiP leg's own batch with PiP tag rules (9 px, no candidate tags). */
  pip?: PipTargetSource;
}

type HitLayout = GlyphLayout & { hit: ScreenRect };

export function CockpitTargetOverlay({ droneId, pip }: CockpitTargetOverlayProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(layerRef);
  const reducedMotion = usePrefersReducedMotion();
  const { toast } = useToast();
  const tRoot = useTranslations();

  const displayed = useDisplayedDetectionBatch(droneId);
  const pipBatch = useCameraDetectionBatch(droneId, pip?.cameraId ?? null);
  const legs = useVideoStreamsStore((s) => s.streamsByDrone[droneId]);
  const activeStreamId = useVideoStreamsStore((s) => s.activeStreamIdByDrone[droneId]);
  const pipStreamId = useVideoStreamsStore((s) => s.pipStreamIdByDrone[droneId]);
  const selected = useDroneManager((s) => s.selectedDroneId === droneId);
  const mainFrozen = useVideoStore((s) => s.isStreaming && s.degradedReason !== null);
  const openPopup = useSelectedTargetStore((s) => s.openPopup);
  const closePopup = useSelectedTargetStore((s) => s.closePopup);
  const reset = useSelectedTargetStore((s) => s.reset);

  const mainLeg = activeStreamId ?? legs?.[0]?.id ?? null;
  const videoLost = pip ? pip.videoLost : selected && mainFrozen;
  const role = pip ? pip.role : legs?.find((l) => l.id === mainLeg)?.role;

  const { resolved, freshBatch, ghost } = useResolvedTargets({
    droneId,
    batch: pip ? pipBatch : displayed,
    cameraId: pip ? pip.cameraId : mainLeg,
    videoLost,
    // The off-frame arrow belongs to forward cameras only.
    cameraYawOffsetDeg: role === "down" ? null : 0,
    pip: !!pip,
    remember: true,
  });
  const camera = freshBatch?.cameraId ?? (pip ? pip.cameraId : mainLeg);
  useFollowDesignationSync(pip ? null : droneId, camera);
  const smoothed = useBoxSmoothing(videoLost ? null : freshBatch, reducedMotion);

  // The main overlay owns the cockpit target state: drop the popup and the
  // designation on drone switch / unmount. Hiding the PiP must not.
  useEffect(() => {
    if (pip) return;
    return () => reset();
  }, [droneId, reset, pip]);

  const popup = useTargetPopup({
    droneId,
    camera,
    live: freshBatch !== null && !videoLost,
    otherCameras: pip ? null : [pipStreamId],
  });

  const { frameW, frameH } = resolved;
  const fit = pip?.fit ?? "contain";
  const rendered = useMemo(() => {
    if (!size || size.w <= 0 || size.h <= 0 || frameW <= 0 || frameH <= 0) return null;
    return fit === "cover"
      ? coverRect(size.w, size.h, frameW, frameH)
      : computeRenderedRect(size.w, size.h, frameW, frameH);
  }, [size, frameW, frameH, fit]);
  const widthClass = useCockpitWidthClass();

  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [focusRaw, setFocusRaw] = useState<string | null>(null);

  const layouts = useMemo<GlyphLayout[]>(() => {
    if (!rendered) return [];
    const displayRect = (item: DrawItem): FrameRect | null => {
      if (reducedMotion || item.trackId == null || !item.detection || !freshBatch) return null;
      const b = smoothed.get(smoothKey(freshBatch.cameraId, item.trackId));
      return b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null;
    };
    const reveal = new Set<string>();
    if (hoverKey) reveal.add(hoverKey);
    if (focusRaw) reveal.add(focusRaw);
    return layoutTargets(resolved, {
      rendered,
      fontPx: tagFontPx(widthClass, !!pip),
      widthClass,
      displayRect,
      ghost,
      revealKeys: reveal,
    });
  }, [resolved, rendered, widthClass, pip, smoothed, ghost, hoverKey, focusRaw, reducedMotion, freshBatch]);

  const order = useMemo(() => focusOrder(layouts), [layouts]);
  const focusKey = focusRaw !== null && order.includes(focusRaw) ? focusRaw : null;

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
    enabled: !pip,
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
    if (!camera) return;
    void designateTarget(
      { droneId, cameraId: camera, trackId: null, bbox, classLabel: "", confidence: 0 },
      (message, status) => toast(tRoot.has(message) ? tRoot(message) : message, status ?? "info"),
    );
  };
  const selection = useTargetDrag(
    layerRef,
    rendered && camera && !videoLost ? { rendered, frameW, frameH } : null,
    onDragSelect,
  );

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
    <div
      ref={layerRef}
      className="tgt-layer"
      data-cockpit-layer={pip ? "pip-target-overlay" : "target-overlay"}
    >
      {layouts.map((l) => (
        <TargetGlyph key={l.key} layout={l} reducedMotion={reducedMotion} focused={l.key === focusKey} />
      ))}
      {hits.map((l) => (
        <button
          key={l.key}
          type="button"
          className="tgt-hit"
          data-target-interactive
          data-kind={l.kind}
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
      {popup && popupAt && (
        <div className="absolute z-[7]" style={{ left: popupAt.x, top: popupAt.y + popupAt.h + 4 }}>
          <TargetActionPopup target={popup} onClose={closePopup} />
        </div>
      )}
    </div>
  );
}
