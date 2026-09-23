"use client";

/**
 * @module fc/sensors/GnssConstellationEditor
 * @description The ArduPilot GPS_GNSS_MODE constellation bitmask editor, shared
 * by the GPS panel and the calibration GPS section. Bit labels come from the
 * vehicle's param metadata (with the verbatim @Bitmask as the floor). Zero is
 * not "all": it leaves the receiver's own constellation configuration alone.
 * @license GPL-3.0-only
 */

/** GPS_GNSS_MODE bit indices (AP_GPS @Bitmask). */
export const GNSS_BIT = {
  GPS: 0, SBAS: 1, GALILEO: 2, BEIDOU: 3, IMES: 4, QZSS: 5, GLONASS: 6,
} as const;

/** Common constellation sets, as bit indices. */
export const GNSS_PRESETS: ReadonlyArray<readonly number[]> = [
  [GNSS_BIT.GPS],
  [GNSS_BIT.GPS, GNSS_BIT.GLONASS],
  [GNSS_BIT.GPS, GNSS_BIT.GALILEO],
  [GNSS_BIT.GPS, GNSS_BIT.BEIDOU],
  [GNSS_BIT.GPS, GNSS_BIT.GALILEO, GNSS_BIT.GLONASS],
];

export function gnssMask(bits: readonly number[]): number {
  return bits.reduce((mask, bit) => mask | (1 << bit), 0);
}

export function GnssConstellationEditor({ paramName, value, bits, onChange }: {
  /** Param shown in the raw readout (firmware-native name). */
  paramName: string;
  value: number;
  /** Bit index → constellation label. */
  bits: ReadonlyMap<number, string>;
  onChange: (next: number) => void;
}) {
  const chip = (active: boolean) =>
    `px-2 py-1 text-[10px] border transition-colors ${
      active
        ? "bg-accent-primary/20 border-accent-primary text-accent-primary"
        : "bg-bg-tertiary border-border-default text-text-secondary hover:border-text-tertiary"
    }`;
  const bitEntries = [...bits.entries()].sort((a, b) => a[0] - b[0]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => onChange(0)} className={chip(value === 0)}>
          Receiver default
        </button>
        {GNSS_PRESETS.map((preset) => {
          const mask = gnssMask(preset);
          return (
            <button key={mask} type="button" onClick={() => onChange(mask)} className={chip(value === mask)}>
              {preset.map((bit) => bits.get(bit) ?? `Bit ${bit}`).join(" + ")}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3">
        {bitEntries.map(([bit, label]) => (
          <label key={bit} className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={(value & (1 << bit)) !== 0}
              onChange={() => onChange(value ^ (1 << bit))}
              className="accent-accent-primary"
            />
            <span className="text-xs text-text-primary">{label}</span>
          </label>
        ))}
      </div>
      <p className="text-[10px] text-text-tertiary font-mono">
        {paramName} = {value}{value === 0 ? " (receiver default: its own constellation setup is left unchanged)" : ""}
      </p>
    </div>
  );
}
