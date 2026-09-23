"use client";

/**
 * @module fly/CockpitStreamTabs
 * @description The cockpit's top-left stream switcher: sleek minified tabs that
 * toggle the main video view between the streams a node exposes. Press `1..N`
 * (the digit is on the tab) or click a tab to switch — a Predator-vision flip
 * with a left-to-right slide-in reveal. Auto-appears ONLY when the node has more
 * than one stream (self-gates at `<= 1`), auto-sizes to the count, and shows a
 * transient "switching…" shimmer on the active tab while a single-encoder node
 * restarts (never a black frame).
 *
 * Universal by construction: it reads the normalized {@link StreamDescriptor}
 * list from the store, so a native dual-camera node, a smart pod, or any future
 * source renders identically — no per-source UI. Selecting a tab mutates the
 * pure store; `useVideoStreams` (mounted in the cockpit) performs the transport
 * side effect (switchCamera restart / instant WHEP re-point).
 *
 * @license GPL-3.0-only
 */

import { useRef } from "react";
import { VideoOff } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  ROLE_LABEL_KEY,
  useVideoStreamsStore,
  type StreamDescriptor,
} from "@/stores/video-streams-store";

/** Short display label for a stream: the localized role name when known, else
 * the raw camera name the agent advertised. */
function streamLabel(
  s: StreamDescriptor,
  t: (key: string) => string,
): string {
  const key = s.role ? ROLE_LABEL_KEY[s.role] : undefined;
  return key ? t(key) : s.label;
}

interface CockpitStreamTabsProps {
  droneId: string;
}

export function CockpitStreamTabs({ droneId }: CockpitStreamTabsProps) {
  const t = useTranslations("cockpitStreams");
  const streams = useVideoStreamsStore((s) => s.streamsByDrone[droneId]);
  const activeId = useVideoStreamsStore((s) => s.activeStreamIdByDrone[droneId]);
  const switching = useVideoStreamsStore((s) => s.switchingByDrone[droneId]);
  const selectStream = useVideoStreamsStore((s) => s.selectStream);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Auto-detect: nothing to switch with zero or one stream.
  if (!streams || streams.length <= 1) return null;

  const active = activeId ?? streams[0]?.id;
  const activeIndex = Math.max(
    0,
    streams.findIndex((s) => s.id === active),
  );

  // A leg the agent sampled as not producing (`live === false`) is dead: it
  // renders disabled and is never selectable. `undefined`/`null` is not dead.
  const isDeadAt = (i: number): boolean => streams[i]?.live === false;
  // The next SELECTABLE index in `step` direction (skips dead legs, wraps).
  // Returns `from` when every other leg is dead.
  const nextSelectable = (from: number, step: number): number => {
    const n = streams.length;
    for (let k = 1; k <= n; k++) {
      const idx = (((from + step * k) % n) + n) % n;
      if (!isDeadAt(idx)) return idx;
    }
    return from;
  };

  // Roving-tabindex keyboard nav: arrows / Home / End move the selection and
  // the focus together along the tablist (the digit hotkeys are handled at the
  // cockpit level). Automatic activation — moving focus activates the tab, the
  // standard single-select tablist pattern. Dead legs are skipped.
  const onKeyDown = (e: React.KeyboardEvent) => {
    // Ignore navigation while a single-encoder restart is in flight so rapid
    // arrow presses do not stack overlapping switches.
    if (switching) return;
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      next = nextSelectable(activeIndex, 1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      next = nextSelectable(activeIndex, -1);
    } else if (e.key === "Home") {
      next = nextSelectable(streams.length - 1, 1); // first selectable
    } else if (e.key === "End") {
      next = nextSelectable(0, -1); // last selectable
    }
    if (next == null) return;
    e.preventDefault();
    selectStream(droneId, streams[next]!.id);
    tabRefs.current[next]?.focus();
  };

  return (
    <>
      <div
        className="strmtabs panel"
        role="tablist"
        aria-label={t("switcherLabel")}
        aria-orientation="horizontal"
        aria-busy={switching || undefined}
        data-cockpit-layer="stream-tabs"
        onKeyDown={onKeyDown}
      >
        {streams.map((s, i) => {
          const label = streamLabel(s, t);
          const isActive = s.id === active;
          const isDead = s.live === false;
          // A dead leg names its state so the reason it is disabled is not a
          // silent gray-out (the surface says why).
          const hint = isDead
            ? `${t("selectStream", { label })} — ${t("pipNoSignal")}`
            : t("selectStream", { label });
          return (
            <button
              key={s.id}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              aria-selected={isActive}
              // Roving tabindex: only the active tab is in the tab order.
              tabIndex={isActive ? 0 : -1}
              // Ignore clicks while a restart is in flight (a debounce so rapid
              // clicks do not stack overlapping switches) or on a dead leg.
              // Focus is preserved (not the native `disabled`) so keyboard nav
              // still works.
              aria-disabled={switching || isDead || undefined}
              title={hint}
              aria-label={hint}
              className={`strmtab${isActive ? " active" : ""}${
                isActive && switching ? " switching" : ""
              }${isDead ? " opacity-40" : ""}`}
              style={{ animationDelay: `${i * 45}ms` }}
              onClick={() => {
                if (switching || isDead) return;
                selectStream(droneId, s.id);
              }}
            >
              <span className="kbd" aria-hidden="true">
                {s.index}
              </span>
              <span className={`lbl${isDead ? " line-through" : ""}`}>
                {label}
              </span>
              {isDead && (
                <VideoOff size={11} aria-hidden="true" className="ml-0.5" />
              )}
            </button>
          );
        })}
      </div>
      {/* Announce the optimistic single-encoder restart to assistive tech (the
          shimmer alone is a silent visual cue). Outside the tablist so it never
          reads as a tab. */}
      <span className="sr-only" role="status" aria-live="polite">
        {switching ? t("switching") : ""}
      </span>
    </>
  );
}
