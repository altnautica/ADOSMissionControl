"use client";

/**
 * @module fc/px4/Px4ThermalCalPanel
 * @description PX4 temperature (thermal) calibration panel. PX4 compensates
 * gyro / accel / baro bias against temperature using per-sensor polynomial
 * coefficients (TC_*), normally produced by the onboard thermal-calibration
 * routine during a power-on heat soak. This panel surfaces the calibration
 * state honestly: the per-type enables, the on-boot calibration trigger, and,
 * for each calibrated sensor instance, the covered temperature range. The
 * high-order polynomial coefficients are machine-generated and are not exposed
 * for hand-editing.
 * @license GPL-3.0-only
 */

import { useOptionLabels } from "@/lib/i18n/option-labels";
import { useTranslations } from "next-intl";
import { Thermometer, Save, HardDrive, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { usePanelParams } from "@/hooks/use-panel-params";
import { useParamPanelActions } from "@/hooks/use-param-panel-actions";
import { usePanelScroll } from "@/hooks/use-panel-scroll";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { PanelHeader } from "../shared/PanelHeader";
import { ArmedWarningBanner } from "@/components/indicators/ArmedWarningBanner";
import {
  SENSOR_TYPES, INSTANCES, ENABLE_OPTIONS, TRIGGER_OPTIONS, LIMITS, PARAM_NAMES, OPTIONAL_NAMES,
} from "./px4-thermal-params";
import { FcSection } from "@/components/fc/shared/FcSection";
import { SaveBarLabel } from "@/components/fc/shared/SaveBarLabel";


export function Px4ThermalCalPanel() {
  const ol = useOptionLabels();
  const tr = useTranslations("fcPanels.px4ThermalCalPanel");
  const selectedProtocol = useDroneManager(selectSelectedProtocol);
  const scrollRef = usePanelScroll("px4-thermal");

  const panelParams = usePanelParams({
    paramNames: PARAM_NAMES,
    optionalParams: OPTIONAL_NAMES,
    panelId: "px4-thermal",
    autoLoad: true,
  });
  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded, missingOptional,
    refresh, setLocalValue,
  } = panelParams;
  const { saving, save: handleSave, flashing, flash: handleFlash } =
    useParamPanelActions(panelParams);
  useUnsavedGuard(dirtyParams.size > 0);

  const connected = !!selectedProtocol;
  const hasDirty = dirtyParams.size > 0;
  const has = (name: string) => params.has(name);
  const num = (name: string, fallback = 0) => params.get(name) ?? fallback;
  const str = (name: string, fallback = "0") => String(params.get(name) ?? fallback);

  return (
    <ArmedWarningBanner>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl space-y-6">
          <PanelHeader
            title={tr("thermalCalibration")}
            subtitle={tr("temperatureCompensationForGyroAccel")}
            icon={<Thermometer size={16} />}
            loading={loading}
            loadProgress={loadProgress}
            hasLoaded={hasLoaded}
            missingOptional={missingOptional}
            onRead={refresh}
            connected={connected}
            error={error}
          />

          {/* Enables */}
          <FcSection title={tr("compensation")}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {ol(SENSOR_TYPES).map((t) => (
                <Select
                  key={t.enable}
                  label={`${t.label} (${t.enable})`}
                  options={ENABLE_OPTIONS}
                  value={str(t.enable)}
                  onChange={(v) => setLocalValue(t.enable, Number(v))}
                />
              ))}
            </div>
          </FcSection>

          {/* Calibration trigger */}
          <FcSection title={tr("runCalibration")}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {ol(SENSOR_TYPES).map((t) => (
                <Select
                  key={t.trigger}
                  label={`${t.label} (${t.trigger})`}
                  options={ol(TRIGGER_OPTIONS)}
                  value={str(t.trigger)}
                  onChange={(v) => setLocalValue(t.trigger, Number(v))}
                />
              ))}
              {ol(LIMITS).map((l) => (
                <Input
                  key={l.name}
                  label={`${l.label} (${l.name})`}
                  type="number"
                  step="1"
                  unit={l.unit}
                  value={str(l.name)}
                  onChange={(e) => setLocalValue(l.name, Number(e.target.value) || 0)}
                />
              ))}
            </div>
            <div className="flex items-start gap-2 p-2 bg-accent-primary/5 border border-accent-primary/20">
              <Info size={12} className="text-accent-primary shrink-0 mt-0.5" />
              <p className="text-[10px] text-text-secondary">
                Set the sensors to calibrate to &ldquo;Calibrate at next
                power-up&rdquo;, save and write to flash, then power the board up
                cold (between the min and max start temperatures) and let it heat
                up undisturbed by at least the required rise. PX4 fits the
                compensation polynomials and clears the trigger when done; the
                ranges below show what each sensor was calibrated across.
              </p>
            </div>
          </FcSection>

          {/* Per-sensor calibration state */}
          {ol(SENSOR_TYPES).map((t) => {
            const rows = INSTANCES.filter((i) => has(`TC_${t.key}${i}_ID`) && num(`TC_${t.key}${i}_ID`) !== 0);
            if (rows.length === 0) return null;
            return (
              <FcSection key={t.key} title={t.label}>
                {rows.map((i) => (
                  <div key={i} className="space-y-2 border-t border-border-default first:border-t-0 pt-3 first:pt-0">
                    <div className="text-[11px] text-text-tertiary">
                      Instance {i} — sensor ID{" "}
                      <span className="font-mono text-text-secondary">{num(`TC_${t.key}${i}_ID`)}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <Input
                        label={tr("minTemp")}
                        type="number"
                        step="1"
                        unit="°C"
                        value={str(`TC_${t.key}${i}_TMIN`)}
                        onChange={(e) => setLocalValue(`TC_${t.key}${i}_TMIN`, Number(e.target.value) || 0)}
                      />
                      <Input
                        label={tr("refTemp")}
                        type="number"
                        step="1"
                        unit="°C"
                        value={str(`TC_${t.key}${i}_TREF`)}
                        onChange={(e) => setLocalValue(`TC_${t.key}${i}_TREF`, Number(e.target.value) || 0)}
                      />
                      <Input
                        label={tr("maxTemp")}
                        type="number"
                        step="1"
                        unit="°C"
                        value={str(`TC_${t.key}${i}_TMAX`)}
                        onChange={(e) => setLocalValue(`TC_${t.key}${i}_TMAX`, Number(e.target.value) || 0)}
                      />
                    </div>
                  </div>
                ))}
              </FcSection>
            );
          })}

          {/* Save */}
          <div className="flex items-center gap-3 pt-1 pb-4">
            <Button
              variant="primary"
              size="lg"
              icon={<Save size={14} />}
              disabled={!hasDirty || !connected}
              loading={saving}
              onClick={handleSave}
            >
              <SaveBarLabel k="saveToFc" />
            </Button>
            {hasRamWrites && (
              <Button variant="secondary" size="lg" icon={<HardDrive size={14} />} loading={flashing} onClick={handleFlash}>
                <SaveBarLabel k="writeToFlash" />
              </Button>
            )}
            {hasDirty && connected && (
              <span className="text-[10px] text-status-warning"><SaveBarLabel k="unsavedChanges" /></span>
            )}
          </div>
        </div>
      </div>
    </ArmedWarningBanner>
  );
}
