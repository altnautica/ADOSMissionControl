"use client";

import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import type { UnifiedFlightMode } from "@/lib/protocol/types";
import type { FirmwareHandler } from "@/lib/protocol/types/firmware";
import { PwmRangeBar } from "./PwmRangeBar";
import type { FlightModeGlobalConfig } from "./flight-mode-constants";

interface FlightModeChannelControlsProps {
  globalConfig: FlightModeGlobalConfig;
  channelOptions: { value: string; label: string }[];
  availableModes: { value: string; label: string }[];
  firmwareHandler: FirmwareHandler | null;
  currentPwm: number;
  activeSlot: number;
  onUpdate: (partial: Partial<FlightModeGlobalConfig>) => void;
}

export function FlightModeChannelControls({
  globalConfig,
  channelOptions,
  availableModes,
  firmwareHandler,
  currentPwm,
  activeSlot,
  onUpdate,
}: FlightModeChannelControlsProps) {
  // PX4 has no INITIAL_MODE parameter; its boot mode uses a separate boot-mode
  // enum (distinct from the mode-slot enum), so this control is not wired for
  // PX4 and the ArduPilot custom_mode option values do not apply there.
  const isPx4 = firmwareHandler?.firmwareType === "px4";

  const initialModeOptions = isPx4
    ? [{ value: globalConfig.initialMode, label: "Set on the flight controller" }]
    : [
        { value: "0", label: "0, use mode switch" },
        ...availableModes
          .map((m) => {
            if (firmwareHandler) {
              try {
                const { customMode } = firmwareHandler.encodeFlightMode(
                  m.value as UnifiedFlightMode,
                );
                return { value: String(customMode), label: `${customMode}, ${m.label}` };
              } catch {
                return null;
              }
            }
            return { value: m.value, label: m.label };
          })
          .filter((opt): opt is { value: string; label: string } => opt !== null && opt.value !== "0"),
      ];

  return (
    <Card title="Mode Switch Channel">
      <div className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Select
              label="RC channel for flight mode switch"
              value={globalConfig.modeChannel}
              onChange={(v) => onUpdate({ modeChannel: v })}
              options={channelOptions}
            />
            {isPx4 && (
              <p className="text-[10px] text-text-tertiary">
                Maps to RC_MAP_FLTMODE. The six mode slots apply only when a mode
                channel is assigned here.
              </p>
            )}
            {isPx4 && globalConfig.modeChannel === "0" && (
              <p className="text-[10px] text-status-warning">
                No mode channel assigned, so the six mode slots are inactive.
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Select
              label="Initial boot mode (INITIAL_MODE)"
              value={globalConfig.initialMode}
              onChange={(v) => onUpdate({ initialMode: v })}
              options={initialModeOptions}
              disabled={isPx4}
            />
            {isPx4 && (
              <p className="text-[10px] text-text-tertiary">
                PX4 sets its boot mode with a dedicated boot-mode parameter, not from this panel.
              </p>
            )}
          </div>
        </div>

        <PwmRangeBar currentPwm={currentPwm} activeSlot={activeSlot} />

        <div className="flex items-center gap-2">
          <span className="text-[10px] text-text-secondary">Current PWM:</span>
          <span className="text-xs font-mono text-accent-primary tabular-nums">
            {currentPwm > 0 ? currentPwm : "—"}
          </span>
          {activeSlot >= 0 && (
            <span className="text-[10px] text-status-success font-medium ml-1">
              Slot {activeSlot + 1} active
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}
