/**
 * The cockpit telemetry strip — a faithful port of the reference artifact's
 * `.zone.bl .telem` (a 2-col grid of Dist / Home / V·S / Hdg / Thr / ETA). Full
 * density only. Read-only, pointer-events-none, null-honest ("—").
 *
 * @module fly/TelemetryStrip
 * @license GPL-3.0-only
 */

"use client";

import { useTranslations } from "next-intl";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useTrailStore } from "@/stores/trail-store";
import { haversineDistance } from "@/lib/drawing/geo-utils";

function fmt(n: number | undefined | null, digits = 0): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "--";
  return n.toFixed(digits);
}

/** Initial bearing from (lat1,lon1) to (lat2,lon2) in degrees 0-360. */
function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

interface RowProps {
  label: string;
  children: React.ReactNode;
}
function Row({ label, children }: RowProps) {
  return (
    <div className="row">
      <span className="k">{label}</span>
      <span className="v">{children}</span>
    </div>
  );
}

export function TelemetryStrip() {
  const t = useTranslations("cockpit");

  useTelemetryStore((s) => s._version);
  useTrailStore((s) => s._version);

  const tState = useTelemetryStore.getState();
  const vfr = tState.vfr.latest();
  const pos = tState.position.latest();

  // Home is the oldest trail point. Indexed straight out of the ring: this
  // strip re-renders on every telemetry sample, and copying the whole trail
  // to read element zero made that cost scale with the length of the flight.
  const home = useTrailStore.getState()._ring.get(0) ?? null;
  const hasPos = pos && pos.lat !== 0 && pos.lon !== 0;
  const homeDist =
    home && hasPos ? haversineDistance(home.lat, home.lon, pos.lat, pos.lon) : null;
  const homeBrg = home && hasPos ? bearing(pos.lat, pos.lon, home.lat, home.lon) : null;

  const heading = pos?.heading ?? vfr?.heading;
  const vspd = vfr?.climb ?? pos?.climbRate;
  const throttle = typeof vfr?.throttle === "number" ? vfr.throttle : null;

  return (
    <div className="zone bl d-full">
      <div className="telem panel">
        <Row label={t("strip.dist")}>
          {homeDist === null ? "--" : fmt(homeDist, 0)} <small>m</small>
        </Row>
        <Row label={t("strip.home")}>
          {homeBrg === null ? "--" : `${fmt(homeBrg, 0)}°`} <small>·</small>{" "}
          {homeDist === null ? "--" : fmt(homeDist, 0)}
          <small>m</small>
        </Row>
        <Row label={t("strip.vspd")}>
          {vspd === undefined || vspd === null ? "--" : `${vspd >= 0 ? "+" : ""}${fmt(vspd, 1)}`}{" "}
          <small>m/s</small>
        </Row>
        <Row label={t("strip.hdg")}>{`${fmt(heading, 0)}°`}</Row>
        <Row label={t("strip.thr")}>
          {throttle === null ? "--" : fmt(throttle, 0)}
          <small>%</small>
        </Row>
        <Row label={t("strip.eta")}>--:--</Row>
      </div>
    </div>
  );
}
