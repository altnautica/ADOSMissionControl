/**
 * @module BfLedStripPanel
 * @description Betaflight LED-strip configuration. Reads the per-LED packed
 * configs (MSP_LED_STRIP_CONFIG), lets each LED's position, color, function,
 * direction, and overlay flags be edited, and writes them back one LED at a
 * time (MSP_SET_LED_STRIP_CONFIG). Replaces the ArduPilot notification-LED
 * panel for Betaflight. Also edits the 16-colour HSV palette and the
 * mode/special/aux colour assignments (MSP_LED_STRIP_MODECOLOR).
 * @license GPL-3.0-only
 */

"use client";

import { useCallback, useState } from "react";
import { Lightbulb, Upload } from "lucide-react";
import { PanelHeader } from "../shared/PanelHeader";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import type { HsvColor, BfLedModeColor } from "@/lib/protocol/msp/decoders/config/led";
import {
  type BfLed, unpackLed, packLed, toggleFlag, hsvToHex,
  BF_LED_FUNCTIONS, BF_LED_DIRECTIONS, BF_LED_OVERLAYS, BF_LED_COLOR_COUNT,
} from "./bf-led-constants";
import { BfLedModeColors } from "./BfLedModeColors";

const FUNCTION_OPTIONS = BF_LED_FUNCTIONS.map((label, i) => ({ value: String(i), label }));
const COLOR_OPTIONS = Array.from({ length: BF_LED_COLOR_COUNT }, (_, i) => ({ value: String(i), label: `Color ${i}` }));

export function BfLedStripPanel() {
  const selectedProtocol = useDroneManager(selectSelectedProtocol);
  const connected = !!selectedProtocol;
  const { isArmed, lockMessage } = useArmedLock();

  const [leds, setLeds] = useState<BfLed[]>([]);
  const [baseline, setBaseline] = useState("");
  const [colors, setColors] = useState<HsvColor[]>([]);
  const [colorsBaseline, setColorsBaseline] = useState("");
  const [modeColors, setModeColors] = useState<BfLedModeColor[]>([]);
  const [modeColorsBaseline, setModeColorsBaseline] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  const read = useCallback(async () => {
    const protocol = selectedProtocol;
    if (!protocol?.getLedStripConfig) {
      setError("LED-strip config is not available on this connection");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const parsed = (await protocol.getLedStripConfig()).map(unpackLed);
      setLeds(parsed);
      setBaseline(JSON.stringify(parsed));
      if (protocol.getLedColors) {
        const palette = await protocol.getLedColors();
        setColors(palette);
        setColorsBaseline(JSON.stringify(palette));
      }
      if (protocol.getLedStripModeColors) {
        const mc = await protocol.getLedStripModeColors();
        setModeColors(mc);
        setModeColorsBaseline(JSON.stringify(mc));
      }
      setHasLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedProtocol]);

  const write = useCallback(async () => {
    const protocol = selectedProtocol;
    if (!protocol?.setLedStripConfig) return;
    setLoading(true);
    setError(null);
    try {
      if (JSON.stringify(leds) !== baseline) {
        const r = await protocol.setLedStripConfig(leds.map(packLed));
        if (!r.success) { setError(r.message); return; }
        setBaseline(JSON.stringify(leds));
      }
      if (protocol.setLedColors && colors.length > 0 && JSON.stringify(colors) !== colorsBaseline) {
        const r = await protocol.setLedColors(colors);
        if (!r.success) { setError(r.message); return; }
        setColorsBaseline(JSON.stringify(colors));
      }
      if (protocol.setLedStripModeColors && modeColors.length > 0 && JSON.stringify(modeColors) !== modeColorsBaseline) {
        const base: BfLedModeColor[] = modeColorsBaseline ? JSON.parse(modeColorsBaseline) : [];
        const changed = modeColors.filter((mc) => base.find((b) => b.mode === mc.mode && b.fun === mc.fun)?.color !== mc.color);
        const r = await protocol.setLedStripModeColors(changed);
        if (!r.success) { setError(r.message); return; }
        setModeColorsBaseline(JSON.stringify(modeColors));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedProtocol, leds, baseline, colors, colorsBaseline, modeColors, modeColorsBaseline]);

  const update = useCallback((idx: number, patch: Partial<BfLed>) => {
    setLeds((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }, []);

  const updateColor = useCallback((idx: number, patch: Partial<HsvColor>) => {
    setColors((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }, []);

  const updateModeColor = useCallback((mode: number, fun: number, color: number) => {
    setModeColors((prev) => {
      const idx = prev.findIndex((m) => m.mode === mode && m.fun === fun);
      if (idx === -1) return [...prev, { mode, fun, color }];
      return prev.map((m, i) => (i === idx ? { ...m, color } : m));
    });
  }, []);

  const dirty =
    hasLoaded &&
    (JSON.stringify(leds) !== baseline ||
      JSON.stringify(colors) !== colorsBaseline ||
      JSON.stringify(modeColors) !== modeColorsBaseline);
  useUnsavedGuard(dirty);
  const disabled = loading || isArmed;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <PanelHeader
        title="LED Strip"
        subtitle="Betaflight per-LED position, color, function, and effects"
        icon={<Lightbulb size={16} />}
        loading={loading}
        loadProgress={null}
        hasLoaded={hasLoaded}
        onRead={read}
        connected={connected}
        error={error}
      >
        {hasLoaded && (
          <Button
            variant="primary" size="sm" icon={<Upload size={12} />} loading={loading}
            disabled={!connected || !dirty || disabled}
            title={isArmed ? lockMessage : undefined}
            onClick={write}
          >
            Write to FC
          </Button>
        )}
      </PanelHeader>

      {dirty && <p className="text-[10px] font-mono text-status-warning py-1">Unsaved changes : use Write to FC to apply.</p>}
      {hasLoaded && leds.length === 0 && <p className="text-xs text-text-tertiary py-4">No LEDs configured on this strip.</p>}

      {hasLoaded && (
        <div className="space-y-2 mt-2">
          {leds.map((led, idx) => (
            <div key={idx} className="border border-border-default p-3 space-y-2">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs font-mono font-semibold text-text-primary w-12">LED {idx}</span>
                <label className="flex items-center gap-1 text-[10px] text-text-tertiary font-mono">
                  X <input type="number" min={0} max={15} value={led.x} disabled={disabled} onChange={(e) => update(idx, { x: Math.min(15, Math.max(0, parseInt(e.target.value) || 0)) })} className="w-12 bg-bg-tertiary border border-border-default px-1 py-0.5 text-text-primary" />
                </label>
                <label className="flex items-center gap-1 text-[10px] text-text-tertiary font-mono">
                  Y <input type="number" min={0} max={15} value={led.y} disabled={disabled} onChange={(e) => update(idx, { y: Math.min(15, Math.max(0, parseInt(e.target.value) || 0)) })} className="w-12 bg-bg-tertiary border border-border-default px-1 py-0.5 text-text-primary" />
                </label>
                <div className="w-28"><Select options={COLOR_OPTIONS} value={String(led.color)} onChange={(v) => update(idx, { color: parseInt(v) })} disabled={disabled} /></div>
                <div className="w-36"><Select options={FUNCTION_OPTIONS} value={String(led.fn)} onChange={(v) => update(idx, { fn: parseInt(v) })} disabled={disabled} searchable={false} /></div>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {BF_LED_DIRECTIONS.map((d, b) => (
                  <label key={d} className="flex items-center gap-1 text-[11px] text-text-secondary cursor-pointer">
                    <input type="checkbox" disabled={disabled} checked={(led.directions & (1 << b)) !== 0} onChange={(e) => update(idx, { directions: toggleFlag(led.directions, b, e.target.checked) })} />
                    {d}
                  </label>
                ))}
                <span className="text-text-tertiary text-[10px]">|</span>
                {BF_LED_OVERLAYS.map((o, b) => (
                  <label key={o} className="flex items-center gap-1 text-[11px] text-text-secondary cursor-pointer">
                    <input type="checkbox" disabled={disabled} checked={(led.overlays & (1 << b)) !== 0} onChange={(e) => update(idx, { overlays: toggleFlag(led.overlays, b, e.target.checked) })} />
                    {o}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {hasLoaded && colors.length > 0 && (
        <div className="mt-6 space-y-2">
          <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Colour Palette</h3>
          <p className="text-[10px] text-text-tertiary">The 16 HSV colours the per-LED &ldquo;Color N&rdquo; indices reference.</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 max-w-3xl">
            {colors.map((c, idx) => (
              <div key={idx} className="border border-border-default p-2 flex items-center gap-2">
                <span className="w-6 h-6 rounded shrink-0 border border-border-default" style={{ backgroundColor: hsvToHex(c) }} />
                <span className="text-[10px] font-mono text-text-tertiary w-6">{idx}</span>
                <label className="flex flex-col text-[9px] text-text-tertiary font-mono">H
                  <input type="number" min={0} max={359} value={c.h} disabled={disabled} onChange={(e) => updateColor(idx, { h: Math.min(359, Math.max(0, parseInt(e.target.value) || 0)) })} className="w-12 bg-bg-tertiary border border-border-default px-1 py-0.5 text-text-primary" />
                </label>
                <label className="flex flex-col text-[9px] text-text-tertiary font-mono">S
                  <input type="number" min={0} max={255} value={c.s} disabled={disabled} onChange={(e) => updateColor(idx, { s: Math.min(255, Math.max(0, parseInt(e.target.value) || 0)) })} className="w-12 bg-bg-tertiary border border-border-default px-1 py-0.5 text-text-primary" />
                </label>
                <label className="flex flex-col text-[9px] text-text-tertiary font-mono">V
                  <input type="number" min={0} max={255} value={c.v} disabled={disabled} onChange={(e) => updateColor(idx, { v: Math.min(255, Math.max(0, parseInt(e.target.value) || 0)) })} className="w-12 bg-bg-tertiary border border-border-default px-1 py-0.5 text-text-primary" />
                </label>
              </div>
            ))}
          </div>
        </div>
      )}

      {hasLoaded && modeColors.length > 0 && (
        <BfLedModeColors
          modeColors={modeColors}
          colors={colors}
          disabled={disabled}
          onChange={updateModeColor}
        />
      )}
    </div>
  );
}
