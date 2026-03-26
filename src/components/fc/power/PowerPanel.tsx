"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useFcPanelState } from "@/hooks/use-fc-panel-state";
import { useFirmwareCapabilities } from "@/hooks/use-firmware-capabilities";
import { useParamLabel } from "@/hooks/use-param-label";
import { useParamMetadataMap } from "@/hooks/use-param-metadata";
import { PanelHeader } from "../shared/PanelHeader";
import { ArmedLockOverlay } from "@/components/indicators/ArmedLockOverlay";
import { Battery, Zap, ShieldAlert, Save, HardDrive } from "lucide-react";
import { StarredParam } from "../parameters/ParamStar";
import { ParamLabel } from "../parameters/ParamLabel";
import { LiveBatteryDisplay } from "./LiveBatteryDisplay";

const BATT_MONITOR_OPTIONS = [
  { value: "0", label: "0 — Disabled" },
  { value: "3", label: "3 — Analog Voltage Only" },
  { value: "4", label: "4 — Analog Voltage and Current" },
  { value: "5", label: "5 — Solo" },
  { value: "7", label: "7 — SMBus" },
  { value: "8", label: "8 — DroneCAN" },
  { value: "9", label: "9 — ESC" },
  { value: "10", label: "10 — Sum of Selected" },
  { value: "16", label: "16 — Analog VCC" },
];

const BATT_FS_ACTION_OPTIONS = [
  { value: "0", label: "0 — None" },
  { value: "1", label: "1 — Land" },
  { value: "2", label: "2 — RTL" },
  { value: "3", label: "3 — SmartRTL or RTL" },
  { value: "4", label: "4 — SmartRTL or Land" },
  { value: "5", label: "5 — Terminate" },
];

const POWER_PARAMS = [
  "BATT_MONITOR", "BATT_CAPACITY", "BATT_AMP_PERVLT", "BATT_AMP_OFFSET",
  "BATT_FS_LOW_VOLT", "BATT_FS_LOW_ACT", "BATT_FS_CRT_VOLT", "BATT_FS_CRT_ACT",
  "BATT_FS_LOW_MAH", "BATT_FS_CRT_MAH",
];

const BF_POWER_PARAMS = [
  'BF_BATT_MIN_CELL', 'BF_BATT_MAX_CELL', 'BF_BATT_WARNING_CELL', 'BF_BATT_CAPACITY',
] as const;

const OPTIONAL_POWER_PARAMS = [
  "BATT2_MONITOR", "BATT2_CAPACITY", "BATT2_AMP_PERVLT", "BATT2_AMP_OFFSET",
  "BATT2_FS_LOW_VOLT", "BATT2_FS_LOW_ACT", "BATT2_FS_CRT_VOLT", "BATT2_FS_CRT_ACT",
  "BATT2_FS_LOW_MAH", "BATT2_FS_CRT_MAH",
  "BAT1_N_CELLS", "BAT1_R_INTERNAL",
];

export function PowerPanel() {
  const { toast } = useToast();
  const { firmwareType } = useFirmwareCapabilities();
  const isPx4 = firmwareType === 'px4';
  const isBetaflight = firmwareType === 'betaflight';
  const { label: pl } = useParamLabel();
  const metadata = useParamMetadataMap();
  const lbl = (raw: string) => <ParamLabel label={pl(raw)} metadata={metadata} />;
  const [saving, setSaving] = useState(false);

  const powerParamNames = useMemo(() => isBetaflight ? [...BF_POWER_PARAMS] : POWER_PARAMS, [isBetaflight]);
  const optionalPowerParams = useMemo(() => isBetaflight ? [] : OPTIONAL_POWER_PARAMS, [isBetaflight]);

  const {
    params, loading, error, dirtyParams, hasRamWrites, loadProgress, hasLoaded,
    getProtocol, scrollRef,
    refresh, setLocalValue, saveAllToRam, commitToFlash,
  } = useFcPanelState({ paramNames: powerParamNames, optionalParams: optionalPowerParams, panelId: "power", autoLoad: true, scroll: true });

  const connected = !!getProtocol();
  const hasDirty = dirtyParams.size > 0;

  const p = (name: string, fallback = "0") => String(params.get(name) ?? fallback);
  const set = (name: string, v: string) => setLocalValue(name, Number(v) || 0);

  async function handleSave() {
    setSaving(true);
    const ok = await saveAllToRam();
    setSaving(false);
    if (ok) toast("Saved to flight controller", "success");
    else toast("Some parameters failed to save", "warning");
  }

  async function handleFlash() {
    const ok = await commitToFlash();
    if (ok) toast("Written to flash — persists after reboot", "success");
    else toast("Failed to write to flash", "error");
  }

  return (
    <ArmedLockOverlay>
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-6">
        <PanelHeader title="Power / Battery" subtitle="Battery capacity, current sensor calibration, live cell monitoring"
          icon={<Battery size={16} />} loading={loading} loadProgress={loadProgress} hasLoaded={hasLoaded}
          onRead={refresh} connected={connected} error={error} />

        <LiveBatteryDisplay batteryCapacity={Number(params.get("BATT_CAPACITY") ?? 0)} />

        {/* Betaflight Battery Settings */}
        {isBetaflight && (
          <div className="border border-border-default bg-bg-secondary p-4 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <Battery size={14} className="text-accent-primary" />
              <h2 className="text-sm font-medium text-text-primary">Battery Settings</h2>
            </div>
            <Input label="Min Cell Voltage (V)" type="number" step="0.01" min="2.0" max="4.5" unit="V"
              value={((Number(params.get("BF_BATT_MIN_CELL") ?? 330)) / 100).toFixed(2)}
              onChange={(e) => setLocalValue("BF_BATT_MIN_CELL", Math.round(Number(e.target.value) * 100))} />
            <p className="text-[10px] text-text-tertiary -mt-1">Cell voltage below which failsafe triggers. Default: 3.30V</p>
            <Input label="Max Cell Voltage (V)" type="number" step="0.01" min="3.0" max="5.0" unit="V"
              value={((Number(params.get("BF_BATT_MAX_CELL") ?? 430)) / 100).toFixed(2)}
              onChange={(e) => setLocalValue("BF_BATT_MAX_CELL", Math.round(Number(e.target.value) * 100))} />
            <p className="text-[10px] text-text-tertiary -mt-1">Full charge voltage per cell. Used for cell count auto-detection. Default: 4.30V</p>
            <Input label="Warning Cell Voltage (V)" type="number" step="0.01" min="2.0" max="4.5" unit="V"
              value={((Number(params.get("BF_BATT_WARNING_CELL") ?? 350)) / 100).toFixed(2)}
              onChange={(e) => setLocalValue("BF_BATT_WARNING_CELL", Math.round(Number(e.target.value) * 100))} />
            <p className="text-[10px] text-text-tertiary -mt-1">Cell voltage warning threshold. Default: 3.50V</p>
            <Input label="Capacity (mAh)" type="number" step="50" min="0" unit="mAh"
              value={String(params.get("BF_BATT_CAPACITY") ?? 0)}
              onChange={(e) => setLocalValue("BF_BATT_CAPACITY", Number(e.target.value) || 0)} />
            <p className="text-[10px] text-text-tertiary -mt-1">Battery capacity in mAh. Set to 0 for auto-detect.</p>
          </div>
        )}

        {/* Battery Settings (ArduPilot) */}
        {!isBetaflight && (
          <div className="border border-border-default bg-bg-secondary p-4 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <Battery size={14} className="text-accent-primary" />
              <h2 className="text-sm font-medium text-text-primary">Battery Settings</h2>
            </div>
            <StarredParam param="BATT_MONITOR">
              <Select label={lbl("BATT_MONITOR — Battery Monitor Type")} options={BATT_MONITOR_OPTIONS} value={p("BATT_MONITOR")} onChange={(v) => set("BATT_MONITOR", v)} />
            </StarredParam>
            <StarredParam param="BATT_CAPACITY">
              <Input label={lbl("BATT_CAPACITY — Battery Capacity")} type="number" step="100" min="0" unit="mAh" value={p("BATT_CAPACITY")} onChange={(e) => set("BATT_CAPACITY", e.target.value)} />
            </StarredParam>
          </div>
        )}

        {/* Current Sensor Calibration (ArduPilot) */}
        {!isBetaflight && (
          <div className="border border-border-default bg-bg-secondary p-4 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <Zap size={14} className="text-accent-primary" />
              <h2 className="text-sm font-medium text-text-primary">Current Sensor Calibration</h2>
            </div>
            <StarredParam param="BATT_AMP_PERVLT">
              <Input label={lbl("BATT_AMP_PERVLT — Amps Per Volt")} type="number" step="0.1" unit="A/V" value={p("BATT_AMP_PERVLT", "17.0")} onChange={(e) => set("BATT_AMP_PERVLT", e.target.value)} />
            </StarredParam>
            <StarredParam param="BATT_AMP_OFFSET">
              <Input label={lbl("BATT_AMP_OFFSET — Current Offset")} type="number" step="0.01" unit="A" value={p("BATT_AMP_OFFSET", "0.0")} onChange={(e) => set("BATT_AMP_OFFSET", e.target.value)} />
            </StarredParam>
          </div>
        )}

        {/* Battery 1 Failsafe (ArduPilot) */}
        {!isBetaflight && <div className="border border-border-default bg-bg-secondary p-4 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <ShieldAlert size={14} className="text-accent-primary" />
            <h2 className="text-sm font-medium text-text-primary">Battery 1 Failsafe</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label={lbl("BATT_FS_LOW_VOLT — Low Voltage")} type="number" step="0.1" min="0" unit="V" value={p("BATT_FS_LOW_VOLT")} onChange={(e) => set("BATT_FS_LOW_VOLT", e.target.value)} />
            <Select label={lbl("BATT_FS_LOW_ACT — Low Action")} options={BATT_FS_ACTION_OPTIONS} value={p("BATT_FS_LOW_ACT")} onChange={(v) => set("BATT_FS_LOW_ACT", v)} />
            <Input label={lbl("BATT_FS_CRT_VOLT — Critical Voltage")} type="number" step="0.1" min="0" unit="V" value={p("BATT_FS_CRT_VOLT")} onChange={(e) => set("BATT_FS_CRT_VOLT", e.target.value)} />
            <Select label={lbl("BATT_FS_CRT_ACT — Critical Action")} options={BATT_FS_ACTION_OPTIONS} value={p("BATT_FS_CRT_ACT")} onChange={(v) => set("BATT_FS_CRT_ACT", v)} />
            <Input label={lbl("BATT_FS_LOW_MAH — Low mAh Remaining")} type="number" step="50" min="0" unit="mAh" value={p("BATT_FS_LOW_MAH")} onChange={(e) => set("BATT_FS_LOW_MAH", e.target.value)} />
            <Input label={lbl("BATT_FS_CRT_MAH — Critical mAh Remaining")} type="number" step="50" min="0" unit="mAh" value={p("BATT_FS_CRT_MAH")} onChange={(e) => set("BATT_FS_CRT_MAH", e.target.value)} />
          </div>
        </div>}

        {/* Battery 2 (ArduPilot) */}
        {!isBetaflight && p("BATT2_MONITOR") !== "0" && (
          <>
            <div className="border border-border-default bg-bg-secondary p-4 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <Battery size={14} className="text-accent-primary" />
                <h2 className="text-sm font-medium text-text-primary">Battery 2 Settings</h2>
              </div>
              <Select label={lbl("BATT2_MONITOR — Battery 2 Monitor Type")} options={BATT_MONITOR_OPTIONS} value={p("BATT2_MONITOR")} onChange={(v) => set("BATT2_MONITOR", v)} />
              <Input label={lbl("BATT2_CAPACITY — Battery 2 Capacity")} type="number" step="100" min="0" unit="mAh" value={p("BATT2_CAPACITY")} onChange={(e) => set("BATT2_CAPACITY", e.target.value)} />
              <Input label={lbl("BATT2_AMP_PERVLT — Battery 2 Amps Per Volt")} type="number" step="0.1" unit="A/V" value={p("BATT2_AMP_PERVLT", "17.0")} onChange={(e) => set("BATT2_AMP_PERVLT", e.target.value)} />
              <Input label={lbl("BATT2_AMP_OFFSET — Battery 2 Current Offset")} type="number" step="0.01" unit="A" value={p("BATT2_AMP_OFFSET", "0.0")} onChange={(e) => set("BATT2_AMP_OFFSET", e.target.value)} />
            </div>
            <div className="border border-border-default bg-bg-secondary p-4 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <ShieldAlert size={14} className="text-accent-primary" />
                <h2 className="text-sm font-medium text-text-primary">Battery 2 Failsafe</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Input label={lbl("BATT2_FS_LOW_VOLT — Low Voltage")} type="number" step="0.1" min="0" unit="V" value={p("BATT2_FS_LOW_VOLT")} onChange={(e) => set("BATT2_FS_LOW_VOLT", e.target.value)} />
                <Select label={lbl("BATT2_FS_LOW_ACT — Low Action")} options={BATT_FS_ACTION_OPTIONS} value={p("BATT2_FS_LOW_ACT")} onChange={(v) => set("BATT2_FS_LOW_ACT", v)} />
                <Input label={lbl("BATT2_FS_CRT_VOLT — Critical Voltage")} type="number" step="0.1" min="0" unit="V" value={p("BATT2_FS_CRT_VOLT")} onChange={(e) => set("BATT2_FS_CRT_VOLT", e.target.value)} />
                <Select label={lbl("BATT2_FS_CRT_ACT — Critical Action")} options={BATT_FS_ACTION_OPTIONS} value={p("BATT2_FS_CRT_ACT")} onChange={(v) => set("BATT2_FS_CRT_ACT", v)} />
                <Input label={lbl("BATT2_FS_LOW_MAH — Low mAh Remaining")} type="number" step="50" min="0" unit="mAh" value={p("BATT2_FS_LOW_MAH")} onChange={(e) => set("BATT2_FS_LOW_MAH", e.target.value)} />
                <Input label={lbl("BATT2_FS_CRT_MAH — Critical mAh Remaining")} type="number" step="50" min="0" unit="mAh" value={p("BATT2_FS_CRT_MAH")} onChange={(e) => set("BATT2_FS_CRT_MAH", e.target.value)} />
              </div>
            </div>
          </>
        )}

        {/* PX4 Battery Config */}
        {isPx4 && hasLoaded && (
          <section className="border-t border-border-secondary pt-4 mt-4">
            <h3 className="text-sm font-medium text-text-secondary mb-3">PX4 Battery Config</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-text-secondary mb-1 block">Cell Count</label>
                <Input type="number" step={1} min={1} max={14} value={String(params.get("BAT1_N_CELLS") ?? 4)}
                  onChange={(e) => setLocalValue("BAT1_N_CELLS", Number(e.target.value) || 4)} className="h-8 text-xs" />
                <p className="text-[10px] text-text-tertiary mt-1">PX4 needs explicit cell count (ArduPilot auto-detects)</p>
              </div>
              <div>
                <label className="text-xs text-text-secondary mb-1 block">Internal Resistance (Ohm)</label>
                <Input type="number" step={0.001} min={0} max={1} value={String(params.get("BAT1_R_INTERNAL") ?? 0.005)}
                  onChange={(e) => setLocalValue("BAT1_R_INTERNAL", Number(e.target.value) || 0)} className="h-8 text-xs" />
              </div>
            </div>
          </section>
        )}

        {/* Save */}
        <div className="flex items-center gap-3 pt-2 pb-4">
          <Button variant="primary" size="lg" icon={<Save size={14} />} disabled={!hasDirty || !connected} loading={saving} onClick={handleSave}>
            Save to Flight Controller
          </Button>
          {hasRamWrites && (
            <Button variant="secondary" size="lg" icon={<HardDrive size={14} />} onClick={handleFlash}>Write to Flash</Button>
          )}
          {!connected && <span className="text-[10px] text-text-tertiary">Connect a drone to save parameters</span>}
          {hasDirty && connected && <span className="text-[10px] text-status-warning">Unsaved changes</span>}
        </div>
      </div>
    </div>
    </ArmedLockOverlay>
  );
}
