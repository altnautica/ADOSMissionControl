"use client";

import { useOptionLabels } from "@/lib/i18n/option-labels";
import { useMemo } from "react";
import { useTranslations } from "next-intl";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { usePanelCommit } from "@/hooks/use-panel-commit";
import { useDroneManager, selectSelectedDrone, selectSelectedProtocol } from "@/stores/drone-manager";
import { usePanelParams } from "@/hooks/use-panel-params";
import { useFirmwareCapabilities } from "@/hooks/use-firmware-capabilities";
import { useParamLabel } from "@/hooks/use-param-label";
import { useParamMetadataMap } from "@/hooks/use-param-metadata";
import { usePanelScroll } from "@/hooks/use-panel-scroll";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { PanelHeader } from "../shared/PanelHeader";
import { ParamEnumSelect, useParamEnums } from "../shared/ParamEnumSelect";
import { ParamFieldLabel } from "../parameters/ParamFieldLabel";
import { ArmedWarningBanner } from "@/components/indicators/ArmedWarningBanner";
import { ShieldAlert, Battery, Radio, Gauge, MapPin, SlidersHorizontal, Mountain } from "lucide-react";
import { StarredParam } from "../parameters/ParamStar";
import { FenceEnableToggle, FenceTypeBits } from "./geofence-components";
import {
  FS_OPTION_BITS, COPTER_FS_PARAMS, PLANE_FS_PARAMS,
  PLANE_FS_OPTIONAL_PARAMS, AP_SHARED_FS_PARAMS, PX4_FS_PARAMS, RC_CHANNEL_COUNT,
} from "./failsafe-constants";
import { FcSection } from "@/components/fc/shared/FcSection";

import { PanelSaveBar } from "@/components/fc/shared/PanelSaveBar";

const EMPTY: string[] = [];

export function FailsafePanel() {
  const ol = useOptionLabels();
  const f = useTranslations("fcFailsafe");
  const selectedProtocol = useDroneManager(selectSelectedProtocol);
  const selectedDrone = useDroneManager(selectSelectedDrone);
  const { label: pl } = useParamLabel();
  const metadata = useParamMetadataMap();
  const { enumValues } = useParamEnums(metadata);
  const lbl = (raw: string) => <ParamFieldLabel raw={pl(raw)} metadata={metadata} />;
  const scrollRef = usePanelScroll("failsafe");

  const drone = selectedDrone;
  const isPlane = useMemo(() => {
    const vc = drone?.vehicleInfo?.vehicleClass;
    return vc === "plane" || vc === "vtol";
  }, [drone?.vehicleInfo?.vehicleClass]);

  const { firmwareType } = useFirmwareCapabilities();
  const isPx4 = firmwareType === 'px4';
  const isArduPilot = !isPx4;
  const isApPlane = isArduPilot && isPlane;
  const isApCopter = isArduPilot && !isPlane;

  const paramNames = useMemo(
    () => isPx4 ? PX4_FS_PARAMS
      : [...AP_SHARED_FS_PARAMS, ...(isPlane ? PLANE_FS_PARAMS : COPTER_FS_PARAMS)],
    [isPlane, isPx4],
  );
  const optionalParams = isApPlane ? PLANE_FS_OPTIONAL_PARAMS : EMPTY;

  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded, missingOptional,
    refresh, setLocalValue, saveAllToRam, commitToFlash, revertAll,
  } = usePanelParams({ paramNames, optionalParams, panelId: "failsafe", autoLoad: true });
  const { saving, save: handleSave, flashing, flash: handleFlash } = usePanelCommit({ saveAllToRam, commitToFlash, revertAll });
  useUnsavedGuard(dirtyParams.size > 0);

  const connected = !!selectedProtocol;
  const hasDirty = dirtyParams.size > 0;

  const p = (name: string, fallback = "0") => String(params.get(name) ?? fallback);
  const set = (name: string, v: string) => setLocalValue(name, Number(v) || 0);
  const enumField = (name: string, text: string) => (
    <StarredParam param={name}>
      <ParamEnumSelect label={lbl(`${name} — ${text}`)} values={enumValues(name)}
        value={params.get(name) ?? 0} onChange={(v) => setLocalValue(name, v)} />
    </StarredParam>
  );

  return (
    <ArmedWarningBanner>
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-6">
        <PanelHeader title={f("failsafeConfiguration")} subtitle={f("configureFailsafeActionsForLoss")}
          loading={loading} loadProgress={loadProgress} hasLoaded={hasLoaded} onRead={refresh}
          connected={connected} error={error} missingOptional={missingOptional} />

        {isApCopter && <FcSection icon={<Gauge size={14} />} title={f("radioFailsafe")} description={f("triggeredWhenTheRCThrottle")}>
          {enumField("FS_THR_ENABLE", f("radioFailsafeAction"))}
          <StarredParam param="FS_THR_VALUE"><Input label={lbl(`FS_THR_VALUE — ${f("throttlePWMThreshold")}`)} type="number" step="1" min="800" max="1200" unit={"\u03BCs"} value={p("FS_THR_VALUE", "975")} onChange={(e) => set("FS_THR_VALUE", e.target.value)} /></StarredParam>
          <p className="text-[10px] text-text-tertiary">{f("throttleHint")}</p>
        </FcSection>}

        {isApPlane && <FcSection icon={<ShieldAlert size={14} />} title={f("shortFailsafe")} description={f("triggeredOnBriefSignalLoss")}>
          {enumField("FS_SHORT_ACTN", f("action"))}
          {params.has("FS_SHORT_TIMEOUT") && <StarredParam param="FS_SHORT_TIMEOUT"><Input label={lbl(`FS_SHORT_TIMEOUT — ${f("timeoutS")}`)} type="number" step="0.1" min="0" unit="s" value={p("FS_SHORT_TIMEOUT", "1.5")} onChange={(e) => set("FS_SHORT_TIMEOUT", e.target.value)} /></StarredParam>}
          {params.has("RC_FS_TIMEOUT") && <StarredParam param="RC_FS_TIMEOUT"><Input label={lbl(`RC_FS_TIMEOUT — ${f("rcFailsafeTimeoutS")}`)} type="number" step="0.1" min="0.1" max="10" unit="s" value={p("RC_FS_TIMEOUT")} onChange={(e) => setLocalValue("RC_FS_TIMEOUT", Number(e.target.value))} /></StarredParam>}
        </FcSection>}

        {isApPlane && <FcSection icon={<ShieldAlert size={14} />} title={f("longFailsafe")} description={f("triggeredOnExtendedSignalLoss")}>
          {enumField("FS_LONG_ACTN", f("action"))}
          <StarredParam param="FS_LONG_TIMEOUT"><Input label={lbl(`FS_LONG_TIMEOUT — ${f("timeoutS")}`)} type="number" step="0.1" min="0" unit="s" value={p("FS_LONG_TIMEOUT", "5.0")} onChange={(e) => set("FS_LONG_TIMEOUT", e.target.value)} /></StarredParam>
        </FcSection>}

        {isApPlane && <FcSection icon={<Gauge size={14} />} title={f("throttleFailsafe")} description={f("triggeredOnRCThrottleLoss")}>
          {enumField("THR_FAILSAFE", f("throttleFailsafe"))}
          <Input label={lbl(`THR_FS_VALUE — ${f("throttlePWMValue")}`)} type="number" step="1" min="800" max="1200" unit={"\u03BCs"} value={p("THR_FS_VALUE", "950")} onChange={(e) => set("THR_FS_VALUE", e.target.value)} />
        </FcSection>}

        {isArduPilot && <FcSection icon={<Battery size={14} />} title={f("batteryFailsafe")} description={f("triggeredOnLowBatteryVoltage")}>
          {enumField("BATT_FS_VOLTSRC", f("voltageSource"))}
          <StarredParam param="BATT_FS_LOW_VOLT"><Input label={lbl(`BATT_FS_LOW_VOLT — ${f("lowVoltageThreshold")}`)} type="number" step="0.1" min="0" unit="V" value={p("BATT_FS_LOW_VOLT")} onChange={(e) => set("BATT_FS_LOW_VOLT", e.target.value)} /></StarredParam>
          {enumField("BATT_FS_LOW_ACT", f("lowVoltageAction"))}
        </FcSection>}

        {/* PX4 has one battery failsafe action (COM_LOW_BAT_ACT) with its own
            enum; the canonical BATT_FS_LOW_ACT name maps onto it. Its
            thresholds are remaining-charge fractions, not volts. */}
        {isPx4 && <FcSection icon={<Battery size={14} />} title={f("batteryFailsafePX4")} description={f("actionOnLowAndCritical")}>
          <StarredParam param="BATT_FS_LOW_VOLT"><Input label={lbl(`BATT_FS_LOW_VOLT — ${f("lowThreshold")}`)} type="number" step="0.01" min="0.12" max="0.5" unit="fraction" value={p("BATT_FS_LOW_VOLT")} onChange={(e) => set("BATT_FS_LOW_VOLT", e.target.value)} /></StarredParam>
          <p className="text-[10px] text-text-tertiary">{f("px4BattFractionHint")}</p>
          {enumField("BATT_FS_LOW_ACT", f("batteryFailsafeAction"))}
        </FcSection>}

        {isApCopter && <FcSection icon={<Radio size={14} />} title={f("gcsFailsafe")} description={f("triggeredOnGCSLinkLoss")}>
          {enumField("FS_GCS_ENABLE", f("gcsFailsafeAction"))}
          <StarredParam param="FS_GCS_TIMEOUT"><Input label={lbl(`FS_GCS_TIMEOUT — ${f("timeout")}`)} type="number" step="1" min="2" max="120" unit="s" value={p("FS_GCS_TIMEOUT", "5")} onChange={(e) => set("FS_GCS_TIMEOUT", e.target.value)} /></StarredParam>
        </FcSection>}

        {isApPlane && <FcSection icon={<Radio size={14} />} title={f("gcsFailsafe")} description={f("triggeredOnGCSLinkLoss")}>
          {enumField("FS_GCS_ENABL", f("gcsFailsafe"))}
        </FcSection>}

        {isApCopter && <FcSection icon={<ShieldAlert size={14} />} title={f("ekfCrashFailsafe")} description={f("triggeredOnNavigationVarianceOr")}>
          {enumField("FS_EKF_ACTION", f("ekfFailsafeAction"))}
          {enumField("FS_CRASH_CHECK", f("crashCheck"))}
        </FcSection>}

        {isArduPilot && params.has("TERRAIN_ENABLE") && <FcSection icon={<Mountain size={14} />} title={f("terrainFailsafe")} description={f("triggeredWhenTerrainDataIs")}>
          {enumField("TERRAIN_ENABLE", f("terrainFollowing"))}
        </FcSection>}

        {isApCopter && params.has("FS_OPTIONS") && <FcSection icon={<ShieldAlert size={14} />} title={f("failsafeOptions")} description={f("fsOPTIONSBitmaskAdditionalFailsafe")}>
          <div className="space-y-1.5">
            {ol(FS_OPTION_BITS).map((bit) => {
              const current = Number(params.get("FS_OPTIONS") ?? 0);
              const isSet = (current & bit.mask) !== 0;
              return (
                <label key={bit.mask} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={isSet} onChange={() => set("FS_OPTIONS", String(current ^ bit.mask))} className="accent-accent-primary" />
                  <span className="text-xs text-text-secondary">{bit.label}</span>
                </label>
              );
            })}
          </div>
          <p className="text-[10px] font-mono text-text-tertiary mt-2">FS_OPTIONS = {Number(params.get("FS_OPTIONS") ?? 0)} (0x{(Number(params.get("FS_OPTIONS") ?? 0)).toString(16).padStart(4, "0")})</p>
        </FcSection>}

        {isArduPilot && <FcSection icon={<SlidersHorizontal size={14} />} title={f("rcChannelOptions")} description={f("perChannelRCSwitchFunctions")}>
          <div className="space-y-2">
            {Array.from({ length: RC_CHANNEL_COUNT }, (_, i) => {
              const ch = i + 1;
              const paramName = `RC${ch}_OPTION`;
              return (
                <div key={ch} className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-text-secondary w-6 text-right">CH{ch}</span>
                  <div className="flex-1 min-w-0">
                    <ParamEnumSelect values={enumValues(paramName)} value={params.get(paramName) ?? 0} onChange={(v) => setLocalValue(paramName, v)} />
                  </div>
                </div>
              );
            })}
          </div>
        </FcSection>}

        {/* ArduPilot geofence: FENCE_ENABLE is a 0/1 switch and the fence
            types are the FENCE_TYPE bitmask. NOT rendered for PX4, whose
            canonical FENCE_ENABLE maps to GF_ACTION (a breach action enum);
            PX4 gets its own card below. */}
        {isArduPilot && <FcSection icon={<MapPin size={14} />} title={f("geofence")} description={f("geographicalBoundaryEnforcement")}>
          <FenceEnableToggle label={pl("FENCE_ENABLE")} enabled={(params.get("FENCE_ENABLE") ?? 0) !== 0} onChange={(v) => setLocalValue("FENCE_ENABLE", v)} />
          <FenceTypeBits value={params.get("FENCE_TYPE") ?? 0} onChange={(v) => setLocalValue("FENCE_TYPE", v)} />
          {enumField("FENCE_ACTION", f("breachAction"))}
          <Input label={lbl(`FENCE_ALT_MAX — ${f("maxAltitude")}`)} type="number" step="1" min="0" unit="m" value={p("FENCE_ALT_MAX", "100")} onChange={(e) => set("FENCE_ALT_MAX", e.target.value)} />
          <Input label={lbl(`FENCE_RADIUS — ${f("maxRadius")}`)} type="number" step="1" min="0" unit="m" value={p("FENCE_RADIUS", "300")} onChange={(e) => set("FENCE_RADIUS", e.target.value)} />
          <Input label={lbl(`FENCE_ALT_MIN — ${f("minAltitude")}`)} type="number" step="0.5" min="-100" unit="m" value={p("FENCE_ALT_MIN")} onChange={(e) => set("FENCE_ALT_MIN", e.target.value)} />
        </FcSection>}

        {isPx4 && <FcSection icon={<MapPin size={14} />} title={f("geofencePX4")} description={f("px4GeofenceActionAndLimits")}>
          {/* GF_ACTION, PX4's own breach-action enum from the vehicle's
              metadata. Value 4 is Flight Termination (motors off). */}
          {enumField("FENCE_ENABLE", f("breachAction"))}
          <Input label={lbl(`FENCE_ALT_MAX — ${f("maxAltitude")}`)} type="number" step="1" min="0" unit="m" value={p("FENCE_ALT_MAX", "100")} onChange={(e) => set("FENCE_ALT_MAX", e.target.value)} />
          <Input label={lbl(`FENCE_RADIUS — ${f("maxRadius")}`)} type="number" step="1" min="0" unit="m" value={p("FENCE_RADIUS", "300")} onChange={(e) => set("FENCE_RADIUS", e.target.value)} />
        </FcSection>}

        {isPx4 && hasLoaded && (
          <section className="border-t border-border-strong pt-4 mt-4">
            <h3 className="text-sm font-medium text-text-secondary mb-3 flex items-center gap-2"><Gauge size={14} /> {f("ekfPosTitle")}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><label className="text-xs text-text-secondary mb-1 block">{f("maxEph")}</label><Input type="number" step={0.5} min={-1} max={400} value={p("COM_POS_FS_EPH", "5")} onChange={(e) => set("COM_POS_FS_EPH", e.target.value)} className="h-8 text-xs" /></div>
              <div><label className="text-xs text-text-secondary mb-1 block">{f("maxEvh")}</label><Input type="number" step={0.5} min={0} max={10} value={p("COM_VEL_FS_EVH", "1")} onChange={(e) => set("COM_VEL_FS_EVH", e.target.value)} className="h-8 text-xs" /></div>
            </div>
          </section>
        )}

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
