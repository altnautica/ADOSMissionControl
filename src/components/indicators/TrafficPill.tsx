/**
 * @module TrafficPill
 * @description Compact pill showing the ADS-B traffic count the flight
 * controller reports (iNav MSP traffic list or MAVLink ADSB_VEHICLE).
 * Opens a popover with per-vehicle details on click.
 * Fires a warning toast when a vehicle is within 500 m.
 * Distances use only a fresh own position; a traffic list that stopped
 * arriving is hidden, and a contact whose TTL has run out is dropped.
 * @license GPL-3.0-only
 */
"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useClockStore } from "@/stores/clock-store";
import { useClockTick } from "@/lib/agent/freshness";
import { useFreshTelemetry } from "@/hooks/use-telemetry-latest";
import { isFresh } from "@/lib/telemetry/freshness";
import { useToast } from "@/components/ui/toast";
import type { INavAdsbVehicle } from "@/lib/protocol/msp/msp-decoders-inav";
import { haversineDistance } from "@/lib/geo/distance";

// ── Proximity constants ──────────────────────────────────────

const PROXIMITY_ALERT_RANGE_M = 500;
const TOAST_COOLDOWN_MS = 30_000;

// ── Live traffic ─────────────────────────────────────────────

/**
 * The contacts still live at `now`: none when the list itself is stale, and
 * each contact's TTL counted down from when the list arrived, dropping the
 * ones that have expired.
 */
export function liveTraffic(
  vehicles: readonly INavAdsbVehicle[],
  listAt: number,
  now: number,
): INavAdsbVehicle[] {
  if (listAt === 0 || !isFresh(listAt, now)) return [];
  const elapsedSec = Math.max(0, (now - listAt) / 1000);
  const live: INavAdsbVehicle[] = [];
  for (const v of vehicles) {
    const ttlSec = Math.floor(v.ttlSec - elapsedSec);
    if (ttlSec > 0) live.push({ ...v, ttlSec });
  }
  return live;
}

// ── Vehicle row ──────────────────────────────────────────────

function VehicleRow({ vehicle, ownLat, ownLon }: { vehicle: INavAdsbVehicle; ownLat: number | null; ownLon: number | null }) {
  const distM =
    ownLat !== null && ownLon !== null
      ? haversineDistance(ownLat, ownLon, vehicle.lat, vehicle.lon)
      : null;
  const distLabel = distM !== null ? `${(distM / 1000).toFixed(2)} km` : "--";
  const altLabel = Number.isFinite(vehicle.alt) ? `${vehicle.alt} cm` : "--";

  return (
    <div className="flex items-start justify-between gap-3 py-1 border-b border-border-default last:border-0">
      <span className="text-[10px] font-mono text-text-primary">{vehicle.callsign || "(no callsign)"}</span>
      <div className="text-right shrink-0">
        <div className="text-[9px] text-text-secondary">{distLabel}</div>
        <div className="text-[9px] text-text-tertiary">{altLabel}</div>
        <div className="text-[9px] text-text-tertiary">TTL {vehicle.ttlSec}s</div>
      </div>
    </div>
  );
}

// ── Component ────────────────────────────────────────────────

export function TrafficPill() {
  const allVehicles = useTelemetryStore((s) => s.adsbVehicles);
  const listAt = useTelemetryStore((s) => s.adsbUpdatedAt);
  useClockTick();
  const now = useClockStore((s) => s.now);
  const vehicles = useMemo(() => liveTraffic(allVehicles, listAt, now), [allVehicles, listAt, now]);
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const pillRef = useRef<HTMLButtonElement>(null);

  // Track which ICAO codes have recently fired a proximity toast
  const alertedRef = useRef<Map<number, number>>(new Map());

  // Get own drone position for distance calculations
  const ownPosition = useFreshTelemetry("position");
  const ownLat = ownPosition ? ownPosition.lat : null;
  const ownLon = ownPosition ? ownPosition.lon : null;

  // Proximity alert check
  useEffect(() => {
    if (ownLat === null || ownLon === null) return;

    const now = Date.now();

    for (const v of vehicles) {
      const distM = haversineDistance(ownLat, ownLon, v.lat, v.lon);
      if (distM <= PROXIMITY_ALERT_RANGE_M) {
        const lastAlert = alertedRef.current.get(v.icao) ?? 0;
        if (now - lastAlert > TOAST_COOLDOWN_MS) {
          alertedRef.current.set(v.icao, now);
          const label = v.callsign || `ICAO ${v.icao}`;
          toast(`Traffic nearby: ${label} at ${Math.round(distM)} m`, "warning");
        }
      }
    }
  }, [vehicles, ownLat, ownLon, toast]);

  // Close popover on outside click
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (pillRef.current && !pillRef.current.closest("[data-traffic-pill]")?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  if (vehicles.length === 0) return null;

  return (
    <div className="relative" data-traffic-pill="">
      <button
        ref={pillRef}
        onClick={() => setOpen((v) => !v)}
        aria-label={`ADS-B traffic nearby: ${vehicles.length} aircraft`}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono border bg-status-warning/10 border-status-warning/30 text-status-warning cursor-pointer hover:bg-status-warning/20 transition-colors"
      >
        Traffic: {vehicles.length}
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 z-50 w-56 bg-bg-secondary border border-border-default shadow-lg p-2">
          <p className="text-[9px] text-text-tertiary mb-1 uppercase tracking-wider">Nearby traffic</p>
          {vehicles.map((v) => (
            <VehicleRow key={v.icao} vehicle={v} ownLat={ownLat} ownLon={ownLon} />
          ))}
        </div>
      )}
    </div>
  );
}
