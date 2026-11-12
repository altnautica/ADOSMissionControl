"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { useFreshTelemetry } from "@/hooks/use-telemetry-latest";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { PanelHeader } from "../shared/PanelHeader";
import { ArmedWarningBanner } from "@/components/indicators/ArmedWarningBanner";
import { SlidersHorizontal, Save, Radio, Plus, Trash2 } from "lucide-react";
import { usePanelScroll } from "@/hooks/use-panel-scroll";
import type { MspAdjustmentRange } from "@/lib/protocol/types";
import { PwmRangeSlider, stepToPwm, pwmToStep } from "./PwmRangeSlider";
import { ADJUSTMENT_FUNCTIONS, AUX_CHANNELS, adjustmentFunctionLabel } from "./adjustment-constants";
import { FcSection } from "@/components/fc/shared/FcSection";

import { PanelSaveBar } from "@/components/fc/shared/PanelSaveBar";

/** Betaflight MAX_ADJUSTMENT_RANGE_COUNT. */
const MAX_ADJUSTMENTS = 30;

const clampPwm = (pwm: number) => Math.max(900, Math.min(2100, pwm));

export function AdjustmentsPanel() {
  const tr = useTranslations("fcPanels.adjustmentsPanel");
  const selectedProtocol = useDroneManager(selectSelectedProtocol);
  const { toast } = useToast();
  const t = useTranslations("fcToasts.betaflight");
  const tCommit = useTranslations("panelCommit");
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
        toast(t("adjustmentsSaved"), "success");
      } else {
        toast(result.message || t("adjustmentsSaveFailed"), "error");
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : t("adjustmentsSaveFailed"), "error");
    } finally {
      setSaving(false);
    }
  }

  function handleRevert() {
    setRanges(original.map((r) => ({ ...r })));
    toast(tCommit("reverted"), "info");
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
          title={tr("adjustments")}
          subtitle={tr("inFlightParameterAdjustmentVia")}
          icon={<SlidersHorizontal size={16} />}
          loading={loading}
          loadProgress={null}
          hasLoaded={hasLoaded}
          onRead={read}
          connected={connected}
          error={error}
        />

        <p className="text-xs text-text-tertiary">
          {tr("assignRCChannelRangesTo")}
        </p>

        {/* Live RC channel preview */}
        {hasLoaded && latestRc && (
          <FcSection>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-accent-primary"><Radio size={14} /></span>
              <div>
                <h2 className="text-sm font-medium text-text-primary">{tr("liveRCChannels")}</h2>
                <p className="text-[10px] text-text-tertiary">{tr("currentAUXChannelPWMValues")}</p>
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
          </FcSection>
        )}

        {hasLoaded && (
          <div className="space-y-3">
            {ranges.length === 0 && (
              <p className="text-center py-4 text-text-tertiary text-xs">{tr("noAdjustmentsConfigured")}</p>
            )}
            {ranges.map((r, i) => (
              <FcSection key={i}>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium text-text-primary">Adjustment {i + 1}</span>
                  <span className="text-[10px] text-text-tertiary">{adjustmentFunctionLabel(r.adjustmentFunction)}</span>
                  <div className="flex-1" />
                  <Button variant="ghost" size="sm" icon={<Trash2 size={12} />} onClick={() => setRanges((prev) => prev.filter((_, j) => j !== i))} />
                </div>
                <div className="grid grid-cols-[1fr_1fr_1fr] gap-3">
                  <div>
                    <label className="text-[10px] text-text-tertiary block mb-1">{tr("whenChannel")}</label>
                    <Select options={AUX_CHANNELS} value={String(r.auxChannelIndex)} onChange={(v) => update(i, { auxChannelIndex: Number(v) })} />
                  </div>
                  <div>
                    <label className="text-[10px] text-text-tertiary block mb-1">{tr("applyFunction")}</label>
                    <Select
                      options={ADJUSTMENT_FUNCTIONS}
                      value={String(r.adjustmentFunction)}
                      onChange={(v) => update(i, { adjustmentFunction: Number(v) })}
                      searchable
                      searchPlaceholder="Search functions..."
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-text-tertiary block mb-1">{tr("viaChannel")}</label>
                    <Select options={AUX_CHANNELS} value={String(r.auxSwitchChannelIndex)} onChange={(v) => update(i, { auxSwitchChannelIndex: Number(v) })} />
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-text-secondary">
                    <span>{r.rangeStart} µs</span>
                    <span className="text-text-tertiary">{tr("activationRange")}</span>
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
              </FcSection>
            ))}
            <Button variant="secondary" size="sm" icon={<Plus size={12} />} onClick={addAdjustment} disabled={ranges.length >= MAX_ADJUSTMENTS}>
              {tr("addAdjustment")}
            </Button>
          </div>
        )}

        {/* Save / Revert */}
        <PanelSaveBar
          onSave={handleSave}
          saving={saving}
          saveDisabled={!hasDirty || !connected || !canSave}
          onRevert={handleRevert}
          revertDisabled={!hasDirty}
          showConnectHint={!connected}
          showUnsavedHint={hasDirty && connected}
        />
      </div>
    </div>
    </ArmedWarningBanner>
  );
}
