/**
 * The cockpit telemetry strip, styled by `.ados-cockpit .telem`: a 2-column
 * grid of DIST (to home) / HOME (bearing to home) / V/S / THR / ETA (to the
 * next waypoint) / GPS (satellites · HDOP). Placed by its cockpit zone
 * container; shown from full density. Read-only, pointer-events-none, and
 * null-honest: a reading without a fresh source shows "—".
 *
 * @module fly/TelemetryStrip
 * @license GPL-3.0-only
 */

"use client";

import { useTranslations } from "next-intl";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useClockTick } from "@/lib/agent/freshness";
import { freshOnly } from "@/lib/telemetry/freshness";
import { haversineDistance } from "@/lib/geo/distance";
import { bearing } from "@/lib/telemetry-utils";
import { NO_DATA_GLYPH } from "@/lib/hud-draw";
import { formatHeading, formatHud, formatSigned } from "@/components/cockpit/hud/format";

/** Below this ground speed an ETA would be a division by hover noise. */
const ETA_MIN_SPEED_MPS = 0.5;

/** Seconds as `m:ss`, or `h:mm:ss` past an hour. */
function formatEta(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
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
  // Subscribed for its re-render, like the _version read above. Without a
  // time-passing signal a link loss stops `_version` changing, so the strip
  // would keep the last distance, climb rate, and ETA on screen forever,
  // reading as current.
  useClockTick();

  const tState = useTelemetryStore.getState();
  const now = Date.now();
  const vfr = freshOnly(tState.vfr.latest(), now);
  const pos = freshOnly(tState.position.latest(), now);
  const gps = freshOnly(tState.gps.latest(), now);
  const nav = freshOnly(tState.navController.latest(), now);

  // Home is the FC's own HOME_POSITION: the point RTL returns to. It is latched
  // (the FC sends it rarely and it only changes on a new arm or a set-home),
  // so it is not age-gated; the ring is cleared on selection change and
  // disconnect. Until one arrives DIST/HOME read "—" rather than measuring
  // from some other point — the oldest trail sample walks along the track once
  // the trail ring fills, and restarts wherever this GCS first saw the drone.
  const home = tState.homePosition.latest() ?? null;
  const hasPos = pos && pos.lat !== 0 && pos.lon !== 0;
  const homeDist =
    home && hasPos ? haversineDistance(home.lat, home.lon, pos.lat, pos.lon) : null;
  const homeBrg = home && hasPos ? bearing(pos.lat, pos.lon, home.lat, home.lon) : null;

  const vspd = vfr?.climb ?? pos?.climbRate ?? null;
  const throttle = typeof vfr?.throttle === "number" ? vfr.throttle : null;

  // NAV_CONTROLLER_OUTPUT reports 0 m to go when the vehicle is not flying to
  // a waypoint, so only a positive distance yields an ETA.
  const groundSpeed = vfr?.groundspeed ?? pos?.groundSpeed ?? null;
  const etaSec =
    nav && nav.wpDist > 0 && groundSpeed !== null && groundSpeed >= ETA_MIN_SPEED_MPS
      ? nav.wpDist / groundSpeed
      : null;

  const sats = typeof gps?.satellites === "number" ? gps.satellites : null;
  const hdop = typeof gps?.hdop === "number" ? gps.hdop : null;

  // No positioning wrapper: the cockpit zone container places this. It used to
  // carry `zone bl d-full`, which anchored it to the same bottom-left
  // coordinates as the arrangeable-widget container at the same z-index, so a
  // widget the operator moved into that corner painted straight over it.
  return (
    <div className="telem panel">
      <Row label={t("strip.dist")}>
        {formatHud(homeDist, 0)} <small>m</small>
      </Row>
      <Row label={t("strip.home")}>
        {homeBrg === null ? NO_DATA_GLYPH : `${formatHeading(homeBrg)}°`}
      </Row>
      <Row label={t("strip.vspd")}>
        {formatSigned(vspd, 1)} <small>m/s</small>
      </Row>
      <Row label={t("strip.thr")}>
        {formatHud(throttle, 0)}
        <small>%</small>
      </Row>
      <Row label={t("hud.eta")}>{etaSec === null ? NO_DATA_GLYPH : formatEta(etaSec)}</Row>
      <Row label={t("strip.gps")}>
        {formatHud(sats, 0)} <small>·</small> {formatHud(hdop, 1)}
      </Row>
    </div>
  );
}
