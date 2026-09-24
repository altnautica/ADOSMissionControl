"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { useFreshTelemetry } from "@/hooks/use-telemetry-latest";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { PanelHeader } from "../shared/PanelHeader";
import { ArmedWarningBanner } from "@/components/indicators/ArmedWarningBanner";
import { SlidersHorizontal, Save, RotateCcw, Radio, Plus, Trash2 } from "lucide-react";
import { usePanelScroll } from "@/hooks/use-panel-scroll";
import type { MspAdjustmentRange } from "@/lib/protocol/types";
import { PwmRangeSlider, stepToPwm, pwmToStep } from "./PwmRangeSlider";
import { ADJUSTMENT_FUNCTIONS, AUX_CHANNELS, adjustmentFunctionLabel } from "./adjustment-constants";

/** Betaflight MAX_ADJUSTMENT_RANGE_COUNT. */
const MAX_ADJUSTMENTS = 30;

const clampPwm = (pwm: number) => Math.max(900, Math.min(2100, pwm));

export function AdjustmentsPanel() {
  const selectedProtocol = useDroneManager(selectSelectedProtocol);
  const { toast } = useToast();
  const scrollRef = usePanelScroll("adjustments");

  const [ranges, setRanges] = useState<MspAdjustmentRange[]>([]);
  const [original, setOriginal] = useState<MspAdjustmentRange[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connected = !!selectedProtocol;
  const canSave = !!selectedProtocol?.setAdjustmentRanges;
  const hasDirty = useMemo(() => JSON.stringify(ranges) !== JSON.stringify(original), [ranges, original]);
  useUnsavedGuard(hasDirty);

  const latestRc = useFreshTelemetry("rc");

  const read = useCallback(async () => {
    const protocol = selectedProtocol;
    if (!protocol?.getAdjustmentRanges) {
      setError("Adjustment ranges are not available on this connection");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const slots = (await protocol.getAdjustmentRanges()).filter((r) => r.rangeStart < r.rangeEnd);
      setRanges(slots);
      setOriginal(slots.map((r) => ({ ...r })));
      setHasLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read adjustment ranges");
    } finally {
      setLoading(false);
    }
  }, [selectedProtocol]);

  const readRef = useRef(read);
  readRef.current = read;
  useEffect(() => { readRef.current(); }, []);

  async function handleSave() {
    const protocol = selectedProtocol;
    if (!protocol?.setAdjustmentRanges) return;
    setSaving(true);
    try {
      const result = await protocol.setAdjustmentRanges(ranges);
      if (result.success) {
        setOriginal(ranges.map((r) => ({ ...r })));
        toast("Adjustment ranges saved to the flight controller", "success");
      } else {
        toast(result.message || "Failed to save adjustment ranges", "error");
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save adjustment ranges", "error");
    } finally {
      setSaving(false);
    }
  }

  function handleRevert() {
    setRanges(original.map((r) => ({ ...r })));
    toast("Reverted to FC values", "info");
  }

  const update = (index: number, patch: Partial<MspAdjustmentRange>) =>
    setRanges((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const addAdjustment = () => {
    if (ranges.length >= MAX_ADJUSTMENTS) return;
    setRanges((prev) => [...prev, {
      slotIndex: 0, auxChannelIndex: 0, rangeStart: 1300, rangeEnd: 1700, adjustmentFunction: 0, auxSwitchChannelIndex: 0,
    }]);
  };

  const getAuxPwm = useCallback((auxChannelIndex: number): number => {
    if (!latestRc) return 0;
    return latestRc.channels[auxChannelIndex + 4] ?? 0;
  }, [latestRc]);

  return (
    <ArmedWarningBanner>
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl space-y-6">
        <PanelHeader
          title="Adjustments"
          subtitle="In-flight parameter adjustment via RC channels"
          icon={<SlidersHorizontal size={16} />}
          loading={loading}
          loadProgress={null}
          hasLoaded={hasLoaded}
          onRead={read}
          connected={connected}
          error={error}
        />

        <p className="text-xs text-text-tertiary">
          Assign RC channel ranges to adjust PID, rate, and other parameters in flight.
          Each adjustment maps a switch channel (activation range) and an adjustment channel (value).
        </p>

        {/* Live RC channel preview */}
        {hasLoaded && latestRc && (
          <div className="border border-border-default bg-bg-secondary p-4 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-accent-primary"><Radio size={14} /></span>
              <div>
                <h2 className="text-sm font-medium text-text-primary">Live RC Channels</h2>
                <p className="text-[10px] text-text-tertiary">Current AUX channel PWM values</p>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Array.from({ length: 8 }, (_, i) => {
                const pwm = getAuxPwm(i);
                const pct = pwm > 0 ? ((pwm - 900) / 1200) * 100 : 0;
                return (
                  <div key={i} className="space-y-1">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-text-secondary">AUX {i + 1}</span>
                      <span className="font-mono text-accent-primary tabular-nums">{pwm > 0 ? pwm : "\u2014"}</span>
                    </div>
                    <div className="h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
                      <div className="h-full bg-accent-primary rounded-full transition-all" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {hasLoaded && (
          <div className="space-y-3">
            {ranges.length === 0 && (
              <p className="text-center py-4 text-text-tertiary text-xs">No adjustments configured.</p>
            )}
            {ranges.map((r, i) => (
              <div key={i} className="border border-border-default bg-bg-secondary p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium text-text-primary">Adjustment {i + 1}</span>
                  <span className="text-[10px] text-text-tertiary">{adjustmentFunctionLabel(r.adjustmentFunction)}</span>
                  <div className="flex-1" />
                  <Button variant="ghost" size="sm" icon={<Trash2 size={12} />} onClick={() => setRanges((prev) => prev.filter((_, j) => j !== i))} />
                </div>
                <div className="grid grid-cols-[1fr_1fr_1fr] gap-3">
                  <div>
                    <label className="text-[10px] text-text-tertiary block mb-1">When Channel</label>
                    <Select options={AUX_CHANNELS} value={String(r.auxChannelIndex)} onChange={(v) => update(i, { auxChannelIndex: Number(v) })} />
                  </div>
                  <div>
                    <label className="text-[10px] text-text-tertiary block mb-1">Apply Function</label>
                    <Select
                      options={ADJUSTMENT_FUNCTIONS}
                      value={String(r.adjustmentFunction)}
                      onChange={(v) => update(i, { adjustmentFunction: Number(v) })}
                      searchable
                      searchPlaceholder="Search functions..."
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-text-tertiary block mb-1">Via Channel</label>
                    <Select options={AUX_CHANNELS} value={String(r.auxSwitchChannelIndex)} onChange={(v) => update(i, { auxSwitchChannelIndex: Number(v) })} />
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-text-secondary">
                    <span>{r.rangeStart} µs</span>
                    <span className="text-text-tertiary">Activation Range</span>
                    <span>{r.rangeEnd} µs</span>
                  </div>
                  <PwmRangeSlider
                    start={pwmToStep(clampPwm(r.rangeStart))}
                    end={pwmToStep(clampPwm(r.rangeEnd))}
                    activePwm={getAuxPwm(r.auxChannelIndex)}
                    onChange={(startStep, endStep) => update(i, { rangeStart: stepToPwm(startStep), rangeEnd: stepToPwm(endStep) })}
                    dirty={JSON.stringify(r) !== JSON.stringify(original[i])}
                  />
                </div>
              </div>
            ))}
            <Button variant="secondary" size="sm" icon={<Plus size={12} />} onClick={addAdjustment} disabled={ranges.length >= MAX_ADJUSTMENTS}>
              Add Adjustment
            </Button>
          </div>
        )}

        {/* Save / Revert */}
        <div className="flex items-center gap-3 pt-2 pb-4">
          <Button variant="primary" size="lg" icon={<Save size={14} />} disabled={!hasDirty || !connected || !canSave} loading={saving} onClick={handleSave}>
            Save to Flight Controller
          </Button>
          <Button variant="secondary" size="lg" icon={<RotateCcw size={14} />} disabled={!hasDirty} onClick={handleRevert}>
            Revert
          </Button>
          {!connected && <span className="text-[10px] text-text-tertiary">Connect a drone to save parameters</span>}
          {hasDirty && connected && <span className="text-[10px] text-status-warning">Unsaved changes</span>}
        </div>
      </div>
    </div>
    </ArmedWarningBanner>
  );
}
