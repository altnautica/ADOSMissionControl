/**
 * @module GuidedConfirmDialog
 * @description Confirmation dialog for "Fly Here" guided mode commands.
 * Shows target coordinates, distance, ETA, and altitude picker.
 * Requires the spec Fly Here hold (`holds_ms.fly_here`, 800 ms) through the
 * shared confirm hold (pointer, Enter or the gamepad button), then dispatches
 * the `fly-here` skill so the command passes the same arm gate, debounce and
 * refusal reporting as every other flight command. On the flight screen it
 * sits under the sheet rules: below the top bar, beside the left column.
 * @license GPL-3.0-only
 */
"use client";

import { useState, useCallback, useEffect, useRef, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { useGuidedStore, type GuidedConfirmPending } from "@/stores/guided-store";
import { useSkillConfirmStore } from "@/stores/skill-confirm-store";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useFreshTelemetry } from "@/hooks/use-telemetry-latest";
import { freshOnly } from "@/lib/telemetry/freshness";
import { activate, buildSkillContext, SPEC_HOLD_MS } from "@/lib/skills";
import { FLY_HERE_ALTITUDE_M, parseFlyHereAltitude } from "@/lib/skills/builtins/fly-here";
import { X, Navigation } from "lucide-react";
import { haversineDistance } from "@/lib/geo/distance";
import { specString } from "@/lib/cockpit/spec-strings";
import { fmtDistance, fmtEta } from "@/lib/hud/format";
import { useConfirmHold } from "@/components/cockpit/confirm/use-confirm-hold";
import { HoldControl } from "@/components/cockpit/confirm/HoldControl";
import { useFlightGrid } from "@/components/cockpit/flight/flight-context";
import {
  sheetPlacement,
  useFlightRoot,
  useFlightSheet,
  useSheetDismiss,
} from "@/components/cockpit/flight/flight-sheet";

/** The Fly Here confirm hold, the same on every surface (spec `holds_ms`). */
const HOLD_DURATION_MS = SPEC_HOLD_MS.fly_here;
const DEFAULT_ALT_M = 10;

/**
 * `flightScreenHost`: the one instance the flight screen mounts. While a
 * flight screen is up every other instance (a map pane's own) renders
 * nothing, so one right-click opens one dialog. A hidden instance mounts no
 * hold either, so only the dialog on screen answers Enter or the pad.
 */
export function GuidedConfirmDialog({ flightScreenHost = false }: { flightScreenHost?: boolean } = {}) {
  const storedPending = useGuidedStore((s) => s.confirmPending);
  const selectedDroneId = useDroneManager((s) => s.selectedDroneId);
  // A confirmation belongs to the drone it was raised for; it never re-opens
  // for another one after the selection changes.
  const confirmPending = storedPending?.droneId === selectedDroneId ? storedPending : null;
  const dismissConfirm = useGuidedStore((s) => s.dismissConfirm);
  // An open skill confirm (the emergency stop above all) owns Enter and the
  // pad's confirm button, so one hold never drives both it and a reposition:
  // Fly Here closes when one opens and is refused while one shows.
  const skillConfirmOpen = useSkillConfirmStore((s) => s.pending !== null);
  useEffect(() => {
    if (skillConfirmOpen && storedPending !== null) dismissConfirm();
  }, [skillConfirmOpen, storedPending, dismissConfirm]);
  const flightRoot = useFlightRoot();
  const onFlightScreen = flightScreenHost || flightRoot !== null;
  const shown = confirmPending !== null && !skillConfirmOpen && (flightScreenHost || !onFlightScreen);

  if (!confirmPending || !shown) return null;
  return (
    <FlyHereDialog
      confirmPending={confirmPending}
      flightScreenHost={flightScreenHost}
      onFlightScreen={onFlightScreen}
      dismissConfirm={dismissConfirm}
    />
  );
}

/** The dialog on screen, with its altitude box and its confirm hold. */
function FlyHereDialog({
  confirmPending,
  flightScreenHost,
  onFlightScreen,
  dismissConfirm,
}: {
  confirmPending: GuidedConfirmPending;
  flightScreenHost: boolean;
  onFlightScreen: boolean;
  dismissConfirm: () => void;
}) {
  const t = useTranslations();

  // Current drone position for distance/ETA, only while it is fresh: a frozen
  // position would measure the target from where the aircraft used to be.
  const latestPos = useFreshTelemetry("position");

  // Kept as typed so a cleared box reads as "no altitude", never as 0 m.
  const [altitudeText, setAltitudeText] = useState(String(DEFAULT_ALT_M));
  const [error, setError] = useState<string | null>(null);
  const grid = useFlightGrid();
  const ref = useRef<HTMLDivElement>(null);

  // Escape and a press outside close it; focus returns where it was.
  useSheetDismiss(ref, dismissConfirm);

  const altitude = parseFlyHereAltitude(altitudeText);

  // Initialize altitude from current drone altitude on each new target (not on telemetry updates)
  useEffect(() => {
    const pos = freshOnly(useTelemetryStore.getState().position.latest(), Date.now());
    const initAlt = pos?.relativeAlt !== undefined ? Math.round(pos.relativeAlt) : DEFAULT_ALT_M;
    setAltitudeText(
      String(Math.min(Math.max(initAlt, FLY_HERE_ALTITUDE_M.min), FLY_HERE_ALTITUDE_M.max)),
    );
    setError(null);
  }, [confirmPending]);

  const hasGps = latestPos !== undefined && latestPos.lat !== 0;
  const distance = hasGps
    ? haversineDistance(latestPos.lat, latestPos.lon, confirmPending.lat, confirmPending.lon)
    : null;
  const eta =
    distance !== null && latestPos && latestPos.groundSpeed >= 0.5
      ? distance / latestPos.groundSpeed
      : null;

  const handleConfirm = useCallback(async () => {
    if (altitude === null) {
      setError(specString("refusal.fly_here_target"));
      return;
    }
    // The dispatcher surfaces any refusal (no link, not armed, the vehicle's
    // own rejection). An accepted reposition sets the guided target, which
    // closes this dialog; otherwise it stays open for another attempt.
    await activate("fly-here", buildSkillContext(confirmPending.droneId), {
      lat: confirmPending.lat,
      lon: confirmPending.lon,
      altitudeM: altitude,
    });
  }, [confirmPending, altitude]);

  // One hold engine for every confirm: pointer, Enter (the altitude box keeps
  // its own Enter) or the gamepad confirm button.
  const hold = useConfirmHold({
    holdMs: HOLD_DURATION_MS,
    enabled: altitude !== null,
    onComplete: () => void handleConfirm(),
  });

  // On the flight screen the dialog follows the sheet rules; elsewhere it
  // keeps to the bottom centre of its map.
  const placement: CSSProperties | undefined = onFlightScreen
    ? { position: "absolute", ...sheetPlacement(grid, "left") }
    : undefined;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={specString("map.fly_here")}
      data-testid="fly-here-dialog"
      style={placement}
      className={`${onFlightScreen ? "" : "absolute bottom-4 left-1/2 -translate-x-1/2 "}z-[1100] w-[320px] bg-bg-secondary/95 backdrop-blur-sm border border-border-default rounded-lg shadow-lg overflow-hidden`}
    >
      {flightScreenHost && <FlyHereSheetClaim onClosed={dismissConfirm} />}
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default">
        <div className="flex items-center gap-2">
          <Navigation size={14} className="text-accent-primary" />
          <span className="text-xs font-semibold text-text-primary">{specString("map.fly_here")}</span>
        </div>
        <button
          onClick={dismissConfirm}
          className="text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
          aria-label={specString("cockpit.close")}
        >
          <X size={14} />
        </button>
      </div>

      {/* Content */}
      <div className="px-3 py-2 flex flex-col gap-2">
        {/* GPS warning */}
        {!hasGps && (
          <div className="px-2 py-1 bg-status-error/10 border border-status-error/30 rounded">
            <span className="text-[10px] text-status-error">{specString("map.fly_here.no_gps")}</span>
          </div>
        )}

        {/* Coordinates */}
        <div className="flex gap-4">
          <div>
            <span className="text-[9px] text-text-tertiary uppercase">{specString("map.fly_here.lat")}</span>
            <p className="text-xs font-mono text-text-primary">{confirmPending.lat.toFixed(6)}</p>
          </div>
          <div>
            <span className="text-[9px] text-text-tertiary uppercase">{specString("map.fly_here.lon")}</span>
            <p className="text-xs font-mono text-text-primary">{confirmPending.lon.toFixed(6)}</p>
          </div>
        </div>

        {/* Distance & ETA */}
        {distance !== null && (
          <div className="flex gap-4">
            <div>
              <span className="text-[9px] text-text-tertiary uppercase">{specString("map.fly_here.distance")}</span>
              <p className="text-xs font-mono text-text-primary">{fmtDistance(distance)}</p>
            </div>
            {eta !== null && (
              <div>
                <span className="text-[9px] text-text-tertiary uppercase">{specString("map.fly_here.eta")}</span>
                <p className="text-xs font-mono text-text-primary">{fmtEta(eta)}</p>
              </div>
            )}
          </div>
        )}

        {/* Altitude picker */}
        <div>
          <label className="text-[9px] text-text-tertiary uppercase" htmlFor="fly-here-altitude">
            {specString("map.fly_here.altitude_rel")}
          </label>
          <input
            id="fly-here-altitude"
            type="number"
            value={altitudeText}
            onChange={(e) => setAltitudeText(e.target.value)}
            min={FLY_HERE_ALTITUDE_M.min}
            max={FLY_HERE_ALTITUDE_M.max}
            step={1}
            className="w-full mt-0.5 px-2 py-1 text-xs font-mono bg-bg-tertiary border border-border-default rounded text-text-primary focus:border-accent-primary focus:outline-none"
          />
          {altitude === null && (
            <p className="mt-0.5 text-[10px] text-status-error">{specString("refusal.fly_here_target")}</p>
          )}
        </div>

        {/* Distance warning */}
        {distance !== null && distance > 500 && (
          <div className="px-2 py-1 bg-status-warning/10 border border-status-warning/30 rounded">
            <span className="text-[10px] text-status-warning">
              {eta !== null && eta > 120
                ? specString("map.fly_here.far_eta", { km: (distance / 1000).toFixed(1), min: Math.round(eta / 60) })
                : specString("map.fly_here.far", { km: (distance / 1000).toFixed(1) })}
            </span>
          </div>
        )}

        {/* The hold replaces whatever flies the drone now */}
        <p className="text-[10px] text-status-warning">{specString("map.fly_here.takes_over")}</p>

        {/* Error */}
        {error && (
          <div className="px-2 py-1 bg-status-error/10 border border-status-error/30 rounded">
            <span className="text-[10px] text-status-error">{error}</span>
          </div>
        )}
      </div>

      {/* Hold-to-confirm */}
      <div className="px-3 py-2 border-t border-border-default">
        <HoldControl
          hold={hold}
          holdMs={HOLD_DURATION_MS}
          label={specString("map.fly_here.hold")}
          hint={t("skills.confirmPadHint")}
          danger={false}
          disabled={altitude === null}
        />
      </div>
    </div>
  );
}

/**
 * The flight screen's one-sheet-at-a-time rule for Fly Here: while the
 * dialog shows it holds the `fly_here` sheet, so opening it closes any other
 * sheet and another sheet opening closes it.
 */
function FlyHereSheetClaim({ onClosed }: { onClosed: () => void }) {
  const [open, setOpen] = useFlightSheet("fly_here");
  // Closed only once it has been seen open: a remount (React's development
  // double mount included) releases the sheet and claims it again, and that
  // must not read as another sheet taking over.
  const seenOpen = useRef(false);
  useEffect(() => {
    setOpen(true);
  }, [setOpen]);
  useEffect(() => {
    if (open) seenOpen.current = true;
    else if (seenOpen.current) onClosed();
  }, [open, onClosed]);
  return null;
}
