/**
 * @module ReplayTelemetryPanel
 * @description Compact telemetry readout panel for flight replay.
 * Subscribes to telemetry-store directly (player dispatches to same stores).
 * @license GPL-3.0-only
 */
"use client";

import { useTelemetryStore } from "@/stores/telemetry-store";
import { useDroneStore } from "@/stores/drone-store";

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

export function ReplayTelemetryPanel() {
  const posBuffer = useTelemetryStore((s) => s.position);
  const attBuffer = useTelemetryStore((s) => s.attitude);
  const batBuffer = useTelemetryStore((s) => s.battery);
  const gpsBuffer = useTelemetryStore((s) => s.gps);
  const vfrBuffer = useTelemetryStore((s) => s.vfr);
  const flightMode = useDroneStore((s) => s.flightMode);

  const pos = posBuffer.latest();
  const att = attBuffer.latest();
  const bat = batBuffer.latest();
  const gps = gpsBuffer.latest();
  const vfr = vfrBuffer.latest();

  const fixLabel = gps ? (
    gps.fixType === 6 ? "RTK Fix" :
    gps.fixType === 5 ? "RTK Flt" :
    gps.fixType === 3 ? "3D" :
    gps.fixType === 2 ? "2D" :
    "No Fix"
  ) : "—";

  return (
    <div className="w-48 bg-bg-secondary border-l border-border-default overflow-y-auto shrink-0">
      <Section title="Position">
        <Row label="ALT" value={pos ? pos.relativeAlt.toFixed(1) : "—"} unit="m" />
        <Row label="SPD" value={pos ? pos.groundSpeed.toFixed(1) : "—"} unit="m/s" />
        <Row label="HDG" value={pos ? Math.round(pos.heading) : "—"} unit="°" />
        <Row label="VS" value={pos ? pos.climbRate.toFixed(1) : "—"} unit="m/s" />
      </Section>

      <Section title="Battery">
        <Row label="BAT" value={bat ? Math.round(bat.remaining) : "—"} unit="%" />
        <Row label="VOLT" value={bat ? bat.voltage.toFixed(1) : "—"} unit="V" />
        <Row label="AMP" value={bat ? bat.current.toFixed(1) : "—"} unit="A" />
      </Section>

      <Section title="GPS">
        <Row label="FIX" value={fixLabel} />
        <Row label="SAT" value={gps ? gps.satellites : "—"} />
        <Row label="HDOP" value={gps ? gps.hdop.toFixed(1) : "—"} />
      </Section>

      <Section title="Attitude">
        <Row label="ROLL" value={att ? att.roll.toFixed(1) : "—"} unit="°" />
        <Row label="PITCH" value={att ? att.pitch.toFixed(1) : "—"} unit="°" />
        <Row label="YAW" value={att ? att.yaw.toFixed(1) : "—"} unit="°" />
      </Section>

      <Section title="Flight">
        <Row label="MODE" value={flightMode || "—"} />
        <Row label="THR" value={vfr ? Math.round(vfr.throttle) : "—"} unit="%" />
      </Section>
    </div>
  );
}
