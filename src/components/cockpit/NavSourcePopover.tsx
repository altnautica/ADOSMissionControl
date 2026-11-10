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
import { useTranslations } from "next-intl";
import { X } from "lucide-react";

import { CONFIRM_HOLD_DEFAULT_MS } from "@/lib/skills/types";
import { refusalText } from "@/lib/hud/refusal";
import { EKF_FLAG, gpsFixWord, sourceValueKey } from "@/lib/hud/nav-source";
import type { NavSourceView } from "@/hooks/use-nav-source";
import { useDroneManager } from "@/stores/drone-manager";
import { useEkfSourceStore, type EkfSourceSet } from "@/stores/ekf-source-store";
import { NO_DATA_GLYPH } from "@/lib/hud-draw";
import { useToast } from "@/components/ui/toast";
import { HoldControl } from "./confirm/HoldControl";
import { useConfirmHold } from "./confirm/use-confirm-hold";

const SETS: readonly EkfSourceSet[] = [1, 2, 3];
const FIELDS = [
  ["posxy", "POSXY"],
  ["velxy", "VELXY"],
  ["yaw", "YAW"],
] as const;
const FLAG_WORDS = [
  [EKF_FLAG.VEL_H, "flagVelH"],
  [EKF_FLAG.POS_H_REL, "flagPosRel"],
  [EKF_FLAG.POS_H_ABS, "flagPosAbs"],
  [EKF_FLAG.CONST_POS, "flagConstPos"],
  [EKF_FLAG.GPS_GLITCH, "flagGlitch"],
] as const;
const POPOVER_W = 340;

interface NavSourcePopoverProps {
  droneId: string;
  view: NavSourceView;
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
}

export function NavSourcePopover({ droneId, view, anchor, onClose }: NavSourcePopoverProps) {
  const t = useTranslations("hud.nav");
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
        toast(t("switchFailed", { reason: refusalText("no_fc") }), "error");
        return;
      }
      const res = await protocol.setEkfSourceSet(set);
      if (res.ok) {
        useEkfSourceStore.getState().setLastCommanded(droneId, set);
        toast(t("switched", { n: set }), "success");
      } else {
        toast(t("switchFailed", { reason: res.reason }), "error");
      }
    } catch (err) {
      toast(t("switchFailed", { reason: err instanceof Error ? err.message : String(err) }), "error");
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
    : FLAG_WORDS.filter(([bit]) => (ekfFlags & bit) !== 0).map(([, key]) => t(key));
  const health = nav?.extnavHealth ?? null;

  const body = (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={t("popoverTitle")}
      className="navpop glass-panel"
      style={{ top: pos.top, left: pos.left, width: POPOVER_W }}
      data-testid="nav-source-popover"
    >
      <div className="navpop-head">
        <span>{t("popoverTitle")}</span>
        <button type="button" onClick={onClose} aria-label={t("close")} className="navpop-x fs-hit">
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      <table className="navpop-sets">
        <thead>
          <tr>
            <th scope="col" />
            {FIELDS.map(([key]) => (
              <th key={key} scope="col">{t(key)}</th>
            ))}
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          {SETS.map((n) => {
            const active = result.activeSet === n;
            return (
              <tr key={n} data-active={active ? "true" : undefined} data-testid={`nav-set-${n}`}>
                <th scope="row" className="whitespace-nowrap">{t("set", { n })}</th>
                {FIELDS.map(([key, suffix]) => (
                  <td key={key}>{t(`src.${sourceValueKey(params?.[`EK3_SRC${n}_${suffix}`])}`)}</td>
                ))}
                <td>
                  {active ? (
                    <span className="navpop-active">{t("active")}</span>
                  ) : (
                    <button
                      type="button"
                      className="navpop-use fs-hit"
                      aria-pressed={armed === n}
                      disabled={busy}
                      onClick={() => setArmed((cur) => (cur === n ? null : n))}
                    >
                      {t("useSet", { n })}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!params && <p className="navpop-note">{t("paramsUnknown")}</p>}

      {armed !== null && (
        <HoldControl
          hold={hold}
          holdMs={holdMs}
          label={busy ? t("switching") : t("useSet", { n: armed })}
          hint={t("holdToSwitch", { n: armed })}
          danger={false}
          disabled={busy}
        />
      )}

      <div className="navpop-readouts">
        <div>
          <span className="navpop-k">{t("extnav")}</span>
          <span>
            {health ? t(`q.${health}`) : NO_DATA_GLYPH}
            {nav?.odomRateHz != null && ` · ${t("odomRate", { hz: nav.odomRateHz.toFixed(0) })}`}
          </span>
        </div>
        <div>
          {gps
            ? t("gpsReadout", {
                fix: t(`fix.${gpsFixWord(gps.fixType)}`),
                sats: gps.satellites ?? NO_DATA_GLYPH,
                hdop: gps.hdop?.toFixed(1) ?? NO_DATA_GLYPH,
              })
            : NO_DATA_GLYPH}
        </div>
        <div>
          <span className="navpop-k">{t("flags")}</span>
          <span data-testid="nav-flags">{flagWords.length > 0 ? flagWords.join(" · ") : t("noFlags")}</span>
        </div>
      </div>

      {nav?.mode === "external_nav" && <p className="navpop-note">{t("autoSwitch")}</p>}
    </div>
  );

  return host ? createPortal(body, host) : null;
}
