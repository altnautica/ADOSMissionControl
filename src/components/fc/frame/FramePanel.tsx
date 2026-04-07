"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { usePanelParams } from "@/hooks/use-panel-params";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { useFirmwareCapabilities } from "@/hooks/use-firmware-capabilities";
import { useDroneManager } from "@/stores/drone-manager";
import { ArmedLockOverlay } from "@/components/indicators/ArmedLockOverlay";
import { PanelHeader } from "../shared/PanelHeader";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  getMotorLayout, getUniqueTypesForClass, formatMotorCount,
  FRAME_CLASS_NAMES, FRAME_CLASS_DESCRIPTIONS, FRAME_CLASS_NOTES, FRAME_TYPE_DESCRIPTIONS,
} from "@/lib/motor-layouts";
import { Select } from "@/components/ui/select";
import { Save, HardDrive, Box, Zap, Info } from "lucide-react";
import { FrameConfigLog, FrameCard, type ConfigLogEntry } from "./FrameConfigLog";

const MotorDiagram3D = dynamic(
  () => import("../motors/MotorDiagram3D").then((m) => ({ default: m.MotorDiagram3D })),
  { ssr: false, loading: () => <div className="h-[360px] flex items-center justify-center text-xs text-text-tertiary bg-bg-tertiary animate-pulse">Loading 3D view...</div> },
);

const COPTER_FRAME_PARAMS = ["FRAME_CLASS", "FRAME_TYPE"];
const PLANE_FRAME_PARAMS = ["Q_FRAME_CLASS", "Q_FRAME_TYPE"];

const FRAME_CLASS_OPTIONS = Object.entries(FRAME_CLASS_NAMES).map(([value, label]) => ({
  value: String(Number(value)),
  label: `${Number(value)} — ${label}`,
  description: FRAME_CLASS_DESCRIPTIONS[Number(value)],
}));

export function FramePanel() {
  const { toast } = useToast();
  // Frame class/type are hard-blocked in flight (structural change).
  // Save button is soft — goes through usePanelParams confirm dialog.
  const { isHardBlocked } = useArmedLock();
  const { firmwareType } = useFirmwareCapabilities();
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const connected = !!getSelectedProtocol();

  const isPlane = firmwareType === "ardupilot-plane";
  const isCopter = firmwareType === "ardupilot-copter";
  const isRover = firmwareType === "ardupilot-rover";
  const isSub = firmwareType === "ardupilot-sub";
  const paramNames = useMemo(() => isPlane ? PLANE_FRAME_PARAMS : COPTER_FRAME_PARAMS, [isPlane]);
  const optionalParams = useMemo(() => {
    if (isPlane || (!isCopter && !isRover && !isSub)) return paramNames;
    return [];
  }, [isPlane, isCopter, isRover, isSub, paramNames]);

  const [logEntries, setLogEntries] = useState<ConfigLogEntry[]>([]);
  const logIdRef = useRef(0);

  const addLogEntry = useCallback((event: { type: string; message: string }) => {
    setLogEntries((prev) => [...prev, { id: ++logIdRef.current, timestamp: Date.now(), type: event.type as ConfigLogEntry["type"], message: event.message }]);
  }, []);

  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded, missingOptional,
    refresh, setLocalValue, saveAllToRam, commitToFlash,
  } = usePanelParams({ paramNames, optionalParams, panelId: "frame", onEvent: addLogEntry });
  useUnsavedGuard(dirtyParams.size > 0);

  const [saving, setSaving] = useState(false);
  const [committing, setCommitting] = useState(false);

  const isFixedWingOnly = isPlane && hasLoaded && paramNames.every((p) => missingOptional.has(p));

  const classParam = isPlane ? "Q_FRAME_CLASS" : "FRAME_CLASS";
  const typeParam = isPlane ? "Q_FRAME_TYPE" : "FRAME_TYPE";
  const frameClass = params.get(classParam) ?? 1;
  const frameType = params.get(typeParam) ?? 1;
  const hasDirty = dirtyParams.size > 0;

  const uniqueTypes = useMemo(() => getUniqueTypesForClass(frameClass), [frameClass]);
  const frameTypeOptions = useMemo(() => {
    if (uniqueTypes.length === 0) return [{ value: "0", label: "0 — Default" }];
    return uniqueTypes.map((ut) => {
      const dupCount = ut.duplicateTypes.length;
      const desc = ut.description ?? (dupCount > 1 ? `Covers types ${ut.duplicateTypes.join(", ")}` : undefined);
      return { value: String(ut.value), label: `${ut.value} — ${ut.name}`, description: desc };
    });
  }, [uniqueTypes]);

  const effectiveFrameType = useMemo(() => {
    for (const ut of uniqueTypes) { if (ut.duplicateTypes.includes(frameType)) return ut.value; }
    return uniqueTypes[0]?.value ?? 0;
  }, [uniqueTypes, frameType]);

  useEffect(() => {
    if (uniqueTypes.length > 0) {
      const isValid = uniqueTypes.some((ut) => ut.duplicateTypes.includes(frameType));
      if (!isValid) setLocalValue(typeParam, uniqueTypes[0].value);
    }
  }, [frameClass, frameType, uniqueTypes, setLocalValue, typeParam]);

  const layout = useMemo(() => getMotorLayout(frameClass, frameType), [frameClass, frameType]);
  const className = FRAME_CLASS_NAMES[frameClass] ?? "Unknown";
  const typeName = layout?.typeName ?? "Unknown";
  const motorCountStr = layout ? formatMotorCount(layout) : "—";
  const classNote = FRAME_CLASS_NOTES[frameClass];
  const classDescription = FRAME_CLASS_DESCRIPTIONS[frameClass];
  const activeTypeEntry = uniqueTypes.find((ut) => ut.value === effectiveFrameType);
  const typeDescription = activeTypeEntry?.description ?? FRAME_TYPE_DESCRIPTIONS[frameType];

  const handleLocalChange = useCallback((name: string, value: number) => {
    setLocalValue(name, value);
    if (name === classParam) {
      const clsName = FRAME_CLASS_NAMES[value] ?? "Unknown";
      addLogEntry({ type: "info", message: `Set ${name} = ${value} (${clsName})` });
    } else {
      addLogEntry({ type: "info", message: `Set ${name} = ${value} (local)` });
    }
  }, [setLocalValue, addLogEntry, classParam]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    const ok = await saveAllToRam();
    setSaving(false);
    if (ok) toast("Frame parameters saved to RAM", "success");
    else toast("Failed to save frame parameters", "error");
  }, [saveAllToRam, toast]);

  const handleFlash = useCallback(async () => {
    setCommitting(true);
    const ok = await commitToFlash();
    setCommitting(false);
    if (ok) toast("Written to flash — persists after reboot", "success");
    else toast("Failed to write to flash", "error");
  }, [commitToFlash, toast]);

  return (
    <ArmedLockOverlay>
      <div className="flex-1 overflow-hidden flex">
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-2xl space-y-6">
            <PanelHeader title="Frame Configuration" subtitle="Vehicle frame class, type, and motor layout" icon={<Box size={16} />} loading={loading} loadProgress={loadProgress} hasLoaded={hasLoaded} onRead={refresh} connected={connected} error={error} />

            {isFixedWingOnly && (
              <FrameCard icon={<Box size={14} />} title="Frame Configuration" description="Not applicable for this vehicle type">
                <div className="py-6 text-center space-y-2">
                  <p className="text-xs text-text-secondary">Frame configuration is not applicable for fixed-wing aircraft.</p>
                  <p className="text-[10px] text-text-tertiary">QuadPlane frame settings (Q_FRAME_CLASS) are available when your plane has VTOL motors configured.</p>
                </div>
              </FrameCard>
            )}

            {!isFixedWingOnly && (
              <FrameCard icon={<Box size={14} />} title="Frame Selection" description="Select airframe class and configuration type">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Select label={classParam} options={FRAME_CLASS_OPTIONS} value={String(frameClass)} onChange={(v) => handleLocalChange(classParam, Number(v))} disabled={isHardBlocked} searchable />
                  <Select label={typeParam} options={frameTypeOptions} value={String(effectiveFrameType)} onChange={(v) => handleLocalChange(typeParam, Number(v))} disabled={isHardBlocked} />
                </div>
                {typeDescription && <p className="text-[10px] text-text-tertiary mt-2">{typeDescription}</p>}
                {classNote && (
                  <div className="flex items-start gap-2 mt-3 px-2.5 py-2 border border-accent-primary/20 bg-accent-primary/5">
                    <Info size={12} className="text-accent-primary shrink-0 mt-0.5" />
                    <p className="text-[10px] text-text-secondary leading-relaxed">{classNote}</p>
                  </div>
                )}
              </FrameCard>
            )}

            {!isFixedWingOnly && (
              <FrameCard icon={<Zap size={14} />} title="Motor Layout" description={`${className} ${typeName} — ${motorCountStr}`}>
                {loading && !layout ? (
                  <div className="h-[360px] flex items-center justify-center text-xs text-text-tertiary bg-bg-tertiary animate-pulse">Loading parameters...</div>
                ) : layout ? (
                  <MotorDiagram3D layout={layout} />
                ) : (
                  <div className="py-8 text-center space-y-2">
                    <p className="text-xs text-text-secondary">{frameClass === 0 ? "Select a frame class to see the motor layout." : `No motor layout diagram for ${className}.`}</p>
                    {classDescription && frameClass !== 0 && <p className="text-[10px] text-text-tertiary">{classDescription}. {classParam} will still be sent to the flight controller.</p>}
                  </div>
                )}
              </FrameCard>
            )}

            {!isFixedWingOnly && (
              <div className="flex items-center gap-4 text-xs text-text-secondary">
                <div><span className="text-text-tertiary">Motors: </span><span className="font-mono text-text-primary">{layout ? motorCountStr : "—"}</span></div>
                <div><span className="text-text-tertiary">Class: </span><span className="font-mono text-text-primary">{className}</span></div>
                <div><span className="text-text-tertiary">Type: </span><span className="font-mono text-text-primary">{typeName}</span></div>
              </div>
            )}

            {!isFixedWingOnly && (
              <div className="flex items-center gap-3 pt-2 pb-4">
                <Button variant="primary" size="lg" icon={<Save size={14} />} disabled={!hasDirty} loading={saving} onClick={handleSave}>Save to RAM</Button>
                {hasRamWrites && <Button variant="secondary" size="lg" icon={<HardDrive size={14} />} loading={committing} onClick={handleFlash}>Write to Flash</Button>}
                {hasDirty && <span className="text-[10px] text-status-warning">Unsaved changes</span>}
              </div>
            )}
          </div>
        </div>

        <FrameConfigLog logEntries={logEntries} onClear={() => setLogEntries([])} />
      </div>
    </ArmedLockOverlay>
  );
}
