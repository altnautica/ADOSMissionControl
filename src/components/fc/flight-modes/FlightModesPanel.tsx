"use client";

import { useMemo, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";
import { useFreshTelemetry } from "@/hooks/use-telemetry-latest";
import { Info } from "lucide-react";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { useAvailableModes } from "@/hooks/use-available-modes";
import { ModeSlotRow } from "./ModeSlotRow";
import { FlightModesHeader } from "./FlightModesHeader";
import { FlightModeChannelControls } from "./FlightModeChannelControls";
import { useFlightModeParams } from "./use-flight-mode-params";
import { MODE_PWM_RANGES } from "./flight-mode-constants";

export function FlightModesPanel() {
  const protocol = useDroneManager(selectSelectedProtocol);
  const selectedDroneId = useDroneManager((s) => s.selectedDroneId);
  const { toast } = useToast();
  const { isArmed, lockMessage } = useArmedLock();
  const firmwareHandler = protocol?.getFirmwareHandler() ?? null;
  const isCopter = firmwareHandler?.vehicleClass === "copter";

  // The live mode-switch PWM; 0 (no active slot) once RC stops arriving.
  const latestRc = useFreshTelemetry("rc");
  const heartbeatMode = useDroneStore((s) => s.flightMode);

  const {
    slots,
    dirtySlots,
    globalConfig,
    loading,
    saving,
    showCommitButton,
    totalDirtyCount,
    isDirty,
    fetchParams,
    saveParams,
    commitToFlash,
    updateSlot,
    resetSlot,
    updateGlobal,
  } = useFlightModeParams({ protocol, firmwareHandler, isCopter, toast });

  // The firmware's own mode table, the one the set-mode gate accepts; nothing
  // is offered until the flight controller has identified its firmware.
  const liveModes = useAvailableModes(selectedDroneId);
  const availableModes = useMemo(
    () => (liveModes ?? []).map((m) => ({ value: m, label: m })),
    [liveModes],
  );

  const channelOptions = useMemo(
    () => Array.from({ length: 16 }, (_, i) => ({
      value: String(i + 1),
      label: `Channel ${i + 1}`,
    })),
    [],
  );

  const modeChIdx = Number(globalConfig.modeChannel) - 1;
  const currentPwm = latestRc?.channels[modeChIdx] ?? 0;

  const activeSlot = useMemo(() => {
    if (currentPwm === 0) return -1;
    for (let i = 0; i < MODE_PWM_RANGES.length; i++) {
      const range = MODE_PWM_RANGES[i];
      if (currentPwm >= range.min && currentPwm <= range.max) return i;
    }
    return -1;
  }, [currentPwm]);

  const duplicateModes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of slots) {
      counts.set(s.mode, (counts.get(s.mode) ?? 0) + 1);
    }
    const dups = new Set<string>();
    for (const [mode, count] of counts) {
      if (count > 1) dups.add(mode);
    }
    return dups;
  }, [slots]);

  const hasDuplicates = duplicateModes.size > 0;

  useUnsavedGuard(isDirty);

  // Read on connect and again on a drone switch.
  useEffect(() => {
    void fetchParams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [protocol]);

  if (!protocol) {
    return (
      <div className="flex-1 p-6">
        <div className="max-w-2xl space-y-4">
          <h2 className="text-sm font-semibold text-text-primary">Flight Modes</h2>
          <Card>
            <p className="text-xs text-text-tertiary">Connect to a drone to configure flight modes.</p>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-4">
        <FlightModesHeader
          isDirty={isDirty}
          totalDirtyCount={totalDirtyCount}
          dirtySlotCount={dirtySlots.size}
          loading={loading}
          saving={saving}
          showCommitButton={showCommitButton}
          onRead={fetchParams}
          onSave={saveParams}
          onCommit={commitToFlash}
        />

        <div className="bg-bg-secondary border border-border-default p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-text-tertiary uppercase tracking-wider">Current Mode:</span>
              <span className="text-sm font-mono font-bold text-accent-primary">
                {heartbeatMode}
              </span>
            </div>
            <div className="flex items-center gap-2 text-[10px] font-mono text-text-secondary">
              {activeSlot >= 0 && (
                <span className="text-status-success font-medium">
                  Slot {activeSlot + 1}
                </span>
              )}
              {currentPwm > 0 && (
                <span className="text-text-tertiary">
                  CH{globalConfig.modeChannel} PWM {currentPwm}
                </span>
              )}
            </div>
          </div>
        </div>

        <FlightModeChannelControls
          globalConfig={globalConfig}
          channelOptions={channelOptions}
          availableModes={availableModes}
          firmwareHandler={firmwareHandler}
          currentPwm={currentPwm}
          activeSlot={activeSlot}
          onUpdate={updateGlobal}
        />

        {hasDuplicates && (
          <div className="flex items-center gap-2 p-2 bg-accent-primary/5 border border-accent-primary/20">
            <Info size={14} className="text-accent-primary shrink-0" />
            <span className="text-[10px] text-accent-primary">
              Same mode in multiple slots: {[...duplicateModes].join(", ")}. This is valid but unusual.
            </span>
          </div>
        )}

        {isArmed && (
          <div className="flex items-center gap-2 p-2 bg-status-warning/10 border border-status-warning/50">
            <span className="text-[10px] text-status-warning">{lockMessage}</span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-2">
          {slots.map((slot, i) => (
            <ModeSlotRow
              key={i}
              index={i}
              slot={slot}
              isActive={activeSlot === i}
              isDirty={dirtySlots.has(i)}
              isCopter={isCopter}
              availableModes={availableModes}
              range={MODE_PWM_RANGES[i]}
              onUpdate={updateSlot}
              onReset={resetSlot}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
