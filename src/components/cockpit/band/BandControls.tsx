"use client";

/**
 * The safety band's interactive and clock cells: the immersive exit/enter
 * control, the unified REC control, the flight timer, and the Kill control.
 * Each is its own component so its subscription (the 1 Hz clock, the
 * recording stores, the UI store) re-renders that cell alone.
 *
 * @license GPL-3.0-only
 */

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, CircleDot, Maximize2, OctagonX, Square, Timer } from "lucide-react";
import { useUiStore } from "@/stores/ui-store";
import { useDroneStore } from "@/stores/drone-store";
import { useClockTick } from "@/lib/agent/freshness";
import { activate, buildSkillContext } from "@/lib/skills";
import { useFlightRecording } from "@/hooks/use-flight-recording";
import { RecTimer } from "../RecTimer";
import { formatElapsed, msSince } from "./format";

const QUIET_BUTTON = {
  background: "none",
  border: 0,
  cursor: "pointer",
} as const;

const noSubscribe = () => () => {};

/** A `?kiosk=1` surface has no shell to exit to and no immersive toggle. */
function readKiosk(): boolean {
  return new URLSearchParams(window.location.search).get("kiosk") === "1";
}

export function BandExitControl() {
  const t = useTranslations("cockpit");
  const immersive = useUiStore((s) => s.immersiveMode);
  const enter = useUiStore((s) => s.enterImmersiveMode);
  const exit = useUiStore((s) => s.exitImmersiveMode);
  const kiosk = useSyncExternalStore(noSubscribe, readKiosk, () => false);
  if (kiosk) return null;

  return immersive ? (
    <button
      type="button"
      onClick={exit}
      aria-label={t("exitImmersiveTitle")}
      title={t("exitImmersiveTitle")}
      className="pointer-events-auto mr-1 flex items-center transition-colors duration-200 ease-out hover:text-[var(--hud-ink)]"
      style={{ ...QUIET_BUTTON, color: "var(--hud-ink-2)" }}
    >
      <ChevronLeft size={14} />
    </button>
  ) : (
    <button
      type="button"
      onClick={enter}
      aria-label={t("immersive")}
      title={t("immersiveTitle")}
      className="pointer-events-auto mr-1 flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide transition-colors duration-200 ease-out hover:text-[var(--hud-ink)]"
      style={{ ...QUIET_BUTTON, color: "var(--hud-ink-2)" }}
    >
      <Maximize2 size={12} />
      <span className="band-text">{t("immersive")}</span>
    </button>
  );
}

export function BandRecControl({ droneId }: { droneId: string }) {
  const t = useTranslations("cockpit");
  const { isRecording, toggle } = useFlightRecording(droneId);
  return (
    <div className="stat" data-testid="cockpit-rec">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={isRecording}
        aria-label={isRecording ? t("recStop") : t("rec")}
        title={isRecording ? t("recStop") : t("recTitle")}
        className="pointer-events-auto flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide transition-colors duration-200 ease-out"
        style={{ ...QUIET_BUTTON, color: isRecording ? "var(--hud-crit)" : "var(--hud-ink-2)" }}
      >
        {isRecording ? (
          <Square size={11} className="fill-current" aria-hidden="true" />
        ) : (
          <CircleDot size={12} aria-hidden="true" />
        )}
        {t("rec")}
        {isRecording && <RecTimer droneId={droneId} />}
      </button>
    </div>
  );
}

/**
 * m:ss since the vehicle's arm transition. Derived from `armedAt` in the
 * drone store, so leaving the cockpit and coming back never restarts it.
 */
export function BandFlightTimer() {
  const t = useTranslations("cockpit");
  const armedAt = useDroneStore((s) => s.armedAt);
  useClockTick();
  return (
    <div className="stat" data-testid="cockpit-flight-time">
      <Timer size={12} className="ki" aria-hidden="true" />
      <span className="k">{t("band.time")}</span>
      <span className={armedAt === null ? "v opacity-60" : "v"}>
        {armedAt === null ? "--:--" : formatElapsed(msSince(armedAt))}
      </span>
    </div>
  );
}

/**
 * Kill is a skill: the press goes through the shared activation pipeline,
 * whose confirm sheet owns the guard and the hold. The band never cuts
 * motors itself.
 */
export function BandKillButton({ droneId }: { droneId: string }) {
  const t = useTranslations("skills.kill");
  return (
    <div className="stat">
      <button
        type="button"
        onClick={() => void activate("kill", buildSkillContext(droneId), { gamepadButton: undefined })}
        title={t("effect")}
        data-testid="cockpit-kill"
        className="pointer-events-auto flex h-[24px] items-center gap-1.5 rounded-md px-2 font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors duration-200 ease-out"
        style={{
          color: "var(--hud-crit)",
          background: "color-mix(in oklch, var(--hud-crit) 14%, transparent)",
          border: "1px solid color-mix(in oklch, var(--hud-crit) 60%, transparent)",
          cursor: "pointer",
        }}
      >
        <OctagonX size={13} aria-hidden="true" />
        <span className="kill-text">{t("label")}</span>
      </button>
    </div>
  );
}
