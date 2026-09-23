"use client";

/**
 * @module fc/frame/ArduPilotHeliPanel
 * @description ArduPilot traditional-helicopter configuration. Covers the
 * swashplate + collective geometry (H_SW_*, H_COL_*), rotor speed control
 * (H_RSC_*: mode, ramp/run-up, idle, throttle curve, governor), and
 * autorotation (AROT_*). Shown only for an ArduPilot vehicle that reports the
 * helicopter type; enum fields are driven by the FC-served parameter metadata
 * so option labels are firmware-exact (no hardcoded guesses).
 * @license GPL-3.0-only
 */

import type { ReactNode } from "react";
import { Fan, Save, HardDrive, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EnumSelect } from "../parameters/EnumSelect";
import { useDroneManager } from "@/stores/drone-manager";
import { usePanelParams } from "@/hooks/use-panel-params";
import { useParamMetadataMap } from "@/hooks/use-param-metadata";
import { useParamPanelActions } from "@/hooks/use-param-panel-actions";
import { usePanelScroll } from "@/hooks/use-panel-scroll";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { PanelHeader } from "../shared/PanelHeader";
import { ArmedWarningBanner } from "@/components/indicators/ArmedWarningBanner";
import type { ParamMetadata } from "@/lib/protocol/param-metadata";

const SWASH_PARAMS = [
  "H_SW_TYPE", "H_COL_MIN", "H_COL_MAX", "H_COL_MID",
  "H_COL_ANG_MIN", "H_COL_ANG_MAX", "H_CYC_MAX", "H_PHANG", "H_FLYBAR_MODE",
];
const RSC_PARAMS = [
  "H_RSC_MODE", "H_RSC_SETPOINT", "H_RSC_RAMP_TIME", "H_RSC_RUNUP_TIME",
  "H_RSC_CRITICAL", "H_RSC_IDLE", "H_RSC_SLEWRATE",
];
const THRCRV_PARAMS = ["H_RSC_THRCRV_0", "H_RSC_THRCRV_25", "H_RSC_THRCRV_50", "H_RSC_THRCRV_75", "H_RSC_THRCRV_100"];
const GOV_PARAMS = ["H_RSC_GOV_RPM", "H_RSC_GOV_DROOP", "H_RSC_GOV_RANGE", "H_RSC_GOV_COMP", "H_RSC_GOV_TORQUE"];
const AROT_PARAMS = ["AROT_ENABLE", "AROT_HS_SET", "AROT_RSC_IDLE", "AROT_TAIL_ALT", "AROT_ENTRY_ALT", "AROT_BAIL_TIME"];

const CORE_PARAMS = ["FRAME_CLASS", "H_SW_TYPE", "H_RSC_MODE"];
const OPTIONAL_PARAMS = [
  ...SWASH_PARAMS.filter((n) => n !== "H_SW_TYPE"),
  ...RSC_PARAMS.filter((n) => n !== "H_RSC_MODE"),
  ...THRCRV_PARAMS, ...GOV_PARAMS, ...AROT_PARAMS,
];

function MetaField({
  name, label, metadata, params, setLocalValue,
}: {
  name: string;
  label: string;
  metadata: Map<string, ParamMetadata>;
  params: Map<string, number>;
  setLocalValue: (name: string, value: number) => void;
}): ReactNode {
  if (!params.has(name)) return null;
  const meta = metadata.get(name);
  const value = params.get(name) ?? 0;
  return (
    <div>
      <label className="text-xs text-text-secondary mb-1 block">
        {label} <span className="font-mono text-text-tertiary">({name})</span>
      </label>
      {meta?.values && meta.values.size > 0 ? (
        <EnumSelect values={meta.values} value={value} onChange={(v) => setLocalValue(name, v)} />
      ) : (
        <Input
          type="number"
          step="any"
          unit={meta?.units}
          value={String(value)}
          onChange={(e) => setLocalValue(name, Number(e.target.value) || 0)}
        />
      )}
    </div>
  );
}

export function ArduPilotHeliPanel() {
  const getProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const scrollRef = usePanelScroll("ap-heli");
  const metadata = useParamMetadataMap();

  const panelParams = usePanelParams({
    paramNames: CORE_PARAMS,
    optionalParams: OPTIONAL_PARAMS,
    panelId: "ap-heli",
    autoLoad: true,
  });
  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded, missingOptional,
    refresh, setLocalValue,
  } = panelParams;
  const { saving, save: handleSave, flash: handleFlash } =
    useParamPanelActions(panelParams);
  useUnsavedGuard(dirtyParams.size > 0);

  const connected = !!getProtocol();
  const hasDirty = dirtyParams.size > 0;
  const field = (name: string, label: string) => (
    <MetaField key={name} name={name} label={label} metadata={metadata} params={params} setLocalValue={setLocalValue} />
  );

  const frameClass = params.get("FRAME_CLASS");
  const isHeliFrame = frameClass === 6 || frameClass === 13;

  const section = (title: string, names: [string, string][]) => {
    const present = names.filter(([n]) => params.has(n));
    if (present.length === 0) return null;
    return (
      <div className="border border-border-default bg-bg-secondary p-4 space-y-3">
        <h2 className="text-sm font-medium text-text-primary">{title}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {present.map(([n, l]) => field(n, l))}
        </div>
      </div>
    );
  };

  return (
    <ArmedWarningBanner>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl space-y-6">
          <PanelHeader
            title="Helicopter"
            subtitle="Swashplate, rotor speed control, and autorotation"
            icon={<Fan size={16} />}
            loading={loading}
            loadProgress={loadProgress}
            hasLoaded={hasLoaded}
            missingOptional={missingOptional}
            onRead={refresh}
            connected={connected}
            error={error}
          />

          {hasLoaded && !isHeliFrame && (
            <div className="flex items-start gap-2 p-2 bg-status-warning/5 border border-status-warning/20">
              <Info size={12} className="text-status-warning shrink-0 mt-0.5" />
              <p className="text-[10px] text-text-secondary">
                This vehicle&rsquo;s frame class is not a traditional helicopter
                (expected FRAME_CLASS 6 or 13). Heli settings below may not apply.
              </p>
            </div>
          )}

          {section("Swashplate & Collective", [
            ["H_SW_TYPE", "Swashplate Type"],
            ["H_COL_MIN", "Collective Min"],
            ["H_COL_MAX", "Collective Max"],
            ["H_COL_MID", "Collective Mid"],
            ["H_COL_ANG_MIN", "Collective Angle Min"],
            ["H_COL_ANG_MAX", "Collective Angle Max"],
            ["H_CYC_MAX", "Cyclic Max"],
            ["H_PHANG", "Phase Angle"],
            ["H_FLYBAR_MODE", "Flybar Mode"],
          ])}

          {section("Rotor Speed Control", [
            ["H_RSC_MODE", "RSC Mode"],
            ["H_RSC_SETPOINT", "Setpoint"],
            ["H_RSC_RAMP_TIME", "Ramp Time"],
            ["H_RSC_RUNUP_TIME", "Run-up Time"],
            ["H_RSC_CRITICAL", "Critical Speed"],
            ["H_RSC_IDLE", "Idle Output"],
            ["H_RSC_SLEWRATE", "Slew Rate"],
          ])}

          {section("Throttle Curve", [
            ["H_RSC_THRCRV_0", "0%"],
            ["H_RSC_THRCRV_25", "25%"],
            ["H_RSC_THRCRV_50", "50%"],
            ["H_RSC_THRCRV_75", "75%"],
            ["H_RSC_THRCRV_100", "100%"],
          ])}

          {section("Governor", [
            ["H_RSC_GOV_RPM", "Target RPM"],
            ["H_RSC_GOV_DROOP", "Droop"],
            ["H_RSC_GOV_RANGE", "Range"],
            ["H_RSC_GOV_COMP", "Compensation"],
            ["H_RSC_GOV_TORQUE", "Torque"],
          ])}

          {section("Autorotation", [
            ["AROT_ENABLE", "Enable"],
            ["AROT_HS_SET", "Target Head Speed"],
            ["AROT_RSC_IDLE", "RSC Idle"],
            ["AROT_TAIL_ALT", "Tail Altitude"],
            ["AROT_ENTRY_ALT", "Entry Altitude"],
            ["AROT_BAIL_TIME", "Bail-out Time"],
          ])}

          <div className="flex items-center gap-3 pt-1 pb-4">
            <Button
              variant="primary"
              size="lg"
              icon={<Save size={14} />}
              disabled={!hasDirty || !connected}
              loading={saving}
              onClick={handleSave}
            >
              Save to Flight Controller
            </Button>
            {hasRamWrites && (
              <Button variant="secondary" size="lg" icon={<HardDrive size={14} />} onClick={handleFlash}>
                Write to Flash
              </Button>
            )}
            {hasDirty && connected && (
              <span className="text-[10px] text-status-warning">Unsaved changes</span>
            )}
          </div>
        </div>
      </div>
    </ArmedWarningBanner>
  );
}
