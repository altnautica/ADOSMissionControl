"use client";

/**
 * @module fly/CockpitPipInset
 * @description The cockpit picture-in-picture inset: a small draggable corner
 * window over the main video showing a SECOND stream (e.g. thermal over EO)
 * while the main view stays on the active stream. Shown only when a PiP stream
 * is set (the operator toggles it with `P` or a tab affordance). Overlays follow
 * the MAIN active stream, not this inset.
 *
 * The inset uses an isolated WHEP player (`usePipVideo`) because the main feed
 * is the one *shared* receive session, and a PiP leg is a different stream —
 * acquiring a second, different stream through the shared session would
 * displace the first. In demo mode there is no live WebRTC, so it renders the
 * synthetic per-stream canvas instead.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { isDemoMode } from "@/lib/utils";
import { usePipVideo } from "@/hooks/use-pip-video";
import {
  ROLE_LABEL_KEY,
  useVideoStreamsStore,
} from "@/stores/video-streams-store";
import { useSettingsStore } from "@/stores/settings-store";
import { DEFAULT_LOADOUT_ID } from "@/stores/settings/keybindings-slice";
import { CockpitDemoStream } from "@/components/cockpit/CockpitDemoStream";

interface CockpitPipInsetProps {
  droneId: string;
}

/** Clamp an inset position (px from the container's top-left) so the inset of
 * `elW x elH` stays fully inside a `parentW x parentH` container. The single
 * source of truth for the drag clamp, the restore clamp, and the resize clamp,
 * so a smaller viewport can never strand the inset off-screen. */
export function clampToBounds(
  x: number,
  y: number,
  parentW: number,
  parentH: number,
  elW: number,
  elH: number,
): { x: number; y: number } {
  return {
    x: Math.min(Math.max(0, x), Math.max(0, parentW - elW)),
    y: Math.min(Math.max(0, y), Math.max(0, parentH - elH)),
  };
}

export function CockpitPipInset({ droneId }: CockpitPipInsetProps) {
  const t = useTranslations("cockpitStreams");
  const pipId = useVideoStreamsStore((s) => s.pipStreamIdByDrone[droneId]);
  const streams = useVideoStreamsStore((s) => s.streamsByDrone[droneId]);
  const setPip = useVideoStreamsStore((s) => s.setPip);

  // Inset placement persists per-loadout (like density), so a saved preset
  // restores its own PiP position instead of resetting on every remount.
  const activeLoadoutId = useSettingsStore((s) => s.activeLoadoutId);
  const loadouts = useSettingsStore((s) => s.loadouts);
  const setLoadoutLayout = useSettingsStore((s) => s.setLoadoutLayout);
  const savedPos =
    (loadouts[activeLoadoutId] ?? loadouts[DEFAULT_LOADOUT_ID])?.layout
      .pipPosition ?? null;

  const videoRef = useRef<HTMLVideoElement>(null);
  // Drag position (px from the container's top-left). Null → the default
  // bottom-right corner via CSS. Seeded from the persisted per-loadout value.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(savedPos);
  const dragRef = useRef<{ ox: number; oy: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // The latest position, readable inside the (non-reactive) ResizeObserver
  // callback without re-subscribing the observer on every drag.
  const posRef = useRef(pos);
  posRef.current = pos;

  // Persist a committed position (drag end / keyboard nudge / a resize re-clamp)
  // to the active loadout — never per-move (that would thrash the persisted
  // store). Stable per loadout so effects can depend on it.
  const persistPos = useCallback(
    (next: { x: number; y: number }) => {
      setLoadoutLayout(activeLoadoutId, { pipPosition: next });
    },
    [activeLoadoutId, setLoadoutLayout],
  );

  // On mount / loadout switch, restore the saved position clamped to the current
  // container so a smaller viewport can never leave the inset off-screen.
  useEffect(() => {
    const saved =
      (loadouts[activeLoadoutId] ?? loadouts[DEFAULT_LOADOUT_ID])?.layout
        .pipPosition ?? null;
    if (!saved) {
      setPos(null);
      return;
    }
    const el = rootRef.current;
    const parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent) {
      setPos(saved);
      return;
    }
    const prect = parent.getBoundingClientRect();
    setPos(
      clampToBounds(
        saved.x,
        saved.y,
        prect.width,
        prect.height,
        el.offsetWidth,
        el.offsetHeight,
      ),
    );
    // Re-run on a loadout switch (each loadout carries its own PiP position);
    // `loadouts` is read fresh inside so it is intentionally not a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLoadoutId, pipId]);

  // Re-clamp on any container size change (window resize, leaving immersive
  // mode, a side-panel layout change): a fixed px position that was valid in a
  // larger container would otherwise strand the inset off-screen. Runs the SAME
  // clamp as the drag/restore paths and persists the corrected value.
  useEffect(() => {
    const parent = rootRef.current?.offsetParent as HTMLElement | null;
    if (!parent) return;
    const reclamp = () => {
      const cur = posRef.current;
      const el = rootRef.current;
      const p = el?.offsetParent as HTMLElement | null;
      if (!cur || !el || !p) return; // the default CSS corner never strands
      const prect = p.getBoundingClientRect();
      const next = clampToBounds(
        cur.x,
        cur.y,
        prect.width,
        prect.height,
        el.offsetWidth,
        el.offsetHeight,
      );
      if (next.x !== cur.x || next.y !== cur.y) {
        setPos(next);
        persistPos(next);
      }
    };
    const ro = new ResizeObserver(reclamp);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [pipId, persistPos]);

  const pip = (streams ?? []).find((s) => s.id === pipId) ?? null;
  const whepUrl =
    pip?.kind === "concurrent" ? (pip.address?.whepUrl ?? null) : null;
  // Only drive the isolated player for a real concurrent leg (demo uses canvas).
  const { status: pipStatus, retry: pipRetry } = usePipVideo(
    isDemoMode() ? null : whepUrl,
    videoRef,
  );

  if (!pip) return null;

  const label = pip.role && ROLE_LABEL_KEY[pip.role] ? t(ROLE_LABEL_KEY[pip.role]) : pip.label;

  const onPointerDown = (e: React.PointerEvent) => {
    const el = rootRef.current;
    const parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent) return;
    const rect = el.getBoundingClientRect();
    const prect = parent.getBoundingClientRect();
    // Switch to explicit px positioning from wherever the inset currently sits.
    setPos({ x: rect.left - prect.left, y: rect.top - prect.top });
    dragRef.current = { ox: e.clientX - rect.left, oy: e.clientY - rect.top };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    const el = rootRef.current;
    const parent = el?.offsetParent as HTMLElement | null;
    if (!drag || !el || !parent) return;
    const prect = parent.getBoundingClientRect();
    setPos(
      clampToBounds(
        e.clientX - prect.left - drag.ox,
        e.clientY - prect.top - drag.oy,
        prect.width,
        prect.height,
        el.offsetWidth,
        el.offsetHeight,
      ),
    );
  };
  const onPointerUp = (e: React.PointerEvent) => {
    dragRef.current = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    if (pos) persistPos(pos);
  };

  // Keyboard move: arrow keys nudge the inset (shift = larger step), clamped to
  // the container so it can never be pushed off-screen. Mirrors the drag clamp.
  const nudge = (dx: number, dy: number) => {
    const el = rootRef.current;
    const parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent) return;
    const rect = el.getBoundingClientRect();
    const prect = parent.getBoundingClientRect();
    const curX = pos ? pos.x : rect.left - prect.left;
    const curY = pos ? pos.y : rect.top - prect.top;
    const next = clampToBounds(
      curX + dx,
      curY + dy,
      prect.width,
      prect.height,
      el.offsetWidth,
      el.offsetHeight,
    );
    setPos(next);
    persistPos(next);
  };
  const onHandleKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 40 : 12;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      nudge(-step, 0);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      nudge(step, 0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      nudge(0, -step);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      nudge(0, step);
    }
  };

  const style: React.CSSProperties = pos
    ? { left: `${pos.x}px`, top: `${pos.y}px`, right: "auto", bottom: "auto" }
    : {};

  return (
    <div
      ref={rootRef}
      className="pipinset panel pointer-events-auto"
      style={style}
      data-cockpit-layer="pip"
    >
      <div
        className="piphead"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {/* The label doubles as the keyboard-movable handle (arrow keys nudge
            the inset); the drag pointer handlers stay on the whole header. */}
        <span
          className="lbl"
          role="button"
          tabIndex={0}
          aria-label={t("pipMove")}
          onKeyDown={onHandleKeyDown}
        >
          {label}
        </span>
        <button
          type="button"
          className="pipclose"
          aria-label={t("pipHide")}
          title={t("pipHide")}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setPip(droneId, null)}
        >
          <X size={12} aria-hidden="true" />
        </button>
      </div>
      <div className="pipbody">
        {isDemoMode() ? (
          <CockpitDemoStream droneId={droneId} streamId={pip.id} />
        ) : (
          <>
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="absolute inset-0 h-full w-full object-cover"
            />
            {/* A failed / connecting inset shows its state instead of a silent
                black rectangle (mirrors the main VideoCanvas placeholder). */}
            {pipStatus !== "live" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-bg-primary/70">
                {pipStatus === "error" ? (
                  <>
                    <span className="text-[9px] font-mono uppercase tracking-wider text-status-error">
                      {t("pipNoSignal")}
                    </span>
                    <button
                      type="button"
                      onClick={pipRetry}
                      aria-label={t("pipRetry")}
                      className="flex items-center gap-1 border border-border-default px-1.5 py-0.5 text-[9px] font-mono text-text-secondary transition-colors hover:border-accent-primary hover:text-accent-primary"
                    >
                      <RefreshCw size={9} aria-hidden="true" />
                      {t("pipRetry")}
                    </button>
                  </>
                ) : (
                  <Loader2
                    size={16}
                    className="animate-spin text-text-tertiary"
                    aria-label={t("pipConnecting")}
                  />
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
