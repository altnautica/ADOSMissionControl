"use client";

/**
 * @module fc/power/Px4PowerSections
 * @description PX4 battery setup and battery failsafe. PX4's battery model is
 * not ArduPilot's: the monitor source is BAT1_SOURCE (-1 disabled, 0 power
 * module, 1 external, 2 ESCs), the failsafe thresholds are remaining-charge
 * fractions (BAT_LOW_THR 0.15 = 15 % left), and a single COM_LOW_BAT_ACT
 * decides the action. Params are addressed by the canonical names the PX4
 * handler maps (BATT_MONITOR is BAT1_SOURCE, BATT_FS_LOW_VOLT is BAT_LOW_THR).
 * @license GPL-3.0-only
 */

import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Battery, Zap, ShieldAlert } from "lucide-react";
import { StarredParam } from "../parameters/ParamStar";
import { ParamEnumSelect } from "../shared/ParamEnumSelect";

/** Present on every PX4 build. */
export const PX4_POWER_PARAMS = [
  "BATT_MONITOR", "BATT_CAPACITY", "BAT1_N_CELLS", "BAT1_R_INTERNAL",
  "BATT_FS_LOW_VOLT", "BATT_FS_CRT_VOLT", "BAT_EMERGEN_THR", "BATT_FS_LOW_ACT",
];

/** Analog power-module calibration; only on builds with the analog battery driver. */
export const PX4_OPTIONAL_POWER_PARAMS = ["BATT_VOLT_MULT", "BATT_AMP_PERVLT", "BATT_AMP_OFFSET"];

/** Remaining-charge thresholds, low to emergency. */
const THRESHOLDS = [
  { name: "BATT_FS_LOW_VOLT", text: "Low Threshold", min: "0.12" },
  { name: "BATT_FS_CRT_VOLT", text: "Critical Threshold", min: "0.05" },
  { name: "BAT_EMERGEN_THR", text: "Emergency Threshold", min: "0.03" },
] as const;

export function Px4PowerSections({
  params, setLocalValue, lbl, enumValues,
}: {
  params: Map<string, number>;
  setLocalValue: (name: string, value: number) => void;
  lbl: (raw: string) => ReactNode;
  enumValues: (canonical: string) => ReadonlyMap<number, string>;
}) {
  const str = (name: string) => (params.has(name) ? String(params.get(name)) : "");
  const num = (v: string) => Number(v) || 0;
  const enumField = (name: string, text: string) => (
    <StarredParam param={name}>
      <ParamEnumSelect label={lbl(`${name} — ${text}`)} values={enumValues(name)}
        value={params.get(name) ?? 0} onChange={(v) => setLocalValue(name, v)} />
    </StarredParam>
  );
  const hasAnalog = PX4_OPTIONAL_POWER_PARAMS.some((n) => params.has(n));

  return (
    <>
      <div className="border border-border-default bg-bg-secondary p-4 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Battery size={14} className="text-accent-primary" />
          <h2 className="text-sm font-medium text-text-primary">Battery Settings</h2>
        </div>
        {enumField("BATT_MONITOR", "Battery 1 Source")}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <StarredParam param="BATT_CAPACITY">
            <Input label={lbl("BATT_CAPACITY — Capacity")} type="number" step="50" min="-1" unit="mAh"
              value={str("BATT_CAPACITY")} onChange={(e) => setLocalValue("BATT_CAPACITY", num(e.target.value))} />
          </StarredParam>
          {enumField("BAT1_N_CELLS", "Cell Count")}
          <StarredParam param="BAT1_R_INTERNAL">
            <Input label={lbl("BAT1_R_INTERNAL — Internal Resistance")} type="number" step="0.001" min="-1" max="0.2" unit="Ω"
              value={str("BAT1_R_INTERNAL")} onChange={(e) => setLocalValue("BAT1_R_INTERNAL", num(e.target.value))} />
          </StarredParam>
        </div>
        <p className="text-[10px] text-text-tertiary">Capacity -1 means unknown; internal resistance -1 lets PX4 estimate it.</p>
      </div>

      {hasAnalog && (
        <div className="border border-border-default bg-bg-secondary p-4 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Zap size={14} className="text-accent-primary" />
            <h2 className="text-sm font-medium text-text-primary">Power Module Calibration</h2>
          </div>
          {params.has("BATT_VOLT_MULT") && (
            <Input label={lbl("BATT_VOLT_MULT — Voltage Divider")} type="number" step="0.01"
              value={str("BATT_VOLT_MULT")} onChange={(e) => setLocalValue("BATT_VOLT_MULT", num(e.target.value))} />
          )}
          {params.has("BATT_AMP_PERVLT") && (
            <Input label={lbl("BATT_AMP_PERVLT — Amps Per Volt")} type="number" step="0.1" unit="A/V"
              value={str("BATT_AMP_PERVLT")} onChange={(e) => setLocalValue("BATT_AMP_PERVLT", num(e.target.value))} />
          )}
          {params.has("BATT_AMP_OFFSET") && (
            <Input label={lbl("BATT_AMP_OFFSET — Current Sensor Zero Offset")} type="number" step="0.001" unit="V"
              value={str("BATT_AMP_OFFSET")} onChange={(e) => setLocalValue("BATT_AMP_OFFSET", num(e.target.value))} />
          )}
        </div>
      )}

      <div className="border border-border-default bg-bg-secondary p-4 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <ShieldAlert size={14} className="text-accent-primary" />
          <h2 className="text-sm font-medium text-text-primary">Battery Failsafe</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {THRESHOLDS.map((t) => (
            <StarredParam key={t.name} param={t.name}>
              <Input label={lbl(`${t.name} — ${t.text}`)} type="number" step="0.01" min={t.min} max="0.5" unit="fraction"
                value={str(t.name)} onChange={(e) => setLocalValue(t.name, num(e.target.value))} />
            </StarredParam>
          ))}
        </div>
        <p className="text-[10px] text-text-tertiary">
          Thresholds are the fraction of charge remaining (0.15 = 15 % left), not volts.
        </p>
        {enumField("BATT_FS_LOW_ACT", "Battery Failsafe Action")}
      </div>
    </>
  );
}
