"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { usePanelParams } from "@/hooks/use-panel-params";
import { useParamLabel } from "@/hooks/use-param-label";
import { useParamMetadataMap } from "@/hooks/use-param-metadata";
import { usePanelScroll } from "@/hooks/use-panel-scroll";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { useFreshTelemetry } from "@/hooks/use-telemetry-latest";
import { usePanelCommit } from "@/hooks/use-panel-commit";
import { ArmedWarningBanner } from "@/components/indicators/ArmedWarningBanner";
import { PanelHeader } from "../shared/PanelHeader";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Gauge, Save } from "lucide-react";
import { ParamFieldLabel } from "../parameters/ParamFieldLabel";
import { ParamEnumSelect, useParamEnums } from "../shared/ParamEnumSelect";
import { useFirmwareCapabilities } from "@/hooks/use-firmware-capabilities";
import { RangefinderInstance } from "./RangefinderInstance";
import { FlowOrientYawField } from "./FlowOrientYawField";
import { validateFlowOrientYaw } from "@/lib/sensors/flow-orient-yaw";
import {
  SENSOR_PARAMS, OPTIONAL_SENSOR_PARAMS, RNGFND_EXTRA_INSTANCES,
} from "./sensor-constants";

import { PanelSaveBar } from "@/components/fc/shared/PanelSaveBar";

export function SensorsPanel() {
  const tr = useTranslations("fcPanels.sensorsPanel");
  const tf = useTranslations("fcPanels.sensorsPanel.flowSetup");
  const selectedProtocol = useDroneManager(selectSelectedProtocol);
  const { firmwareType } = useFirmwareCapabilities();
  const isPx4 = firmwareType === "px4";
  const { label: pl } = useParamLabel();
  const metadata = useParamMetadataMap();
  const { enumValues } = useParamEnums(metadata);
  const lbl = (raw: string) => <ParamFieldLabel raw={pl(raw)} metadata={metadata} />;
  const scrollRef = usePanelScroll("sensors");

  // Live readouts follow every sample and disappear once the link goes quiet,
  // rather than holding the last value under a "Live" label.
  const latestVfr = useFreshTelemetry("vfr");
  const latestDistance = useFreshTelemetry("distanceSensor");

  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded,
    refresh, setLocalValue, saveAllToRam, commitToFlash, revertAll,
  } = usePanelParams({ paramNames: SENSOR_PARAMS, optionalParams: OPTIONAL_SENSOR_PARAMS, panelId: "sensors" });
  const { saving, save: handleSave, flashing, flash: handleFlash } = usePanelCommit({ saveAllToRam, commitToFlash, revertAll });
  useUnsavedGuard(dirtyParams.size > 0);

  const connected = !!selectedProtocol;
  const hasDirty = dirtyParams.size > 0;

  const p = (name: string, fallback = "0") => String(params.get(name) ?? fallback);
  const set = (name: string, v: string) => setLocalValue(name, Number(v) || 0);
  // Every enum here (rangefinder/flow/airspeed type, ARSPD_USE, BARO_PRIMARY)
  // comes from the vehicle's metadata with the verbatim @Values as the floor.
  const enumField = (name: string, text: string, fallback = 0) => (
    <ParamEnumSelect label={lbl(`${name} — ${text}`)} values={enumValues(name)}
      value={params.get(name) ?? fallback} onChange={(v) => setLocalValue(name, v)} />
  );
  // Optional params the vehicle does not have stay out of `params` after a
  // load. Such a section says so instead of rendering fallback numbers as if
  // they were the vehicle's values.
  const absent = (name: string) => hasLoaded && !params.has(name);
  const notOnFirmware = (name: string) => (
    <p className="text-xs text-text-tertiary">{name} is not on this firmware.</p>
  );

  // A FLOW_ORIENT_YAW edit outside -17999..18000 or off the 10 cdeg step is
  // never written: a wrong flow yaw inverts the velocity feedback.
  const yawEdit = dirtyParams.has("FLOW_ORIENT_YAW") ? params.get("FLOW_ORIENT_YAW") : undefined;
  const yawBlocked = yawEdit !== undefined && !validateFlowOrientYaw(yawEdit).valid;

  // Additional ArduPilot rangefinder instances (2..A): show any that are
  // already configured (TYPE != 0), plus any the operator reveals via "Add".
  // An instance the firmware does not have is never offered.
  const [revealedRngfnd, setRevealedRngfnd] = useState<Set<string>>(new Set());
  const availableRngfnd = RNGFND_EXTRA_INSTANCES.filter((n) => !absent(`RNGFND${n}_TYPE`));
  const extraRngfnd = availableRngfnd.filter(
    (n) => p(`RNGFND${n}_TYPE`) !== "0" || revealedRngfnd.has(n),
  );
  const canAddRngfnd = extraRngfnd.length < availableRngfnd.length;
  const addRngfnd = () => {
    const next = availableRngfnd.find((n) => !extraRngfnd.includes(n));
    if (next) setRevealedRngfnd((prev) => new Set(prev).add(next));
  };

  return (
    <ArmedWarningBanner>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl space-y-4">
          <PanelHeader
            title={tr("sensors")}
            subtitle={tr("rangefinderOpticalFlowAirspeedBarometer")}
            icon={<Gauge size={16} />}
            loading={loading}
            loadProgress={loadProgress}
            hasLoaded={hasLoaded}
            onRead={refresh}
            connected={connected}
            error={error}
          />

          {/* Rangefinder */}
          <CollapsibleSection title={tr("rangefinder")} defaultOpen>
            <div className="p-4 space-y-3">
              {isPx4 ? (
                <div className="space-y-3">
                  <h4 className="text-xs font-medium text-text-secondary">{tr("rangefinderSensors")}</h4>
                  {[
                    { param: "SENS_EN_MB12XX", label: "MaxBotix I2C" },
                    { param: "SENS_EN_LL40LS", label: "LidarLite" },
                    { param: "SENS_EN_SF1XX", label: "LightWare SF1x" },
                  ].map(({ param, label }) => (
                    <div key={param} className="flex items-center justify-between p-2 rounded bg-bg-tertiary">
                      <span className="text-xs text-text-primary">{label}</span>
                      <button
                        onClick={() => setLocalValue(param, (params.get(param) ?? 0) ? 0 : 1)}
                        className={`w-10 h-5 rounded-full transition-colors ${(params.get(param) ?? 0) ? "bg-accent-primary" : "bg-bg-tertiary"}`}
                      >
                        <div className={`w-4 h-4 rounded-full bg-text-primary transition-transform ${(params.get(param) ?? 0) ? "translate-x-5" : "translate-x-0.5"}`} />
                      </button>
                    </div>
                  ))}
                  <h4 className="text-xs font-medium text-text-secondary mt-4">{tr("ekfRangeConfig")}</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-text-secondary mb-1 block">{tr("rangeAidEnable")}</label>
                      <Select
                        value={String(params.get("EKF2_RNG_AID") ?? 1)}
                        onChange={(v) => setLocalValue("EKF2_RNG_AID", Number(v))}
                        options={[
                          { value: "0", label: "Disabled" },
                          { value: "1", label: "Enabled" },
                        ]}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-text-secondary mb-1 block">{tr("maxHeightM")}</label>
                      <Input type="number" step={1} min={0} max={50} value={String(params.get("EKF2_RNG_A_HMAX") ?? 5)} onChange={(e) => setLocalValue("EKF2_RNG_A_HMAX", Number(e.target.value) || 0)} className="h-8 text-xs" />
                    </div>
                    <div>
                      <label className="text-xs text-text-secondary mb-1 block">{tr("noiseM")}</label>
                      <Input type="number" step={0.01} min={0} max={1} value={String(params.get("EKF2_RNG_NOISE") ?? 0.05)} onChange={(e) => setLocalValue("EKF2_RNG_NOISE", Number(e.target.value) || 0)} className="h-8 text-xs" />
                    </div>
                    <div>
                      <label className="text-xs text-text-secondary mb-1 block">{tr("minRangeM")}</label>
                      <Input type="number" step={0.1} min={0} max={5} value={String(params.get("EKF2_MIN_RNG") ?? 0.1)} onChange={(e) => setLocalValue("EKF2_MIN_RNG", Number(e.target.value) || 0)} className="h-8 text-xs" />
                    </div>
                  </div>
                  {latestDistance && (
                    <div className="mt-2 p-3 bg-bg-tertiary/50 rounded space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-text-tertiary">{tr("liveDistance")}</span>
                        <span className="text-sm font-mono text-text-primary">
                          {(latestDistance.currentDistance / 100).toFixed(2)} <span className="text-[10px] text-text-tertiary">m</span>
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {absent("RNGFND1_TYPE") ? notOnFirmware("RNGFND1_TYPE") : enumField("RNGFND1_TYPE", tr("sensorType"))}
                  {!absent("RNGFND1_TYPE") && p("RNGFND1_TYPE") !== "0" && (
                    <>
                      <Input label={lbl(`RNGFND1_PIN — ${tr("analogPin")}`)} type="number" step="1" min="-1" value={p("RNGFND1_PIN", "-1")} onChange={(e) => set("RNGFND1_PIN", e.target.value)} />
                      <Input label={lbl(`RNGFND1_MIN_CM — ${tr("minDistance")}`)} type="number" step="1" min="0" unit="cm" value={p("RNGFND1_MIN_CM", "20")} onChange={(e) => set("RNGFND1_MIN_CM", e.target.value)} />
                      <Input label={lbl(`RNGFND1_MAX_CM — ${tr("maxDistance")}`)} type="number" step="1" min="0" unit="cm" value={p("RNGFND1_MAX_CM", "700")} onChange={(e) => set("RNGFND1_MAX_CM", e.target.value)} />
                      {enumField("RNGFND1_ORIENT", "Orientation", 25)}
                      {latestDistance && (
                        <div className="mt-2 p-3 bg-bg-tertiary/50 rounded space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-text-tertiary">{tr("liveDistance")}</span>
                            <span className="text-sm font-mono text-text-primary">
                              {(latestDistance.currentDistance / 100).toFixed(2)} <span className="text-[10px] text-text-tertiary">m</span>
                            </span>
                          </div>
                          <div className="h-2 bg-bg-tertiary rounded-full overflow-hidden">
                            <div className="h-full bg-accent-primary transition-all duration-200" style={{ width: `${Math.min(100, Math.max(0, ((latestDistance.currentDistance - latestDistance.minDistance) / (latestDistance.maxDistance - latestDistance.minDistance)) * 100))}%` }} />
                          </div>
                          <div className="flex justify-between text-[9px] text-text-tertiary font-mono">
                            <span>{(latestDistance.minDistance / 100).toFixed(1)}m</span>
                            <span>{(latestDistance.maxDistance / 100).toFixed(1)}m</span>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                  {extraRngfnd.map((n) => (
                    <RangefinderInstance key={n} instance={n} p={p} set={set} lbl={lbl} enumValues={enumValues} />
                  ))}
                  {canAddRngfnd && (
                    <Button variant="ghost" size="sm" onClick={addRngfnd} className="mt-1 self-start">
                      + Add rangefinder
                    </Button>
                  )}
                </>
              )}
            </div>
          </CollapsibleSection>

          {/* Optical Flow */}
          <CollapsibleSection title={tr("opticalFlow")}>
            <div className="p-4 space-y-3">
              {absent("FLOW_TYPE") ? notOnFirmware("FLOW_TYPE") : enumField("FLOW_TYPE", tr("sensorType"))}
              {!absent("FLOW_TYPE") && p("FLOW_TYPE") !== "0" && (
                <>
                  <Input label={lbl(`FLOW_FXSCALER — ${tr("xScaler")}`)} type="number" step="1" value={p("FLOW_FXSCALER")} onChange={(e) => set("FLOW_FXSCALER", e.target.value)} />
                  <Input label={lbl(`FLOW_FYSCALER — ${tr("yScaler")}`)} type="number" step="1" value={p("FLOW_FYSCALER")} onChange={(e) => set("FLOW_FYSCALER", e.target.value)} />
                  <FlowOrientYawField
                    label={lbl(`FLOW_ORIENT_YAW — ${tr("yawOrientation")}`)}
                    value={params.get("FLOW_ORIENT_YAW")}
                    onChange={(v) => setLocalValue("FLOW_ORIENT_YAW", v)}
                  />
                </>
              )}
            </div>
          </CollapsibleSection>

          {/* Airspeed */}
          <CollapsibleSection title={tr("airspeed")}>
            <div className="p-4 space-y-3">
              {absent("ARSPD_TYPE") ? notOnFirmware("ARSPD_TYPE") : enumField("ARSPD_TYPE", tr("sensorType"))}
              {!absent("ARSPD_TYPE") && p("ARSPD_TYPE") !== "0" && (
                <>
                  {enumField("ARSPD_USE", "Use Airspeed", 1)}
                  <Input label={lbl(`ARSPD_OFFSET — ${tr("pressureOffset")}`)} type="number" step="0.1" unit="Pa" value={p("ARSPD_OFFSET")} onChange={(e) => set("ARSPD_OFFSET", e.target.value)} />
                  <Input label={lbl(`ARSPD_RATIO — ${tr("speedRatio")}`)} type="number" step="0.01" value={p("ARSPD_RATIO", "1.9936")} onChange={(e) => set("ARSPD_RATIO", e.target.value)} />
                </>
              )}
              {latestVfr && (
                <div className="mt-2 p-2 bg-bg-tertiary/50 rounded">
                  <span className="text-[10px] text-text-tertiary">{tr("liveAirspeed")}</span>
                  <span className="text-sm font-mono text-text-primary ml-2">
                    {latestVfr.airspeed !== undefined ? (
                      <>
                        {latestVfr.airspeed.toFixed(1)} <span className="text-[10px] text-text-tertiary">m/s</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </span>
                </div>
              )}
            </div>
          </CollapsibleSection>

          {/* Barometer */}
          <CollapsibleSection title={tr("barometer")}>
            <div className="p-4 space-y-3">
              <Input label={lbl(`GND_ABS_PRESS — ${tr("absolutePressure")}`)} type="number" step="0.01" unit="Pa" value={p("GND_ABS_PRESS")} onChange={(e) => set("GND_ABS_PRESS", e.target.value)} />
              <Input label={lbl(`GND_TEMP — ${tr("groundTemperature")}`)} type="number" step="0.1" unit="°C" value={p("GND_TEMP")} onChange={(e) => set("GND_TEMP", e.target.value)} />
              {enumField("BARO_PRIMARY", tr("primaryBarometer"))}
            </div>
          </CollapsibleSection>

          {/* Save */}
          <PanelSaveBar
            onSave={() => { if (!yawBlocked) void handleSave(); }}
            saving={saving}
            saveDisabled={!hasDirty || !connected || yawBlocked}
            saveTitle={yawBlocked ? tf("yawSaveBlocked") : undefined}
            showFlash={hasRamWrites}
            onFlash={handleFlash}
            flashing={flashing}
            hint={yawBlocked ? <span className="text-xs text-status-error">{tf("yawSaveBlocked")}</span> : undefined}
            showConnectHint={!connected}
            showUnsavedHint={hasDirty && connected}
          />
        </div>
      </div>
    </ArmedWarningBanner>
  );
}
