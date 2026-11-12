/**
 * @module Px4ControlAllocationPanel
 * @description PX4 control-allocation (CA_*) setup: airframe + allocation
 * method, reversible-motor mask, per-rotor thrust/moment/direction/tilt
 * coefficients, control surfaces, and tilt servos. Enum labels and ranges come
 * from the bundled PX4 param metadata.
 * @license GPL-3.0-only
 */

"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Sliders } from "lucide-react";

import { Button } from "@/components/ui/button";
import { usePanelCommit } from "@/hooks/use-panel-commit";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { usePanelParams } from "@/hooks/use-panel-params";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { useParamLabel } from "@/hooks/use-param-label";
import { useParamMetadataMap } from "@/hooks/use-param-metadata";
import { usePanelScroll } from "@/hooks/use-panel-scroll";
import { cn } from "@/lib/utils";
import { PanelHeader } from "../shared/PanelHeader";
import { ArmedWarningBanner } from "@/components/indicators/ArmedWarningBanner";
import { EnumSelect } from "../parameters/EnumSelect";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { isFrameGeometryParam } from "../shared/frame-geometry-params";
import { ParamFieldLabel } from "../parameters/ParamFieldLabel";
import { BitmaskEditor } from "@/components/ui/bitmask-editor";
import {
  type CaField,
  CA_ALL_PARAM_NAMES,
  CA_MAX_ROTORS,
  CA_MAX_SURFACES,
  CA_MAX_TILTS,
  CA_R_REV_BITS,
  caRotorFields,
  caSurfaceFields,
  caTiltFields,
} from "./px4-control-allocation-constants";
import { FcSection } from "@/components/fc/shared/FcSection";

import { PanelSaveBar } from "@/components/fc/shared/PanelSaveBar";

export function Px4ControlAllocationPanel() {
  const tr = useTranslations("fcPanels.px4ControlAllocationPanel");
  const selectedProtocol = useDroneManager(selectSelectedProtocol);
  const { paramName: pn } = useParamLabel();
  const paramMeta = useParamMetadataMap();
  const scrollRef = usePanelScroll("px4-control-allocation");
  const [revEditor, setRevEditor] = useState(false);

  const paramNames = useMemo(() => CA_ALL_PARAM_NAMES, []);
  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded, refresh, setLocalValue, saveAllToRam, commitToFlash, revertAll,
  } = usePanelParams({ paramNames, optionalParams: paramNames, panelId: "px4-control-allocation", autoLoad: true });
  useUnsavedGuard(dirtyParams.size > 0);

  const connected = !!selectedProtocol;
  const hasDirty = dirtyParams.size > 0;

  const rotorCount = Math.min(CA_MAX_ROTORS, Math.max(0, Math.trunc(params.get("CA_ROTOR_COUNT") ?? 0)));
  const surfaceCount = Math.min(CA_MAX_SURFACES, Math.max(0, Math.trunc(params.get("CA_SV_CS_COUNT") ?? 0)));
  const tiltCount = Math.min(CA_MAX_TILTS, Math.max(0, Math.trunc(params.get("CA_SV_TL_COUNT") ?? 0)));
  const revValue = Math.trunc(params.get("CA_R_REV") ?? 0);

  const { saving, save: handleSave, flashing, flash: handleFlash, revert: handleRevert } = usePanelCommit({ saveAllToRam, commitToFlash, revertAll });

  const { isHardBlocked, hardBlockMessage } = useArmedLock();

  // Staged geometry edits stay unsaved while the vehicle may be armed.

  const geometryBlocked = isHardBlocked && [...dirtyParams].some(isFrameGeometryParam);
  const tShared = useTranslations("fcShared");
  const renderField = (f: CaField) => {
    const read = params.get(f.param);
    const value = read ?? 0;
    const locked = isHardBlocked && isFrameGeometryParam(f.param);
    const isDirty = dirtyParams.has(f.param);
    const meta = paramMeta.get(f.param);
    return (
      <div key={f.param} className="grid grid-cols-[180px_1fr] items-center gap-3">
        <ParamFieldLabel label={f.label} param={pn(f.param)} meta={meta} />
        {read === undefined && hasLoaded ? (
          <span className="text-xs font-mono text-text-tertiary">{tShared("notPresent")}</span>
        ) : f.kind === "enum" && meta?.values && meta.values.size > 0 ? (
          <EnumSelect values={meta.values} value={value} onChange={(v) => setLocalValue(f.param, v)} disabled={locked} />
        ) : (
          <input disabled={locked} title={locked ? hardBlockMessage : undefined}
            type="number" min={meta?.range?.min} max={meta?.range?.max} step="any" value={value}
            onChange={(e) => setLocalValue(f.param, parseFloat(e.target.value) || 0)}
            className={cn(
              "w-full h-7 px-1.5 bg-bg-tertiary border text-xs font-mono text-text-primary text-right focus:outline-none focus:border-accent-primary transition-colors",
              isDirty ? "border-status-warning" : "border-border-default",
            )}
          />
        )}
      </div>
    );
  };

  const indexedCards = (count: number, fields: (i: number) => CaField[], label: (n: number) => string) =>
    Array.from({ length: count }, (_, i) => (
      <div key={i} className="border border-border-default bg-bg-tertiary/30 p-3">
        <div className="text-[11px] font-mono text-text-tertiary mb-2">{label(i + 1)}</div>
        <div className="space-y-2">{fields(i).map(renderField)}</div>
      </div>
    ));

  return (
    <ArmedWarningBanner>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl space-y-6">
          <PanelHeader
            title={tr("controlAllocation")}
            subtitle={tr("px4AirframeAllocationMethodRotor")}
            icon={<Sliders size={16} />} loading={loading} loadProgress={loadProgress} hasLoaded={hasLoaded}
            onRead={refresh} connected={connected} error={error}
          />

          <FcSection title={tr("airframe")}>
            {renderField({ param: "CA_AIRFRAME", label: tr("airframe"), kind: "enum" })}
            {renderField({ param: "CA_METHOD", label: tr("allocationMethod"), kind: "enum" })}
            <div className="grid grid-cols-[180px_1fr] items-center gap-3">
              <div>
                <span className="text-xs text-text-secondary">{tr("reversibleMotors")}</span>
                <span className="text-[9px] text-text-tertiary block font-mono">{pn("CA_R_REV")}</span>
              </div>
              <Button variant="secondary" size="sm" disabled={isHardBlocked} onClick={() => setRevEditor(true)}>
                {revValue === 0 ? tr("reversibleNone") : tr("reversibleBits", { value: revValue })}
              </Button>
            </div>
          </FcSection>

          <FcSection title={tr("rotors")}>
            {renderField({ param: "CA_ROTOR_COUNT", label: tr("rotorCount"), kind: "enum" })}
            {rotorCount > 0
              ? indexedCards(rotorCount, caRotorFields, (n) => tr("rotorN", { n }))
              : hasLoaded && <p className="text-[10px] text-text-tertiary">{tr("setARotorCountTo")}</p>}
          </FcSection>

          <FcSection title={tr("controlSurfaces")}>
            {renderField({ param: "CA_SV_CS_COUNT", label: tr("surfaceCount"), kind: "enum" })}
            {surfaceCount > 0 && indexedCards(surfaceCount, caSurfaceFields, (n) => tr("surfaceN", { n }))}
          </FcSection>

          <FcSection title={tr("tiltServos")}>
            {renderField({ param: "CA_SV_TL_COUNT", label: tr("tiltServoCount"), kind: "enum" })}
            {tiltCount > 0 && indexedCards(tiltCount, caTiltFields, (n) => tr("tiltN", { n }))}
          </FcSection>

          <PanelSaveBar
            onSave={handleSave}
            saving={saving}
            saveDisabled={!hasDirty || !connected || geometryBlocked}
            saveTitle={geometryBlocked ? hardBlockMessage : undefined}
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

      <BitmaskEditor
        open={revEditor}
        onClose={() => setRevEditor(false)}
        title={tr("reversibleMotorsCARREV")}
        bitmask={CA_R_REV_BITS}
        value={revValue}
        onApply={(v) => setLocalValue("CA_R_REV", v)}
      />
    </ArmedWarningBanner>
  );
}
