"use client";

import { useOptionLabels } from "@/lib/i18n/option-labels";
import { useTranslations } from "next-intl";
import { useMemo, useCallback, useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { usePanelParams } from "@/hooks/use-panel-params";
import { useParamPanelActions } from "@/hooks/use-param-panel-actions";
import { usePanelScroll } from "@/hooks/use-panel-scroll";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { PanelHeader } from "../shared/PanelHeader";
import { ArmedWarningBanner } from "@/components/indicators/ArmedWarningBanner";
import { Radio, Save, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  vtxParamNames, VTX_BANDS, BAND_INDEX_TO_LETTER, BAND_LETTER_TO_INDEX,
  VTX_TYPE_LABELS, VTX_TYPE_NONE, PIT_MODE_OPTIONS, LOW_POWER_DISARM_OPTIONS,
  BAND_NAMES, CHANNEL_COUNT,
} from "./vtx-constants";
import type { MspVtxTablePowerLevel } from "@/lib/protocol/types/betaflight";
import { FcSection } from "@/components/fc/shared/FcSection";

import { PanelSaveBar } from "@/components/fc/shared/PanelSaveBar";

export function VtxPanel() {
  const ol = useOptionLabels();
  const tk = useTranslations("fcPanels.vtxPanel");
  const selectedProtocol = useDroneManager(selectSelectedProtocol);
  const scrollRef = usePanelScroll("vtx");

  const panelParams = usePanelParams({ paramNames: vtxParamNames, panelId: "vtx", autoLoad: true });
  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded,
    refresh, setLocalValue,
  } = panelParams;
  const { saving, flashing, save: handleSave, flash: handleFlash } = useParamPanelActions(panelParams);
  useUnsavedGuard(dirtyParams.size > 0);

  const connected = !!selectedProtocol;
  const hasDirty = dirtyParams.size > 0;

  const p = (name: string, fallback = "0") => String(params.get(name) ?? fallback);
  const set = (name: string, v: string) => setLocalValue(name, Number(v) || 0);

  const vtxType = params.get("BF_VTX_TYPE");

  // BF_VTX_POWER is a 1-based index into the FC's VTX table; the labels come
  // from that table, since the mW behind each index depends on the device.
  const [powerLevels, setPowerLevels] = useState<MspVtxTablePowerLevel[] | null>(null);
  useEffect(() => {
    const protocol = selectedProtocol;
    if (!hasLoaded || !protocol?.getVtxPowerLevels) return;
    let cancelled = false;
    protocol.getVtxPowerLevels().then(
      (levels) => { if (!cancelled) setPowerLevels(levels); },
      () => { if (!cancelled) setPowerLevels([]); },
    );
    return () => { cancelled = true; };
  }, [selectedProtocol, hasLoaded]);
  const powerValue = params.get("BF_VTX_POWER");
  const powerOptions = useMemo(() => {
    const options = (powerLevels ?? []).map((l) => ({
      value: String(l.powerNumber),
      label: `${l.powerNumber} — ${l.powerLabel.trim() || `${l.powerValue}`}`,
    }));
    if (powerValue !== undefined && !options.some((o) => o.value === String(powerValue))) {
      options.push({ value: String(powerValue), label: `${powerValue} — not in the VTX table` });
    }
    return options;
  }, [powerLevels, powerValue]);
  const selectedBand = Number(params.get("BF_VTX_BAND") ?? 1);
  const selectedChannel = Number(params.get("BF_VTX_CHANNEL") ?? 1);

  const selectedBandLetter = BAND_INDEX_TO_LETTER[selectedBand] ?? "A";
  const selectedFrequency = useMemo(() => {
    const bandFreqs = VTX_BANDS[selectedBandLetter];
    if (!bandFreqs) return 0;
    const chIdx = selectedChannel - 1;
    return bandFreqs[chIdx] ?? 0;
  }, [selectedBandLetter, selectedChannel]);

  const handleCellClick = useCallback(
    (bandLetter: string, channel: number) => {
      const bandIdx = BAND_LETTER_TO_INDEX[bandLetter];
      if (bandIdx !== undefined) {
        setLocalValue("BF_VTX_BAND", bandIdx);
        setLocalValue("BF_VTX_CHANNEL", channel);
      }
    },
    [setLocalValue],
  );

  return (
    <ArmedWarningBanner>
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-6">
        <PanelHeader
          title="VTX"
          subtitle={tk("videoTransmitterBandChannelAnd")}
          icon={<Radio size={16} />}
          loading={loading}
          loadProgress={loadProgress}
          hasLoaded={hasLoaded}
          onRead={refresh}
          connected={connected}
          error={error}
        />

        {/* VTX Type: detected by the FC, not configurable */}
        <FcSection icon={<Radio size={14} />} title={tk("vtxType")}>
          <p className="text-xs font-mono text-text-primary">
            {vtxType === undefined ? "—" : `${vtxType} — ${VTX_TYPE_LABELS[vtxType] ?? "Unknown"}`}
          </p>
          <p className="text-[10px] text-text-tertiary">{tk("detectedByTheFlightController")}</p>
        </FcSection>

        {(vtxType === 0 || vtxType === VTX_TYPE_NONE) && hasLoaded && (
          <div className="border border-status-warning/30 bg-status-warning/5 p-4 flex items-center gap-3">
            <AlertTriangle size={16} className="text-status-warning shrink-0" />
            <p className="text-xs text-text-secondary">
              {vtxType === 0
                ? "The connected VTX cannot be controlled by the flight controller."
                : "No VTX detected. Check the VTX wiring and the peripheral port assignment."}
            </p>
          </div>
        )}

        {vtxType !== undefined && vtxType !== 0 && (
          <>
            {/* Band / Channel Grid */}
            <FcSection>
              <div className="flex items-center gap-2 mb-1">
                <Radio size={14} className="text-accent-primary" />
                <h2 className="text-sm font-medium text-text-primary">{tk("bandChannel")}</h2>
                {selectedFrequency > 0 && (
                  <span className="text-[10px] font-mono text-accent-primary ml-auto">
                    {selectedBandLetter}{selectedChannel} — {selectedFrequency} MHz
                  </span>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[10px] font-mono">
                  <thead>
                    <tr>
                      <th className="text-left text-text-tertiary px-1 py-1 w-12">{tk("band")}</th>
                      {Array.from({ length: CHANNEL_COUNT }, (_, i) => (
                        <th key={i} className="text-center text-text-tertiary px-1 py-1">
                          CH{i + 1}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {BAND_NAMES.map((bandLetter) => {
                      const freqs = VTX_BANDS[bandLetter];
                      const displayName = bandLetter === "R" ? "Race" : `Band ${bandLetter}`;
                      return (
                        <tr key={bandLetter}>
                          <td className="text-text-secondary px-1 py-0.5 font-medium">
                            {displayName}
                          </td>
                          {freqs.map((freq, chIdx) => {
                            const ch = chIdx + 1;
                            const isSelected =
                              bandLetter === selectedBandLetter && ch === selectedChannel;
                            return (
                              <td key={chIdx} className="px-0.5 py-0.5">
                                <button
                                  type="button"
                                  onClick={() => handleCellClick(bandLetter, ch)}
                                  className={cn(
                                    "w-full px-1 py-1.5 text-center transition-colors border",
                                    isSelected
                                      ? "bg-accent-primary/20 border-accent-primary text-accent-primary font-bold"
                                      : "bg-bg-tertiary border-border-default text-text-secondary hover:bg-bg-tertiary/80 hover:border-text-tertiary",
                                  )}
                                >
                                  {freq}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </FcSection>

            {/* Power / Pit Mode / Low Power */}
            <FcSection icon={<Radio size={14} />} title={tk("powerSettings")}>
              {powerLevels !== null && powerLevels.length === 0 ? (
                <p className="text-[10px] text-text-tertiary">
                  This flight controller reports no VTX power table, so the power level cannot be labelled.
                  Current level: {powerValue ?? "—"}
                </p>
              ) : (
                <Select
                  label={tk("powerLevel")}
                  options={powerOptions}
                  value={powerValue === undefined ? "" : String(powerValue)}
                  onChange={(v) => set("BF_VTX_POWER", v)}
                />
              )}
              <Select
                label={tk("pitMode")}
                options={ol(PIT_MODE_OPTIONS)}
                value={p("BF_VTX_PIT_MODE")}
                onChange={(v) => set("BF_VTX_PIT_MODE", v)}
              />
              <Select
                label={tk("lowPowerOnDisarm")}
                options={ol(LOW_POWER_DISARM_OPTIONS)}
                value={p("BF_VTX_LOW_POWER_DISARM")}
                onChange={(v) => set("BF_VTX_LOW_POWER_DISARM", v)}
              />
            </FcSection>

            {/* Frequency Override */}
            <FcSection icon={<Radio size={14} />} title={tk("frequencyOverride")}>
              <Input
                label={tk("manualFrequencyMHz")}
                type="number"
                step="1"
                min="0"
                max="6000"
                unit="MHz"
                value={p("BF_VTX_FREQUENCY")}
                onChange={(e) => set("BF_VTX_FREQUENCY", e.target.value)}
              />
              <p className="text-[10px] text-text-tertiary">
                {tk("setTo0ToUse")}
              </p>
            </FcSection>
          </>
        )}

        {/* Save */}
        <PanelSaveBar
          onSave={handleSave}
          saving={saving}
          saveDisabled={!hasDirty || !connected}
          showFlash={hasRamWrites}
          onFlash={handleFlash}
          flashing={flashing}
          showConnectHint={!connected}
          showUnsavedHint={hasDirty && connected}
        />
      </div>
    </div>
    </ArmedWarningBanner>
  );
}
