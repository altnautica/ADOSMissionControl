"use client";

import { useOptionLabels } from "@/lib/i18n/option-labels";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Gauge } from "lucide-react";

import { Select } from "@/components/ui/select";
import type { SelectOption } from "@/components/ui/select";
import { usePanelCommit } from "@/hooks/use-panel-commit";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { useSettingsStore } from "@/stores/settings-store";
import { usePanelParams } from "@/hooks/use-panel-params";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { useParamLabel } from "@/hooks/use-param-label";
import { useParamMetadataMap } from "@/hooks/use-param-metadata";
import { usePanelScroll } from "@/hooks/use-panel-scroll";
import { cn } from "@/lib/utils";
import { PanelHeader } from "../shared/PanelHeader";
import { ArmedWarningBanner } from "@/components/indicators/ArmedWarningBanner";
import { ParamFieldLabel } from "../parameters/ParamFieldLabel";
import {
  STREAM_GROUPS,
  detectStreamFamily,
  streamRateLoadNames,
  streamRateParam,
} from "./stream-rate-params";

import { PanelSaveBar } from "@/components/fc/shared/PanelSaveBar";

const CHANNELS: SelectOption[] = [1, 2, 3, 4, 5, 6].map((n) => ({
  value: String(n),
  label: `Channel ${n}`,
}));

export function StreamRatesPanel() {
  const ol = useOptionLabels();
  const tr = useTranslations("fcPanels.streamRatesPanel");
  const selectedProtocol = useDroneManager(selectSelectedProtocol);
  const { paramName: pn } = useParamLabel();
  const paramMeta = useParamMetadataMap();
  const scrollRef = usePanelScroll("stream-rates");
  const [channel, setChannel] = useState(1);
  const gcsManagesRates = useSettingsStore((s) => s.gcsManagesTelemetryRates);
  const setGcsManagesRates = useSettingsStore((s) => s.setGcsManagesTelemetryRates);

  // Both the MAVn_* and SRn_* names are read for the channel; the vehicle has
  // one family and the other is simply absent. Every rate is optional so a
  // channel the board does not use leaves the panel usable.
  const paramNames = useMemo(() => streamRateLoadNames(channel), [channel]);
  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded, refresh, setLocalValue, saveAllToRam, commitToFlash, revertAll,
  } = usePanelParams({ paramNames, optionalParams: paramNames, panelId: "stream-rates", autoLoad: true });
  const { saving, save: handleSave, flashing, flash: handleFlash, revert: handleRevert } = usePanelCommit({ saveAllToRam, commitToFlash, revertAll });
  useUnsavedGuard(dirtyParams.size > 0);

  const connected = !!selectedProtocol;
  const hasDirty = dirtyParams.size > 0;
  const family = detectStreamFamily(params, channel);

  return (
    <ArmedWarningBanner>
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-6">
        <PanelHeader title={tr("telemetryStreamRates")} subtitle={tr("perPortMAVLinkMessageGroup")}
          icon={<Gauge size={16} />} loading={loading} loadProgress={loadProgress} hasLoaded={hasLoaded}
          onRead={refresh} connected={connected} error={error} />

        <label className="flex items-start gap-2 text-xs text-text-secondary cursor-pointer">
          <input type="checkbox" checked={gcsManagesRates} onChange={(e) => setGcsManagesRates(e.target.checked)}
            className="mt-0.5 accent-accent-primary" />
          <span>
            {tr("gcsManagesTelemetryRatesOn")}
          </span>
        </label>

        <div className="flex items-center gap-3">
          <span className="text-xs text-text-secondary">{tr("mavlinkChannel")}</span>
          <div className="w-64">
            <Select options={CHANNELS} value={String(channel)} onChange={(v) => setChannel(Number(v))} />
          </div>
        </div>

        <div className="border border-border-default bg-bg-secondary p-4">
          {family === null ? (
            <p className="text-[10px] text-text-tertiary">
              {hasLoaded
                ? `The vehicle reports no stream-rate parameters for channel ${channel}.`
                : "Stream rates not read yet."}
            </p>
          ) : (
            <>
              <p className="text-[10px] text-text-tertiary mb-3">
                Rate in Hz for each MAVLink message group on channel {channel}. 0 disables the group.
                Lower rates conserve bandwidth on constrained radio links.
              </p>
              <div className="space-y-3">
                {ol(STREAM_GROUPS).map((g) => {
                  const param = streamRateParam(family, channel, g.suffix);
                  const value = params.get(param);
                  const isDirty = dirtyParams.has(param);
                  return (
                    <div key={g.suffix} className="grid grid-cols-[240px_1fr_80px] items-center gap-3">
                      <ParamFieldLabel label={g.label} param={pn(param)} meta={paramMeta.get(param)} />
                      {value === undefined ? (
                        <span className="col-span-2 text-[10px] font-mono text-text-tertiary">not present</span>
                      ) : (
                        <>
                          <div className="relative">
                            <input type="range" min={0} max={50} step={1} value={value}
                              onChange={(e) => setLocalValue(param, parseFloat(e.target.value))}
                              className="w-full h-1.5 bg-bg-tertiary appearance-none cursor-pointer accent-accent-primary [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-accent-primary [&::-webkit-slider-thumb]:cursor-pointer" />
                            <div className="flex justify-between text-[8px] text-text-tertiary font-mono mt-0.5"><span>0</span><span>50 Hz</span></div>
                          </div>
                          <input type="number" min={0} max={50} step={1} value={value}
                            onChange={(e) => setLocalValue(param, parseFloat(e.target.value) || 0)}
                            className={cn("w-full h-7 px-1.5 bg-bg-tertiary border text-xs font-mono text-text-primary text-right focus:outline-none focus:border-accent-primary transition-colors", isDirty ? "border-status-warning" : "border-border-default")} />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <PanelSaveBar
          onSave={handleSave}
          saving={saving}
          saveDisabled={!hasDirty || !connected}
          onRevert={handleRevert}
          revertDisabled={!hasDirty}
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
