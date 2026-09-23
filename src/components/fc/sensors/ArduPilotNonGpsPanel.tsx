"use client";

/**
 * @module fc/sensors/ArduPilotNonGpsPanel
 * @description ArduPilot non-GPS positioning panel. Configures the EKF3 source
 * sets (EK3_SRC1/2/3 for position/velocity/yaw) that let the vehicle navigate
 * on optical flow, a beacon system, external nav (VISO_*), or wheel encoders
 * instead of GPS, plus the External Nav (VISO_*) and Beacon (BCN_*) backends.
 * Source selectors are driven by the FC-served parameter metadata enums, so the
 * exact per-field option set for this firmware is shown (no hardcoded guesses).
 * @license GPL-3.0-only
 */

import type { ReactNode } from "react";
import { Compass, Save, HardDrive, Info } from "lucide-react";
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

const SRC_SETS = [1, 2, 3] as const;
const SRC_FIELDS = [
  { field: "POSXY", label: "Position XY" },
  { field: "VELXY", label: "Velocity XY" },
  { field: "POSZ", label: "Position Z" },
  { field: "VELZ", label: "Velocity Z" },
  { field: "YAW", label: "Yaw" },
] as const;

const SRC_PARAMS = SRC_SETS.flatMap((n) => SRC_FIELDS.map((f) => `EK3_SRC${n}_${f.field}`));
const VISO_PARAMS = [
  "VISO_TYPE", "VISO_DELAY_MS", "VISO_POS_M_NSE", "VISO_YAW_M_NSE",
  "VISO_ORIENT", "VISO_SCALE",
];
const BCN_PARAMS = ["BCN_TYPE", "BCN_LATITUDE", "BCN_LONGITUDE", "BCN_ALT", "BCN_ORIENT_YAW"];

const CORE_PARAMS = [...SRC_FIELDS.map((f) => `EK3_SRC1_${f.field}`), "EK3_SRC_OPTIONS"];
const OPTIONAL_PARAMS = [
  ...SRC_SETS.filter((n) => n !== 1).flatMap((n) => SRC_FIELDS.map((f) => `EK3_SRC${n}_${f.field}`)),
  ...VISO_PARAMS,
  ...BCN_PARAMS,
];

/** A parameter field that renders an enum picker when the FC metadata supplies
 * value labels, and a numeric input otherwise. */
function MetaField({
  name,
  label,
  metadata,
  params,
  setLocalValue,
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

export function ArduPilotNonGpsPanel() {
  const getProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const scrollRef = usePanelScroll("ap-nongps");
  const metadata = useParamMetadataMap();

  const panelParams = usePanelParams({
    paramNames: CORE_PARAMS,
    optionalParams: OPTIONAL_PARAMS,
    panelId: "ap-nongps",
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
    <MetaField
      key={name}
      name={name}
      label={label}
      metadata={metadata}
      params={params}
      setLocalValue={setLocalValue}
    />
  );

  const hasViso = VISO_PARAMS.some((n) => params.has(n));
  const hasBcn = BCN_PARAMS.some((n) => params.has(n));

  return (
    <ArmedWarningBanner>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl space-y-6">
          <PanelHeader
            title="Non-GPS Positioning"
            subtitle="EKF3 source sets and external nav / beacon backends"
            icon={<Compass size={16} />}
            loading={loading}
            loadProgress={loadProgress}
            hasLoaded={hasLoaded}
            missingOptional={missingOptional}
            onRead={refresh}
            connected={connected}
            error={error}
          />

          <div className="flex items-start gap-2 p-2 bg-accent-primary/5 border border-accent-primary/20">
            <Info size={12} className="text-accent-primary shrink-0 mt-0.5" />
            <p className="text-[10px] text-text-secondary">
              Source set 1 is the default; sets 2 and 3 are alternates that can be
              switched to in flight (e.g. GPS → optical flow indoors). Optical flow
              wiring lives in the Sensors panel.
            </p>
          </div>

          {/* Source sets */}
          {SRC_SETS.map((n) => {
            const present = SRC_FIELDS.some((f) => params.has(`EK3_SRC${n}_${f.field}`));
            if (!present) return null;
            return (
              <div key={n} className="border border-border-default bg-bg-secondary p-4 space-y-3">
                <h2 className="text-sm font-medium text-text-primary">Source Set {n}</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {SRC_FIELDS.map((f) => field(`EK3_SRC${n}_${f.field}`, f.label))}
                </div>
              </div>
            );
          })}

          {params.has("EK3_SRC_OPTIONS") && (
            <div className="border border-border-default bg-bg-secondary p-4">
              {field("EK3_SRC_OPTIONS", "Source Options")}
            </div>
          )}

          {/* External nav */}
          {hasViso && (
            <div className="border border-border-default bg-bg-secondary p-4 space-y-3">
              <h2 className="text-sm font-medium text-text-primary">External Navigation (VISO)</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {field("VISO_TYPE", "Type")}
                {field("VISO_DELAY_MS", "Delay")}
                {field("VISO_POS_M_NSE", "Position Noise")}
                {field("VISO_YAW_M_NSE", "Yaw Noise")}
                {field("VISO_ORIENT", "Orientation")}
                {field("VISO_SCALE", "Scale")}
              </div>
            </div>
          )}

          {/* Beacon */}
          {hasBcn && (
            <div className="border border-border-default bg-bg-secondary p-4 space-y-3">
              <h2 className="text-sm font-medium text-text-primary">Beacon (BCN)</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {field("BCN_TYPE", "Type")}
                {field("BCN_LATITUDE", "Origin Latitude")}
                {field("BCN_LONGITUDE", "Origin Longitude")}
                {field("BCN_ALT", "Origin Altitude")}
                {field("BCN_ORIENT_YAW", "Orientation Yaw")}
              </div>
            </div>
          )}

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
