/**
 * @module BfLedModeColors
 * @description Betaflight LED mode-colour editor. Assigns a palette colour to
 * each flight-mode/direction pair and special-colour slot, plus the LED aux
 * channel. Backed by MSP_LED_STRIP_MODECOLOR (127/221).
 * @license GPL-3.0-only
 */

"use client";

import { useTranslations } from "next-intl";
import { Select } from "@/components/ui/select";
import type { BfLedModeColor, HsvColor } from "@/lib/protocol/types/betaflight";
import {
  BF_LED_MODES,
  BF_LED_DIRECTIONS,
  BF_LED_SPECIAL_COLORS,
  BF_LED_COLOR_COUNT,
  BF_LED_SPECIAL_MODE,
  BF_LED_AUX_MODE,
  hsvToHex,
} from "./bf-led-constants";

const COLOR_OPTIONS = Array.from({ length: BF_LED_COLOR_COUNT }, (_, i) => ({
  value: String(i),
  label: `Color ${i}`,
}));

interface Props {
  modeColors: BfLedModeColor[];
  colors: HsvColor[];
  disabled: boolean;
  onChange: (mode: number, fun: number, color: number) => void;
}

export function BfLedModeColors({ modeColors, colors, disabled, onChange }: Props) {
  const tl = useTranslations("fcPanels.bfLedModeColors");
  const colorOf = (mode: number, fun: number) =>
    modeColors.find((m) => m.mode === mode && m.fun === fun)?.color ?? 0;

  const swatch = (colorIdx: number) => {
    const c = colors[colorIdx];
    return (
      <span
        className="w-4 h-4 rounded shrink-0 border border-border-default"
        style={c ? { backgroundColor: hsvToHex(c) } : undefined}
        title={`Color ${colorIdx}`}
      />
    );
  };

  const colorCell = (mode: number, fun: number) => (
    <div className="flex items-center gap-1">
      {swatch(colorOf(mode, fun))}
      <div className="w-24">
        <Select
          options={COLOR_OPTIONS}
          value={String(colorOf(mode, fun))}
          onChange={(v) => onChange(mode, fun, parseInt(v))}
          disabled={disabled}
        />
      </div>
    </div>
  );

  const auxChannel = colorOf(BF_LED_AUX_MODE, 0);

  return (
    <div className="mt-6 space-y-4">
      <div>
        <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">{tl("modeColours")}</h3>
        <p className="text-[10px] text-text-tertiary">
          {tl("paletteColourUsedPerFlight")}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="text-[11px]">
          <thead>
            <tr>
              <th className="pb-1" />
              {BF_LED_DIRECTIONS.map((d) => (
                <th key={d} className="text-left px-2 pb-1 text-text-tertiary font-mono">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {BF_LED_MODES.map((mode, mi) => (
              <tr key={mode}>
                <td className="pr-3 py-0.5 text-text-secondary whitespace-nowrap">{mode}</td>
                {BF_LED_DIRECTIONS.map((_, di) => (
                  <td key={di} className="px-2 py-0.5">
                    {colorCell(mi, di)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">{tl("specialColours")}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 max-w-3xl">
          {BF_LED_SPECIAL_COLORS.map((label, si) => (
            <div key={label} className="flex items-center gap-2">
              <span className="text-[11px] text-text-secondary w-28 shrink-0">{label}</span>
              {colorCell(BF_LED_SPECIAL_MODE, si)}
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[11px] text-text-secondary">{tl("colourAuxChannel")}</span>
        <input
          type="number"
          min={0}
          value={auxChannel}
          disabled={disabled}
          onChange={(e) => onChange(BF_LED_AUX_MODE, 0, Math.max(0, parseInt(e.target.value) || 0))}
          className="w-16 bg-bg-tertiary border border-border-default px-1 py-0.5 text-text-primary text-[11px] font-mono"
        />
      </div>
    </div>
  );
}
