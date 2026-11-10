"use client";

/**
 * @module cockpit/NavSourcePopover
 * @description The nav-source chip's popover (modal layer): the EKF source
 * sets 1–3 decoded to words with the active one marked, extnav health and
 * odometry rate, the GPS readout and the EKF flag words, plus `Use set N`
 * switches. A switch is a hold-to-confirm (the `hold` tier) that calls the
 * protocol's existing `setEkfSourceSet(N)`, records the commanded set and
 * reports the result as a toast.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { CONFIRM_HOLD_DEFAULT_MS } from "@/lib/skills/types";
import { refusalText } from "@/lib/hud/refusal";
import { EKF_FLAG, gpsFixWord, sourceValueKey } from "@/lib/hud/nav-source";
import { specString } from "@/lib/cockpit/spec-strings";
import type { NavSourceView } from "@/hooks/use-nav-source";
import { useDroneManager } from "@/stores/drone-manager";
import { useEkfSourceStore, type EkfSourceSet } from "@/stores/ekf-source-store";
import { NO_DATA_GLYPH } from "@/lib/hud-draw";
import { useToast } from "@/components/ui/toast";
import { HoldControl } from "./confirm/HoldControl";
import { useConfirmHold } from "./confirm/use-confirm-hold";
import { navFixText, navQualityText } from "./nav-source-text";

const SETS: readonly EkfSourceSet[] = [1, 2, 3];
const FIELDS = [
  ["nav_source.posxy", "POSXY"],
  ["nav_source.velxy", "VELXY"],
  ["nav_source.yaw", "YAW"],
] as const;
const FLAG_WORDS = [
  [EKF_FLAG.VEL_H, "nav_source.flag.vel_h"],
  [EKF_FLAG.POS_H_REL, "nav_source.flag.pos_rel"],
  [EKF_FLAG.POS_H_ABS, "nav_source.flag.pos_abs"],
  [EKF_FLAG.CONST_POS, "nav_source.flag.const_pos"],
  [EKF_FLAG.GPS_GLITCH, "nav_source.flag.glitch"],
] as const;
/** EK3_SRC value → spec key; values the table does not name read as no data. */
const SOURCE_KEY: Readonly<Record<string, string>> = {
  "0": "controls.action.none",
  "1": "agl.source.baro",
  "2": "nav_source.src.rangefinder",
  "3": "nav_source.gps",
  "4": "nav_source.src.beacon",
  "5": "nav_source.src.flow",
  "6": "nav_source.src.extnav",
  "7": "nav_source.src.wheel",
};

function sourceText(v: number | undefined): string {
  const key = SOURCE_KEY[sourceValueKey(v)];
  return key ? specString(key) : NO_DATA_GLYPH;
}
const POPOVER_W = 340;

interface NavSourcePopoverProps {
  droneId: string;
  view: NavSourceView;
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
}

export function NavSourcePopover({ droneId, view, anchor, onClose }: NavSourcePopoverProps) {
  const { toast } = useToast();
  const rootRef = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [pos, setPos] = useState({ top: 46, left: 8 });
  const [armed, setArmed] = useState<EkfSourceSet | null>(null);
  const [busy, setBusy] = useState(false);
  const { result, params, nav, gps, ekfFlags } = view;

  // Render at the cockpit root so the popover stacks above the band (z 50).
  useLayoutEffect(() => {
    const a = anchor.current;
    const root = (a?.closest(".ados-cockpit") as HTMLElement | null) ?? document.body;
    setHost(root);
    if (!a) return;
    const r = a.getBoundingClientRect();
    const c = root.getBoundingClientRect();
    // Opened from the top bar it starts below the bar, never over STOP.
    const bar = a.closest("[data-zone='top_bar']")?.getBoundingClientRect();
    const below = Math.max(r.bottom + 6, bar ? bar.bottom + 8 : 0);
    const maxLeft = Math.max(8, c.width - POPOVER_W - 8);
    setPos({ top: below - c.top, left: Math.min(Math.max(8, r.left - c.left), maxLeft) });
  }, [anchor]);

  // Escape or a press outside closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (rootRef.current?.contains(target) || anchor.current?.contains(target)) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [anchor, onClose]);

  const runSwitch = async (set: EkfSourceSet) => {
    setBusy(true);
    try {
      const protocol = useDroneManager.getState().drones.get(droneId)?.protocol;
      if (!protocol) {
        toast(specString("nav_source.switch_failed", { reason: refusalText("no_fc") }), "error");
        return;
      }
      const res = await protocol.setEkfSourceSet(set);
      if (res.ok) {
        useEkfSourceStore.getState().setLastCommanded(droneId, set);
        toast(specString("nav_source.set_active", { n: set }), "success");
      } else {
        toast(specString("nav_source.switch_failed", { reason: res.reason }), "error");
      }
    } catch (err) {
      toast(specString("nav_source.switch_failed", { reason: err instanceof Error ? err.message : String(err) }), "error");
    } finally {
      setBusy(false);
      setArmed(null);
    }
  };

  const holdMs = CONFIRM_HOLD_DEFAULT_MS.hold;
  const hold = useConfirmHold({
    holdMs,
    enabled: armed !== null && !busy,
    onComplete: () => {
      if (armed !== null) void runSwitch(armed);
    },
  });

  const flagWords = ekfFlags === null
    ? []
    : FLAG_WORDS.filter(([bit]) => (ekfFlags & bit) !== 0).map(([, key]) => specString(key));
  const health = nav?.extnavHealth ?? null;

  const body = (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={specString("nav_source.popover_title")}
      className="navpop glass-panel"
      style={{ top: pos.top, left: pos.left, width: POPOVER_W }}
      data-testid="nav-source-popover"
    >
      <div className="navpop-head">
        <span>{specString("nav_source.popover_title")}</span>
        <button type="button" onClick={onClose} aria-label={specString("cockpit.close")} className="navpop-x fs-hit">
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      <table className="navpop-sets">
        <thead>
          <tr>
            <th scope="col" />
            {FIELDS.map(([key]) => (
              <th key={key} scope="col">{specString(key)}</th>
            ))}
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          {SETS.map((n) => {
            const active = result.activeSet === n;
            return (
              <tr key={n} data-active={active ? "true" : undefined} data-testid={`nav-set-${n}`}>
                <th scope="row" className="whitespace-nowrap">{specString("nav_source.set_n", { n })}</th>
                {FIELDS.map(([key, suffix]) => (
                  <td key={key}>{sourceText(params?.[`EK3_SRC${n}_${suffix}`])}</td>
                ))}
                <td>
                  {active ? (
                    <span className="navpop-active">{specString("nav_source.active")}</span>
                  ) : (
                    <button
                      type="button"
                      className="navpop-use fs-hit"
                      aria-pressed={armed === n}
                      disabled={busy}
                      onClick={() => setArmed((cur) => (cur === n ? null : n))}
                    >
                      {specString("nav_source.use_set", { n })}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!params && <p className="navpop-note">{specString("nav_source.params_unknown")}</p>}

      {armed !== null && (
        <HoldControl
          hold={hold}
          holdMs={holdMs}
          label={busy ? specString("nav_source.switching") : specString("nav_source.use_set", { n: armed })}
          hint={specString("nav_source.hold_use_set", { n: armed })}
          danger={false}
          disabled={busy}
        />
      )}

      <div className="navpop-readouts">
        <div>
          {specString("nav_source.extnav_readout", {
            health: health ? navQualityText(health) : NO_DATA_GLYPH,
            hz: nav?.odomRateHz != null ? nav.odomRateHz.toFixed(0) : NO_DATA_GLYPH,
          })}
        </div>
        <div>
          {gps
            ? specString("nav_source.gps_readout", {
                fix: navFixText(gpsFixWord(gps.fixType)),
                sats: gps.satellites ?? NO_DATA_GLYPH,
                hdop: gps.hdop?.toFixed(1) ?? NO_DATA_GLYPH,
              })
            : NO_DATA_GLYPH}
        </div>
        <div>
          <span className="navpop-k">{specString("nav_source.flags")}</span>
          <span data-testid="nav-flags">{flagWords.length > 0 ? flagWords.join(" · ") : specString("controls.action.none")}</span>
        </div>
      </div>

      {nav?.mode === "external_nav" && <p className="navpop-note">{specString("nav_source.auto_note")}</p>}
    </div>
  );

  return host ? createPortal(body, host) : null;
}
