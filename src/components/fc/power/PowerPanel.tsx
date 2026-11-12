"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { Input } from "@/components/ui/input";
import { useFcPanelState } from "@/hooks/use-fc-panel-state";
import { useParamPanelActions } from "@/hooks/use-param-panel-actions";
import { useFirmwareCapabilities } from "@/hooks/use-firmware-capabilities";
import { useParamLabel } from "@/hooks/use-param-label";
import { useParamMetadataMap } from "@/hooks/use-param-metadata";
import { PanelHeader } from "../shared/PanelHeader";
import { ArmedWarningBanner } from "@/components/indicators/ArmedWarningBanner";
import { Battery, Zap, ShieldAlert, Save } from "lucide-react";
import { StarredParam } from "../parameters/ParamStar";
import { ParamFieldLabel } from "../parameters/ParamFieldLabel";
import { ParamEnumSelect, useParamEnums } from "../shared/ParamEnumSelect";
import { LiveBatteryDisplay } from "./LiveBatteryDisplay";
import { Px4PowerSections, PX4_POWER_PARAMS, PX4_OPTIONAL_POWER_PARAMS } from "./Px4PowerSections";
import { BF_POWER_PARAMS } from "./bf-power-constants";
import { FcSection } from "@/components/fc/shared/FcSection";

import { PanelSaveBar } from "@/components/fc/shared/PanelSaveBar";

const POWER_PARAMS = [
  "BATT_MONITOR", "BATT_CAPACITY", "BATT_AMP_PERVLT", "BATT_AMP_OFFSET",
  "BATT_FS_LOW_VOLT", "BATT_FS_LOW_ACT", "BATT_FS_CRT_VOLT", "BATT_FS_CRT_ACT",
  "BATT_FS_LOW_MAH", "BATT_FS_CRT_MAH",
];

const OPTIONAL_POWER_PARAMS = [
  "BATT2_MONITOR", "BATT2_CAPACITY", "BATT2_AMP_PERVLT", "BATT2_AMP_OFFSET",
  "BATT2_FS_LOW_VOLT", "BATT2_FS_LOW_ACT", "BATT2_FS_CRT_VOLT", "BATT2_FS_CRT_ACT",
  "BATT2_FS_LOW_MAH", "BATT2_FS_CRT_MAH",
];

const NO_PARAMS: string[] = [];

export function PowerPanel() {
  const tp = useTranslations("fcPower");
  const { firmwareType } = useFirmwareCapabilities();
  const isPx4 = firmwareType === 'px4';
  const isBetaflight = firmwareType === 'betaflight';
  const isArduPilot = !isPx4 && !isBetaflight;
  const { label: pl } = useParamLabel();
  const metadata = useParamMetadataMap();
  const { enumValues } = useParamEnums(metadata);
  const lbl = (raw: string) => <ParamFieldLabel raw={pl(raw)} metadata={metadata} />;

  const powerParamNames = useMemo(
    () => isBetaflight ? [...BF_POWER_PARAMS] : isPx4 ? PX4_POWER_PARAMS : POWER_PARAMS,
    [isBetaflight, isPx4],
  );
  const optionalPowerParams = isBetaflight ? NO_PARAMS : isPx4 ? PX4_OPTIONAL_POWER_PARAMS : OPTIONAL_POWER_PARAMS;

  const panelState = useFcPanelState({ paramNames: powerParamNames, optionalParams: optionalPowerParams, panelId: "power", autoLoad: true, scroll: true });
  const {
    params, loading, error, dirtyParams, hasRamWrites, loadProgress, hasLoaded,
    getProtocol, scrollRef,
    refresh, setLocalValue,
  } = panelState;
  const { saving, flashing, save: handleSave, flash: handleFlash } = useParamPanelActions(panelState);

  const connected = !!getProtocol();
  const hasDirty = dirtyParams.size > 0;

  const p = (name: string, fallback = "0") => String(params.get(name) ?? fallback);
  const set = (name: string, v: string) => setLocalValue(name, Number(v) || 0);
  // Battery failsafe actions are vehicle-specific enums (Copter 1 = Land,
  // Plane 1 = RTL) and come from the vehicle's metadata.
  const actionField = (name: string, text: string) => (
    <ParamEnumSelect label={lbl(`${name} — ${text}`)} values={enumValues(name)}
      value={params.get(name) ?? 0} onChange={(v) => setLocalValue(name, v)} />
  );

  return (
    <ArmedWarningBanner>
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-6">
        <PanelHeader title={tp("powerBattery")} subtitle={tp("batteryCapacityCurrentSensorCalibration")}
          icon={<Battery size={16} />} loading={loading} loadProgress={loadProgress} hasLoaded={hasLoaded}
          onRead={refresh} connected={connected} error={error} />

        <LiveBatteryDisplay />

        {isPx4 && (
          <Px4PowerSections params={params} setLocalValue={setLocalValue} lbl={lbl} enumValues={enumValues} />
        )}

        {/* Betaflight Battery Settings */}
        {isBetaflight && (
          <FcSection icon={<Battery size={14} />} title={tp("batterySettings")}>
            <Input label={tp("minCellVoltageV")} type="number" step="0.01" min="2.0" max="4.5" unit="V"
              value={((Number(params.get("BF_BATT_MIN_CELL") ?? 330)) / 100).toFixed(2)}
              onChange={(e) => setLocalValue("BF_BATT_MIN_CELL", Math.round(Number(e.target.value) * 100))} />
            <p className="text-[10px] text-text-tertiary -mt-1">{tp("cellVoltageBelowWhichFailsafe")}</p>
            <Input label={tp("maxCellVoltageV")} type="number" step="0.01" min="3.0" max="5.0" unit="V"
              value={((Number(params.get("BF_BATT_MAX_CELL") ?? 430)) / 100).toFixed(2)}
              onChange={(e) => setLocalValue("BF_BATT_MAX_CELL", Math.round(Number(e.target.value) * 100))} />
            <p className="text-[10px] text-text-tertiary -mt-1">{tp("fullChargeVoltagePerCell")}</p>
            <Input label={tp("warningCellVoltageV")} type="number" step="0.01" min="2.0" max="4.5" unit="V"
              value={((Number(params.get("BF_BATT_WARNING_CELL") ?? 350)) / 100).toFixed(2)}
              onChange={(e) => setLocalValue("BF_BATT_WARNING_CELL", Math.round(Number(e.target.value) * 100))} />
            <p className="text-[10px] text-text-tertiary -mt-1">{tp("cellVoltageWarningThresholdDefault")}</p>
            <Input label={tp("capacityMAh")} type="number" step="50" min="0" unit="mAh"
              value={String(params.get("BF_BATT_CAPACITY") ?? 0)}
              onChange={(e) => setLocalValue("BF_BATT_CAPACITY", Number(e.target.value) || 0)} />
            <p className="text-[10px] text-text-tertiary -mt-1">{tp("batteryCapacityInMAhSet")}</p>
          </FcSection>
        )}

        {/* Battery Settings (ArduPilot) */}
        {isArduPilot && (
          <FcSection icon={<Battery size={14} />} title={tp("batterySettings")}>
            <StarredParam param="BATT_MONITOR">
              <ParamEnumSelect label={lbl(`BATT_MONITOR — ${tp("batteryMonitorType")}`)} values={enumValues("BATT_MONITOR")}
                value={params.get("BATT_MONITOR") ?? 0} onChange={(v) => setLocalValue("BATT_MONITOR", v)} />
            </StarredParam>
            <StarredParam param="BATT_CAPACITY">
              <Input label={lbl(`BATT_CAPACITY — ${tp("batteryCapacity")}`)} type="number" step="100" min="0" unit="mAh" value={p("BATT_CAPACITY")} onChange={(e) => set("BATT_CAPACITY", e.target.value)} />
            </StarredParam>
          </FcSection>
        )}

        {/* Current Sensor Calibration (ArduPilot) */}
        {isArduPilot && (
          <FcSection icon={<Zap size={14} />} title={tp("currentSensorCalibration")}>
            <StarredParam param="BATT_AMP_PERVLT">
              <Input label={lbl(`BATT_AMP_PERVLT — ${tp("ampsPerVolt")}`)} type="number" step="0.1" unit="A/V" value={p("BATT_AMP_PERVLT", "17.0")} onChange={(e) => set("BATT_AMP_PERVLT", e.target.value)} />
            </StarredParam>
            <StarredParam param="BATT_AMP_OFFSET">
              <Input label={lbl(`BATT_AMP_OFFSET — ${tp("currentSensorZeroOffset")}`)} type="number" step="0.001" unit="V" value={p("BATT_AMP_OFFSET", "0.0")} onChange={(e) => set("BATT_AMP_OFFSET", e.target.value)} />
            </StarredParam>
          </FcSection>
        )}

        {/* Battery 1 Failsafe (ArduPilot) */}
        {isArduPilot && <FcSection icon={<ShieldAlert size={14} />} title={tp("battery1Failsafe")}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input label={lbl(`BATT_FS_LOW_VOLT — ${tp("lowVoltage")}`)} type="number" step="0.1" min="0" unit="V" value={p("BATT_FS_LOW_VOLT")} onChange={(e) => set("BATT_FS_LOW_VOLT", e.target.value)} />
            {actionField("BATT_FS_LOW_ACT", "Low Action")}
            <Input label={lbl(`BATT_FS_CRT_VOLT — ${tp("criticalVoltage")}`)} type="number" step="0.1" min="0" unit="V" value={p("BATT_FS_CRT_VOLT")} onChange={(e) => set("BATT_FS_CRT_VOLT", e.target.value)} />
            {actionField("BATT_FS_CRT_ACT", "Critical Action")}
            <Input label={lbl(`BATT_FS_LOW_MAH — ${tp("lowMAhRemaining")}`)} type="number" step="50" min="0" unit="mAh" value={p("BATT_FS_LOW_MAH")} onChange={(e) => set("BATT_FS_LOW_MAH", e.target.value)} />
            <Input label={lbl(`BATT_FS_CRT_MAH — ${tp("criticalMAhRemaining")}`)} type="number" step="50" min="0" unit="mAh" value={p("BATT_FS_CRT_MAH")} onChange={(e) => set("BATT_FS_CRT_MAH", e.target.value)} />
          </div>
        </FcSection>}

        {/* Battery 2 (ArduPilot) */}
        {isArduPilot && params.has("BATT2_MONITOR") && p("BATT2_MONITOR") !== "0" && (
          <>
            <FcSection icon={<Battery size={14} />} title={tp("battery2Settings")}>
              <ParamEnumSelect label={lbl(`BATT2_MONITOR — ${tp("battery2MonitorType")}`)} values={enumValues("BATT2_MONITOR")}
                value={params.get("BATT2_MONITOR") ?? 0} onChange={(v) => setLocalValue("BATT2_MONITOR", v)} />
              <Input label={lbl(`BATT2_CAPACITY — ${tp("battery2Capacity")}`)} type="number" step="100" min="0" unit="mAh" value={p("BATT2_CAPACITY")} onChange={(e) => set("BATT2_CAPACITY", e.target.value)} />
              <Input label={lbl(`BATT2_AMP_PERVLT — ${tp("battery2AmpsPerVolt")}`)} type="number" step="0.1" unit="A/V" value={p("BATT2_AMP_PERVLT", "17.0")} onChange={(e) => set("BATT2_AMP_PERVLT", e.target.value)} />
              <Input label={lbl(`BATT2_AMP_OFFSET — ${tp("battery2CurrentSensorZero")}`)} type="number" step="0.001" unit="V" value={p("BATT2_AMP_OFFSET", "0.0")} onChange={(e) => set("BATT2_AMP_OFFSET", e.target.value)} />
            </FcSection>
            <FcSection icon={<ShieldAlert size={14} />} title={tp("battery2Failsafe")}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Input label={lbl(`BATT2_FS_LOW_VOLT — ${tp("lowVoltage")}`)} type="number" step="0.1" min="0" unit="V" value={p("BATT2_FS_LOW_VOLT")} onChange={(e) => set("BATT2_FS_LOW_VOLT", e.target.value)} />
                {actionField("BATT2_FS_LOW_ACT", "Low Action")}
                <Input label={lbl(`BATT2_FS_CRT_VOLT — ${tp("criticalVoltage")}`)} type="number" step="0.1" min="0" unit="V" value={p("BATT2_FS_CRT_VOLT")} onChange={(e) => set("BATT2_FS_CRT_VOLT", e.target.value)} />
                {actionField("BATT2_FS_CRT_ACT", "Critical Action")}
                <Input label={lbl(`BATT2_FS_LOW_MAH — ${tp("lowMAhRemaining")}`)} type="number" step="50" min="0" unit="mAh" value={p("BATT2_FS_LOW_MAH")} onChange={(e) => set("BATT2_FS_LOW_MAH", e.target.value)} />
                <Input label={lbl(`BATT2_FS_CRT_MAH — ${tp("criticalMAhRemaining")}`)} type="number" step="50" min="0" unit="mAh" value={p("BATT2_FS_CRT_MAH")} onChange={(e) => set("BATT2_FS_CRT_MAH", e.target.value)} />
              </div>
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
