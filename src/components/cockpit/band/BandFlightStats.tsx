"use client";

/**
 * The vehicle-state cells of the safety band: arm state, flight mode,
 * battery, GPS, link, and (only while authority is limited) command
 * authority. Every value is gated: battery, GPS and radio by the band's two
 * second freshness window, arm and mode by heartbeat age. A reading the GCS
 * no longer has renders the no-data glyph, never a remembered value and never
 * a store default.
 *
 * A visually hidden polite live region announces arm, battery-band and
 * link-state transitions, so a screen reader hears "battery low" once rather
 * than every percentage tick.
 *
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { BatteryMedium, Navigation, Radio, Satellite } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDroneStore } from "@/stores/drone-store";
import { useHudTopBarData } from "@/hooks/use-hud-topbar-data";
import { useMqttControlAuthority } from "@/hooks/use-mqtt-control-authority";
import { needsOperatorAttention } from "@/lib/nodes/mqtt-control-authority";
import { deriveHudStatus } from "@/lib/hud-readings";
import { NO_DATA_GLYPH } from "@/lib/hud-draw";
import { useBatteryBand, type BatteryBand } from "@/lib/battery-bands";
import { linkStateFromHeartbeat, type LinkState } from "./link-state";
import { formatElapsed, msSince } from "./format";

const BATTERY_BAND_COLOR: Record<BatteryBand, string> = {
  good: "var(--hud-good)",
  warning: "var(--hud-warn)",
  critical: "var(--hud-crit)",
};

const LINK_COLOR: Record<LinkState, string | undefined> = {
  none: undefined,
  ok: undefined,
  stale: "var(--hud-warn)",
  lost: "var(--hud-crit)",
};

const SIG_HEIGHTS = [4, 7, 10, 13];
const SIG_OFF = "color-mix(in oklch, var(--hud-ink) 18%, transparent)";
const DIM = "opacity-60";

interface Announced {
  armed: boolean | null;
  battery: BatteryBand | undefined;
  link: LinkState;
}

export function BandFlightStats() {
  const t = useTranslations("cockpit");
  const { radio, battery, gps } = useHudTopBarData();
  const rawMode = useDroneStore((s) => s.flightMode);
  const armState = useDroneStore((s) => s.armState);
  const lastHeartbeat = useDroneStore((s) => s.lastHeartbeat);

  const { armed, mode, signalBars, batteryPct } = deriveHudStatus(
    { battery, gps, radio },
    { armState, flightMode: rawMode, lastHeartbeat },
  );
  const batteryBand = useBatteryBand(batteryPct);
  const link = linkStateFromHeartbeat(lastHeartbeat);

  // Announce transitions only. Derived during render (the documented
  // "previous value in state" pattern), so the first paint announces nothing.
  const [announced, setAnnounced] = useState<Announced>({ armed, battery: batteryBand, link });
  const [announcement, setAnnouncement] = useState("");
  if (
    announced.armed !== armed ||
    announced.battery !== batteryBand ||
    announced.link !== link
  ) {
    const parts: string[] = [];
    if (announced.armed !== armed) {
      parts.push(
        armed === null ? t("band.announceArmUnknown") : armed ? t("band.announceArmed") : t("band.announceDisarmed"),
      );
    }
    if (announced.battery !== batteryBand) {
      if (batteryBand === "critical") parts.push(t("band.announceBattCritical"));
      else if (batteryBand === "warning") parts.push(t("band.announceBattLow"));
      else if (batteryBand === "good" && announced.battery !== undefined) {
        parts.push(t("band.announceBattNormal"));
      }
    }
    if (announced.link !== link) {
      if (link === "lost") parts.push(t("band.announceLinkLost"));
      else if (link === "stale") parts.push(t("band.announceLinkStale"));
      else if (link === "ok" && announced.link !== "none") parts.push(t("band.announceLinkOk"));
    }
    setAnnounced({ armed, battery: batteryBand, link });
    if (parts.length > 0) setAnnouncement(parts.join(". "));
  }

  const fix = gps?.fixType;
  const sats = gps?.satellites === undefined ? NO_DATA_GLYPH : String(gps.satellites);
  const rtk = fix === 5 || fix === 6;
  const gpsLabel =
    fix === undefined
      ? NO_DATA_GLYPH
      : rtk
        ? t("strip.gpsRtk", { sats })
        : fix >= 3
          ? t("strip.gps3d", { sats })
          : fix >= 2
            ? t("strip.gps2d", { sats })
            : t("strip.gpsNoFix");

  // Signal bars when a radio reports; otherwise the heartbeat age is the only
  // honest link figure the GCS has.
  const level = signalBars ?? 0;
  const linkValue = radio
    ? String(Math.round(radio.rssi))
    : link === "none"
      ? NO_DATA_GLYPH
      : t("band.linkAge", { age: formatElapsed(msSince(lastHeartbeat)) });

  const authority = useMqttControlAuthority();
  const commandWarning = needsOperatorAttention(authority)
    ? authority.fcFrames === "provisioning"
      ? t("command.provisioning")
      : authority.fcFrames === "expiring"
        ? t("command.expiring")
        : t("command.receiveOnly")
    : null;

  return (
    <>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>

      {/* `armed === null`: no live heartbeat backs either reading, and a
          stale "DISARMED" would read as a confirmed safe state. */}
      <div className="stat" data-testid="cockpit-arm">
        {armed === null ? (
          <span className={`pill mode ${DIM}`}>{NO_DATA_GLYPH}</span>
        ) : armed ? (
          <span className="pill armed">
            <i className="led" />
            {t("armed").toUpperCase()}
          </span>
        ) : (
          <span className="pill mode">{t("disarmed").toUpperCase()}</span>
        )}
      </div>

      <div className="stat" data-testid="cockpit-mode">
        <Navigation size={12} className="ki" aria-hidden="true" />
        <span className="k">{t("band.mode")}</span>
        <span className={mode === null ? `v ${DIM}` : "v"}>{mode ?? NO_DATA_GLYPH}</span>
      </div>

      <div className="stat" data-testid="cockpit-battery">
        <BatteryMedium size={12} className="ki" aria-hidden="true" />
        <span className="k">{t("band.batt")}</span>
        <span className="bar">
          <i
            style={{
              width: `${batteryPct === null ? 0 : Math.max(0, Math.min(100, batteryPct))}%`,
              background: batteryBand ? BATTERY_BAND_COLOR[batteryBand] : undefined,
            }}
          />
        </span>
        <span
          className={batteryPct === null ? `v ${DIM}` : "v"}
          style={batteryBand && batteryBand !== "good" ? { color: BATTERY_BAND_COLOR[batteryBand] } : undefined}
        >
          {batteryPct === null ? NO_DATA_GLYPH : `${Math.round(batteryPct)}%`}
        </span>
      </div>

      <div className="stat" data-testid="cockpit-gps">
        <Satellite size={12} className="ki" aria-hidden="true" />
        <span className="k">{t("strip.gps")}</span>
        <span
          className={fix === undefined ? `v ${DIM}` : "v"}
          style={rtk ? { color: "var(--hud-good)" } : undefined}
        >
          {gpsLabel}
        </span>
      </div>

      <div className="stat" data-testid="cockpit-link" data-link-state={link}>
        {!radio && <Radio size={12} className="ki" aria-hidden="true" />}
        <span className="k">{t("strip.link")}</span>
        {radio && (
          <span className="sig" aria-hidden="true">
            {SIG_HEIGHTS.map((h, i) => (
              <b key={h} style={{ height: h, background: i < level ? "var(--hud-good)" : SIG_OFF }} />
            ))}
          </span>
        )}
        <span
          className={linkValue === NO_DATA_GLYPH ? `v ${DIM}` : "v"}
          style={LINK_COLOR[link] ? { color: LINK_COLOR[link] } : undefined}
        >
          {linkValue}
        </span>
      </div>

      {commandWarning && (
        <div className="stat" role="status">
          <span className="k">{t("command.label")}</span>
          <span className="v" style={{ color: "var(--hud-warn)" }}>
            {commandWarning}
          </span>
        </div>
      )}
    </>
  );
}
