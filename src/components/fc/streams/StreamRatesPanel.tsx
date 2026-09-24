"use client";

import { useMemo, useState } from "react";
import { Gauge, Save, RotateCcw, HardDrive } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import type { SelectOption } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useFlashCommitToast } from "@/hooks/use-flash-commit-toast";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
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

const CHANNELS: SelectOption[] = [1, 2, 3, 4, 5, 6].map((n) => ({
  value: String(n),
  label: `Channel ${n}`,
}));

export function StreamRatesPanel() {
  const selectedProtocol = useDroneManager(selectSelectedProtocol);
  const { toast } = useToast();
  const { showFlashResult } = useFlashCommitToast();
  const { paramName: pn } = useParamLabel();
  const paramMeta = useParamMetadataMap();
  const scrollRef = usePanelScroll("stream-rates");
  const [saving, setSaving] = useState(false);
  const [channel, setChannel] = useState(1);

  // Both the MAVn_* and SRn_* names are read for the channel; the vehicle has
  // one family and the other is simply absent. Every rate is optional so a
  // channel the board does not use leaves the panel usable.
  const paramNames = useMemo(() => streamRateLoadNames(channel), [channel]);
  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded, refresh, setLocalValue, saveAllToRam, commitToFlash, revertAll,
  } = usePanelParams({ paramNames, optionalParams: paramNames, panelId: "stream-rates", autoLoad: true });
  useUnsavedGuard(dirtyParams.size > 0);

  const connected = !!selectedProtocol;
  const hasDirty = dirtyParams.size > 0;
  const family = detectStreamFamily(params, channel);

  async function handleSave() {
    setSaving(true);
    const ok = await saveAllToRam();
    setSaving(false);
    toast(ok ? "Saved to flight controller" : "Some parameters failed to save", ok ? "success" : "warning");
  }
  async function handleFlash() { showFlashResult(await commitToFlash()); }
  function handleRevert() { revertAll(); toast("Reverted to FC values", "info"); }

  return (
    <ArmedWarningBanner>
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-6">
        <PanelHeader title="Telemetry Stream Rates" subtitle="Per-port MAVLink message group rates (Hz)"
          icon={<Gauge size={16} />} loading={loading} loadProgress={loadProgress} hasLoaded={hasLoaded}
          onRead={refresh} connected={connected} error={error} />

        <div className="flex items-center gap-3">
          <span className="text-xs text-text-secondary">MAVLink channel</span>
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
                {STREAM_GROUPS.map((g) => {
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

        <div className="flex items-center gap-3 pt-2 pb-4">
          <Button variant="primary" size="lg" icon={<Save size={14} />} disabled={!hasDirty || !connected} loading={saving} onClick={handleSave}>Save to Flight Controller</Button>
          <Button variant="secondary" size="lg" icon={<RotateCcw size={14} />} disabled={!hasDirty} onClick={handleRevert}>Revert</Button>
          {hasRamWrites && <Button variant="secondary" size="lg" icon={<HardDrive size={14} />} onClick={handleFlash}>Write to Flash</Button>}
          {!connected && <span className="text-[10px] text-text-tertiary">Connect a drone to save parameters</span>}
          {hasDirty && connected && <span className="text-[10px] text-status-warning">Unsaved changes</span>}
        </div>
      </div>
    </div>
    </ArmedWarningBanner>
  );
}
