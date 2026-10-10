"use client";

/**
 * The safety band's stick-control chip: whether gamepad sticks are flying the
 * vehicle (manual control on/off), why the link cannot carry stick frames
 * when it cannot, and who holds pilot-in-command on the ground station when a
 * claim exists.
 *
 * The toggle is the same input-store opt-in the input settings page owns: off
 * at every start, needs a connected gamepad and a live session for this
 * drone, and is revoked by the store when the pad drops.
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { Gamepad2 } from "lucide-react";
import { useInputStore } from "@/stores/input-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useGroundStationStore } from "@/stores/ground-station-store";

export function StickControlChip({ droneId }: { droneId: string }) {
  const t = useTranslations("cockpit.band");
  const hasGamepad = useInputStore((s) => s.activeController === "gamepad");
  const enabled = useInputStore((s) => s.manualControlEnabled);
  const setEnabled = useInputStore((s) => s.setManualControlEnabled);
  const linkBlock = useInputStore((s) => s.manualControlLinkBlock);
  const hasSession = useDroneManager((s) => s.drones.has(droneId));
  const picHolder = useGroundStationStore((s) => s.pic.claimed_by);

  const available = hasGamepad && hasSession;
  const blocked = enabled && linkBlock !== null;
  const color = blocked ? "var(--hud-warn)" : enabled ? "var(--hud-good)" : "var(--hud-ink-2)";
  const title = !hasGamepad
    ? t("stickNoGamepad")
    : !hasSession
      ? t("stickNoSession")
      : blocked
        ? linkBlock
        : enabled
          ? t("stickDisableTitle")
          : t("stickEnableTitle");

  return (
    <div className="stat" data-testid="cockpit-stick">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={t("stick")}
        title={title}
        disabled={!available && !enabled}
        onClick={() => setEnabled(!enabled)}
        className="pointer-events-auto flex items-center gap-1.5 rounded px-1 py-0.5 transition-colors duration-200 ease-out disabled:cursor-not-allowed disabled:opacity-50"
        style={{ color, background: "none", border: 0, cursor: available ? "pointer" : undefined }}
      >
        <Gamepad2 size={13} aria-hidden="true" />
        <span className="k" style={{ color: "inherit" }}>
          {t("stick")}
        </span>
        <span className="v" style={{ color: "inherit", fontSize: 11 }}>
          {blocked ? t("stickBlocked") : enabled ? t("stickOn") : t("stickOff")}
        </span>
      </button>
      {picHolder && (
        <span className="k keep" title={t("picTitle", { holder: picHolder })}>
          {t("picHolder", { holder: picHolder })}
        </span>
      )}
    </div>
  );
}
