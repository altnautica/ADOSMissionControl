import React from "react";

export const TELRADIO_PARAMS = [
  "SERIAL1_PROTOCOL", "SERIAL1_BAUD",
  "SERIAL2_PROTOCOL", "SERIAL2_BAUD",
  "SYSID_THISMAV", "SYSID_MYGCS",
];

export const OPTIONAL_TELRADIO_PARAMS = [
  "SERIAL1_OPTIONS", "SERIAL2_OPTIONS",
];

/**
 * RADIO_STATUS rssi, remrssi, noise and remnoise are device-scale bytes
 * (0-254), not dBm; UINT8_MAX means the radio did not report the value.
 */
export const RADIO_VALUE_UNKNOWN = 255;

/** Signal strength as a percentage of the device scale, or null when not reported. */
export function rssiPercent(rssi: number): number | null {
  if (rssi === RADIO_VALUE_UNKNOWN) return null;
  return Math.min(100, Math.max(0, (rssi / 254) * 100));
}

/** A device-scale noise or RSSI byte for display, "—" when not reported. */
export function radioLevel(value: number): string {
  return value === RADIO_VALUE_UNKNOWN ? "\u2014" : String(value);
}

export function rssiColor(pct: number): string {
  if (pct >= 60) return "bg-status-success";
  if (pct >= 30) return "bg-status-warning";
  return "bg-status-error";
}

export function Card({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-border-default bg-bg-secondary p-4 space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-accent-primary">{icon}</span>
        <div>
          <h2 className="text-sm font-medium text-text-primary">{title}</h2>
          <p className="text-[10px] text-text-tertiary">{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

export function RssiBar({ label, value }: { label: string; value: number }) {
  const pct = rssiPercent(value);
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-text-secondary">{label}</span>
        <span className="text-xs font-mono text-text-tertiary">{pct === null ? "Not reported" : `${value}/254`}</span>
      </div>
      <div className="h-2 bg-bg-tertiary rounded-full overflow-hidden">
        {pct !== null && (
          <div
            className={`h-full rounded-full transition-all ${rssiColor(pct)}`}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
    </div>
  );
}

export function LiveStat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div>
      <span className="text-[10px] text-text-tertiary block">{label}</span>
      <span className="text-sm font-mono text-text-primary">
        {value}
        {unit && <span className="text-[10px] text-text-tertiary ml-0.5">{unit}</span>}
      </span>
    </div>
  );
}
