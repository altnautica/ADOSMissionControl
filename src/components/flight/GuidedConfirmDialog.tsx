/**
 * @module GuidedConfirmDialog
 * @description Confirmation dialog for "Fly Here" guided mode commands.
 * Shows target coordinates, distance, ETA, and altitude picker.
 * Requires hold-to-confirm (1.5 seconds) for safety, then dispatches the
 * `fly-here` skill so the command passes the same arm gate, debounce and
 * refusal reporting as every other flight command.
 * @license GPL-3.0-only
 */
"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useGuidedStore } from "@/stores/guided-store";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useFreshTelemetry } from "@/hooks/use-telemetry-latest";
import { haversineDistance } from "@/lib/telemetry-utils";
import { freshOnly } from "@/lib/telemetry/freshness";
import { activate, buildSkillContext } from "@/lib/skills";
import { FLY_HERE_ALTITUDE_M, parseFlyHereAltitude } from "@/lib/skills/builtins/fly-here";
import { X, Navigation } from "lucide-react";

const HOLD_DURATION_MS = 1500;
const DEFAULT_ALT_M = 10;

export function GuidedConfirmDialog() {
  const storedPending = useGuidedStore((s) => s.confirmPending);
  const selectedDroneId = useDroneManager((s) => s.selectedDroneId);
  // A confirmation belongs to the drone it was raised for; it never re-opens
  // for another one after the selection changes.
  const confirmPending = storedPending?.droneId === selectedDroneId ? storedPending : null;
  const dismissConfirm = useGuidedStore((s) => s.dismissConfirm);

  // Current drone position for distance/ETA, only while it is fresh: a frozen
  // position would measure the target from where the aircraft used to be.
  const latestPos = useFreshTelemetry("position");

  // Kept as typed so a cleared box reads as "no altitude", never as 0 m.
  const [altitudeText, setAltitudeText] = useState(String(DEFAULT_ALT_M));
  const [holdProgress, setHoldProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const holdStartRef = useRef(0);

  const altitude = parseFlyHereAltitude(altitudeText);

  // Initialize altitude from current drone altitude ONLY on first open (not on telemetry updates)
  useEffect(() => {
    if (confirmPending) {
      const pos = freshOnly(useTelemetryStore.getState().position.latest(), Date.now());
      const initAlt = pos ? Math.round(pos.relativeAlt) : DEFAULT_ALT_M;
      setAltitudeText(
        String(Math.min(Math.max(initAlt, FLY_HERE_ALTITUDE_M.min), FLY_HERE_ALTITUDE_M.max)),
      );
      setHoldProgress(0);
      setError(null);
    }
  }, [confirmPending]);

  const hasGps = latestPos !== undefined && latestPos.lat !== 0;
  const distance =
    confirmPending && hasGps
      ? haversineDistance(latestPos.lat, latestPos.lon, confirmPending.lat, confirmPending.lon)
      : null;
  const eta =
    distance !== null && latestPos && latestPos.groundSpeed >= 0.5
      ? distance / latestPos.groundSpeed
      : null;

  const handleConfirm = useCallback(async () => {
    if (!confirmPending) return;
    if (altitude === null) {
      setHoldProgress(0);
      setError(`Altitude must be ${FLY_HERE_ALTITUDE_M.min}-${FLY_HERE_ALTITUDE_M.max} m`);
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
    setHoldProgress(0);
  }, [confirmPending, altitude]);

  const startHold = useCallback(() => {
    if (altitude === null) return;
    setError(null);
    holdStartRef.current = Date.now();
    holdTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - holdStartRef.current;
      const progress = Math.min(elapsed / HOLD_DURATION_MS, 1);
      setHoldProgress(progress);
      if (progress >= 1) {
        if (holdTimerRef.current) clearInterval(holdTimerRef.current);
        handleConfirm();
      }
    }, 30);
  }, [handleConfirm, altitude]);

  const cancelHold = useCallback(() => {
    if (holdTimerRef.current) clearInterval(holdTimerRef.current);
    holdTimerRef.current = null;
    setHoldProgress(0);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (holdTimerRef.current) clearInterval(holdTimerRef.current);
    };
  }, []);

  if (!confirmPending) return null;

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[1100] w-[320px] bg-bg-secondary/95 backdrop-blur-sm border border-border-default rounded-lg shadow-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default">
        <div className="flex items-center gap-2">
          <Navigation size={14} className="text-accent-primary" />
          <span className="text-xs font-semibold text-text-primary">Fly Here</span>
        </div>
        <button
          onClick={dismissConfirm}
          className="text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
          aria-label="Close dialog"
        >
          <X size={14} />
        </button>
      </div>

      {/* Content */}
      <div className="px-3 py-2 flex flex-col gap-2">
        {/* GPS warning */}
        {!hasGps && (
          <div className="px-2 py-1 bg-status-error/10 border border-status-error/30 rounded">
            <span className="text-[10px] text-status-error">
              No GPS fix. Distance and ETA unavailable.
            </span>
          </div>
        )}

        {/* Coordinates */}
        <div className="flex gap-4">
          <div>
            <span className="text-[9px] text-text-tertiary uppercase">Lat</span>
            <p className="text-xs font-mono text-text-primary">{confirmPending.lat.toFixed(6)}</p>
          </div>
          <div>
            <span className="text-[9px] text-text-tertiary uppercase">Lon</span>
            <p className="text-xs font-mono text-text-primary">{confirmPending.lon.toFixed(6)}</p>
          </div>
        </div>

        {/* Distance & ETA */}
        {distance !== null && (
          <div className="flex gap-4">
            <div>
              <span className="text-[9px] text-text-tertiary uppercase">Distance</span>
              <p className="text-xs font-mono text-text-primary">
                {distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1000).toFixed(2)} km`}
              </p>
            </div>
            {eta !== null && (
              <div>
                <span className="text-[9px] text-text-tertiary uppercase">ETA</span>
                <p className="text-xs font-mono text-text-primary">
                  {eta < 60 ? `${Math.round(eta)}s` : `${Math.floor(eta / 60)}m ${Math.round(eta % 60)}s`}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Altitude picker */}
        <div>
          <label className="text-[9px] text-text-tertiary uppercase" htmlFor="fly-here-altitude">
            Altitude (m rel)
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
            <p className="mt-0.5 text-[10px] text-status-error">
              Enter an altitude of {FLY_HERE_ALTITUDE_M.min}-{FLY_HERE_ALTITUDE_M.max} m
            </p>
          )}
        </div>

        {/* Distance warning */}
        {distance !== null && distance > 500 && (
          <div className="px-2 py-1 bg-status-warning/10 border border-status-warning/30 rounded">
            <span className="text-[10px] text-status-warning">
              Target is {(distance / 1000).toFixed(1)} km away
              {eta !== null && eta > 120 && ` (ETA ${Math.round(eta / 60)} min)`}
            </span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="px-2 py-1 bg-status-error/10 border border-status-error/30 rounded">
            <span className="text-[10px] text-status-error">{error}</span>
          </div>
        )}
      </div>

      {/* Hold-to-confirm button */}
      <div className="px-3 py-2 border-t border-border-default">
        <button
          onMouseDown={startHold}
          onMouseUp={cancelHold}
          onMouseLeave={cancelHold}
          onTouchStart={startHold}
          onTouchEnd={cancelHold}
          disabled={altitude === null}
          className="relative w-full h-8 rounded bg-accent-primary/20 border border-accent-primary/40 overflow-hidden cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {/* Progress fill */}
          <div
            className="absolute inset-0 bg-accent-primary/40 transition-none"
            style={{ width: `${holdProgress * 100}%` }}
          />
          <span className="relative text-xs font-semibold text-accent-primary">
            {holdProgress > 0 ? "Hold..." : "Hold to Confirm"}
          </span>
        </button>
      </div>
    </div>
  );
}
