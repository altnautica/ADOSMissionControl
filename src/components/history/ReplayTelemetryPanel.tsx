/**
 * @module ReplayTelemetryPanel
 * @description Compact telemetry readout panel for flight replay.
 * Subscribes to telemetry-store directly (player dispatches to same stores).
 * @license GPL-3.0-only
 */
"use client";

import { useLocale, useTranslations } from "next-intl";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useDroneStore } from "@/stores/drone-store";
import { formatDecimal } from "@/lib/i18n/format";

function Row({ label, value, unit }: { label: string; value: string | number; unit?: string }) {
  return (
    <div className="flex items-baseline justify-between py-0.5">
      <span className="text-[9px] text-text-tertiary uppercase font-mono">{label}</span>
      <span className="text-[11px] text-text-primary font-mono">
        {value}{unit && <span className="text-text-tertiary ml-0.5">{unit}</span>}
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-3 py-2 border-b border-border-default last:border-b-0">
      <span className="text-[9px] text-text-tertiary uppercase font-mono font-semibold tracking-wider">{title}</span>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/**
 * MAVLink GPS_FIX_TYPE -> its `indicators.gpsFix.*` key. Fix type 1 and the
 * 7/8 STATIC/PPP tail have no entry and read as "no fix", which is what this
 * panel showed for them before.
 */
const FIX_KEYS: Record<number, string> = {
  0: "noGps",
  2: "fix2d",
  3: "fix3d",
  4: "dgps",
  5: "rtkFloat",
  6: "rtk",
};

export function ReplayTelemetryPanel() {
  const posBuffer = useTelemetryStore((s) => s.position);
  const attBuffer = useTelemetryStore((s) => s.attitude);
  const batBuffer = useTelemetryStore((s) => s.battery);
  const gpsBuffer = useTelemetryStore((s) => s.gps);
  const vfrBuffer = useTelemetryStore((s) => s.vfr);
  const flightMode = useDroneStore((s) => s.flightMode);
  const locale = useLocale();
  const t = useTranslations("indicators.gpsFix");

  const pos = posBuffer.latest();
  const att = attBuffer.latest();
  const bat = batBuffer.latest();
  const gps = gpsBuffer.latest();
  const vfr = vfrBuffer.latest();

  const fixLabel = gps ? t(FIX_KEYS[gps.fixType] ?? "noFix") : "—";

  return (
    <div className="w-48 bg-bg-secondary border-l border-border-default overflow-y-auto shrink-0">
      <Section title="Position">
        <Row label="ALT" value={formatDecimal(pos?.relativeAlt, 1, locale)} unit="m" />
        <Row label="SPD" value={formatDecimal(pos?.groundSpeed, 1, locale)} unit="m/s" />
        <Row label="HDG" value={pos ? Math.round(pos.heading) : "—"} unit="°" />
        <Row label="VS" value={formatDecimal(pos?.climbRate, 1, locale)} unit="m/s" />
      </Section>

      <Section title="Battery">
        <Row label="BAT" value={bat ? Math.round(bat.remaining) : "—"} unit="%" />
        <Row label="VOLT" value={formatDecimal(bat?.voltage, 1, locale)} unit="V" />
        <Row label="AMP" value={formatDecimal(bat?.current, 1, locale)} unit="A" />
      </Section>

      <Section title="GPS">
        <Row label="FIX" value={fixLabel} />
        <Row label="SAT" value={gps ? gps.satellites : "—"} />
        <Row label="HDOP" value={formatDecimal(gps?.hdop, 1, locale)} />
      </Section>

      <Section title="Attitude">
        <Row label="ROLL" value={formatDecimal(att?.roll, 1, locale)} unit="°" />
        <Row label="PITCH" value={formatDecimal(att?.pitch, 1, locale)} unit="°" />
        <Row label="YAW" value={formatDecimal(att?.yaw, 1, locale)} unit="°" />
      </Section>

      <Section title="Flight">
        <Row label="MODE" value={flightMode || "—"} />
        <Row label="THR" value={vfr ? Math.round(vfr.throttle) : "—"} unit="%" />
      </Section>
    </div>
  );
}
