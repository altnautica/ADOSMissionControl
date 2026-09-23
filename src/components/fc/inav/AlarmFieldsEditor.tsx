/**
 * @module AlarmFieldsEditor
 * @description Numeric inputs for the iNav OSD alarms struct.
 * Sub-component of INavOsdPanel; renders a fixed list of alarm fields with
 * label, unit, optional min/max bounds.
 * @license GPL-3.0-only
 */

"use client";

import type { INavOsdAlarms } from "@/lib/protocol/msp/msp-decoders-inav";

/**
 * Bounds are the firmware setting ranges (osd_*_alarm in the iNav settings
 * table), in the units the MSP alarms frame carries. G-force travels as
 * g x1000; temperatures as decidegrees C.
 */
const ALARM_FIELDS: Array<{
  key: keyof INavOsdAlarms;
  label: string;
  unit: string;
  min: number;
  max: number;
  /** Read back from the FC but not writable through the alarms frame. */
  readOnly?: boolean;
}> = [
  { key: "rssi", label: "RSSI threshold", unit: "%", min: 0, max: 100 },
  { key: "flyMinutes", label: "Fly time", unit: "min", min: 0, max: 600 },
  { key: "maxAltitude", label: "Max altitude", unit: "m", min: 0, max: 10000 },
  { key: "distance", label: "Distance", unit: "m", min: 0, max: 50000 },
  { key: "maxNegAltitude", label: "Max negative altitude", unit: "m", min: 0, max: 10000 },
  { key: "gforce", label: "G-force", unit: "g x1000", min: 0, max: 20000 },
  { key: "gforceAxisMin", label: "G-force axis min", unit: "g x1000", min: -20000, max: 20000 },
  { key: "gforceAxisMax", label: "G-force axis max", unit: "g x1000", min: -20000, max: 20000 },
  { key: "current", label: "Current", unit: "A", min: 0, max: 255 },
  { key: "imuTempMin", label: "IMU temp min", unit: "deci-C", min: -550, max: 1250 },
  { key: "imuTempMax", label: "IMU temp max", unit: "deci-C", min: -550, max: 1250 },
  { key: "baroTempMin", label: "Baro temp min", unit: "deci-C", min: -550, max: 1250 },
  { key: "baroTempMax", label: "Baro temp max", unit: "deci-C", min: -550, max: 1250 },
  { key: "adsbDistanceWarning", label: "ADS-B distance warning", unit: "m", min: 0, max: 65535, readOnly: true },
  { key: "adsbDistanceAlert", label: "ADS-B distance alert", unit: "m", min: 0, max: 65535, readOnly: true },
];

interface AlarmFieldsEditorProps {
  alarms: INavOsdAlarms | null;
  onUpdate: <K extends keyof INavOsdAlarms>(key: K, value: INavOsdAlarms[K]) => void;
}

export function AlarmFieldsEditor({ alarms, onUpdate }: AlarmFieldsEditorProps) {
  if (!alarms) {
    return <p className="text-[11px] text-text-tertiary">No alarm data returned by FC.</p>;
  }
  return (
    <div className="space-y-2">
      {ALARM_FIELDS.map((f) => (
        <div key={f.key} className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-text-secondary shrink-0 w-44">
            {f.label} ({f.unit})
          </span>
          <input
            type="number"
            min={f.min}
            max={f.max}
            value={alarms[f.key] as number}
            disabled={f.readOnly}
            title={f.readOnly ? "Read-only: the OSD alarms write frame has no field for this value" : undefined}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              onUpdate(f.key, Number.isFinite(n) ? Math.max(f.min, Math.min(f.max, n)) : 0);
            }}
            className="w-28 bg-bg-tertiary border border-border-default rounded px-2 py-1 text-[11px] font-mono text-text-primary text-right disabled:opacity-50"
          />
        </div>
      ))}
    </div>
  );
}
