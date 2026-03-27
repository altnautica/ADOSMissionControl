/**
 * @module GuidedConfirmDialog
 * @description Confirmation dialog for "Fly Here" guided mode commands.
 * Shows target coordinates, distance, ETA, and altitude picker.
 * Requires hold-to-confirm (2 seconds) for safety.
 * @license GPL-3.0-only
 */
"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useGuidedStore } from "@/stores/guided-store";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useDroneManager } from "@/stores/drone-manager";
import { haversineDistance } from "@/lib/telemetry-utils";
import { X, Navigation } from "lucide-react";

const HOLD_DURATION_MS = 1500;

export function GuidedConfirmDialog() {
  const confirmPending = useGuidedStore((s) => s.confirmPending);
  const dismissConfirm = useGuidedStore((s) => s.dismissConfirm);
  const setTarget = useGuidedStore((s) => s.setTarget);
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);

  // Get current drone position for distance/ETA calc
  const posBuffer = useTelemetryStore((s) => s.position);
  const latestPos = posBuffer.latest();

  const [altitude, setAltitude] = useState(0);
  const [holdProgress, setHoldProgress] = useState(0);
  const holdTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const holdStartRef = useRef(0);

  // Initialize altitude from current drone altitude
  useEffect(() => {
    if (confirmPending && latestPos) {
      setAltitude(Math.round(latestPos.relativeAlt));
    }
  }, [confirmPending, latestPos]);

  const distance = confirmPending && latestPos
    ? haversineDistance(latestPos.lat, latestPos.lon, confirmPending.lat, confirmPending.lon)
    : 0;

  const eta = latestPos && latestPos.groundSpeed > 0.5
    ? distance / latestPos.groundSpeed
    : 0;

  const handleConfirm = useCallback(() => {
    if (!confirmPending) return;

    const protocol = getSelectedProtocol();
    if (!protocol?.isConnected) return;

    // Send guided goto command
    protocol.guidedGoto(confirmPending.lat, confirmPending.lon, altitude);

    // Set active target for map overlay
    setTarget({
      lat: confirmPending.lat,
      lon: confirmPending.lon,
      alt: altitude,
      timestamp: Date.now(),
    });
  }, [confirmPending, altitude, getSelectedProtocol, setTarget]);

  const startHold = useCallback(() => {
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
  }, [handleConfirm]);

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
        >
          <X size={14} />
        </button>
      </div>

      {/* Content */}
      <div className="px-3 py-2 flex flex-col gap-2">
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
        <div className="flex gap-4">
          <div>
            <span className="text-[9px] text-text-tertiary uppercase">Distance</span>
            <p className="text-xs font-mono text-text-primary">
              {distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1000).toFixed(2)} km`}
            </p>
          </div>
          {eta > 0 && (
            <div>
              <span className="text-[9px] text-text-tertiary uppercase">ETA</span>
              <p className="text-xs font-mono text-text-primary">
                {eta < 60 ? `${Math.round(eta)}s` : `${Math.floor(eta / 60)}m ${Math.round(eta % 60)}s`}
              </p>
            </div>
          )}
        </div>

        {/* Altitude picker */}
        <div>
          <label className="text-[9px] text-text-tertiary uppercase">Altitude (m rel)</label>
          <input
            type="number"
            value={altitude}
            onChange={(e) => setAltitude(Number(e.target.value))}
            min={0}
            max={500}
            step={1}
            className="w-full mt-0.5 px-2 py-1 text-xs font-mono bg-bg-tertiary border border-border-default rounded text-text-primary focus:border-accent-primary focus:outline-none"
          />
        </div>

        {/* Distance warning */}
        {distance > 500 && (
          <div className="px-2 py-1 bg-status-warning/10 border border-status-warning/30 rounded">
            <span className="text-[10px] text-status-warning">
              Target is {(distance / 1000).toFixed(1)} km away
            </span>
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
          className="relative w-full h-8 rounded bg-accent-primary/20 border border-accent-primary/40 overflow-hidden cursor-pointer select-none"
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
