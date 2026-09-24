"use client";

import { useState, useCallback, useRef } from "react";
import type { DroneProtocol, UnifiedFlightMode } from "@/lib/protocol/types";
import type { FirmwareHandler } from "@/lib/protocol/types/firmware";
import { px4ModeToSlot, px4SlotToMode } from "@/lib/protocol/firmware/px4-flight-mode-slots";
import { bitmaskToSet, setToBitmask } from "@/lib/rc-options";
import {
  MODE_SLOT_COUNT,
  defaultSlot,
  defaultGlobalConfig,
} from "./flight-mode-constants";
import type { ModeSlotConfig, FlightModeGlobalConfig } from "./flight-mode-constants";

type ToastFn = (msg: string, kind?: "success" | "warning" | "error" | "info") => void;

/**
 * Decode a value read from a mode-slot parameter (FLTMODEn / COM_FLTMODEx) into
 * a unified flight mode. PX4 stores a small mode-slot enum in these parameters,
 * so it needs its own decoder rather than the packed-custom_mode decoder used
 * by ArduPilot. Falls back to the firmware default when the value is unassigned
 * or unrecognized.
 */
function decodeSlotMode(handler: FirmwareHandler | null, value: number): string {
  if (!handler) return "STABILIZE";
  if (handler.firmwareType === "px4") {
    return px4SlotToMode(value) ?? handler.getDefaultMode();
  }
  return handler.decodeFlightMode(value);
}

/**
 * The mode-switch parameter names for a vehicle. ArduRover names its switch
 * channel MODE_CH and its slots MODE1..MODE6; every other ArduPilot vehicle
 * uses FLTMODE_CH / FLTMODE1..6, which the PX4 handler maps to RC_MAP_FLTMODE /
 * COM_FLTMODE1..6.
 */
function modeParamNames(handler: FirmwareHandler | null): {
  channel: string;
  slotPrefix: string;
} {
  if (handler?.firmwareType !== "px4" && handler?.vehicleClass === "rover") {
    return { channel: "MODE_CH", slotPrefix: "MODE" };
  }
  return { channel: "FLTMODE_CH", slotPrefix: "FLTMODE" };
}

interface UseFlightModeParamsArgs {
  protocol: DroneProtocol | null;
  firmwareHandler: FirmwareHandler | null;
  isCopter: boolean;
  toast: ToastFn;
}

export function useFlightModeParams({
  protocol,
  firmwareHandler,
  isCopter,
  toast,
}: UseFlightModeParamsArgs) {
  // PX4 stores flight-mode assignments in COM_FLTMODE1..6 (a small mode-slot
  // enum) and has no INITIAL_MODE, SIMPLE, or SUPER_SIMPLE parameters. Reading
  // or writing those ArduPilot-only names on PX4 times out, so they are gated
  // off for PX4 throughout this hook.
  const isPx4 = firmwareHandler?.firmwareType === "px4";
  const { channel: channelParam, slotPrefix } = modeParamNames(firmwareHandler);

  const [slots, setSlots] = useState<ModeSlotConfig[]>(
    () => Array.from({ length: MODE_SLOT_COUNT }, defaultSlot),
  );
  const baselineRef = useRef<ModeSlotConfig[]>(
    Array.from({ length: MODE_SLOT_COUNT }, defaultSlot),
  );
  const [dirtySlots, setDirtySlots] = useState<Set<number>>(new Set());

  const [globalConfig, setGlobalConfig] = useState<FlightModeGlobalConfig>(defaultGlobalConfig);
  const globalBaselineRef = useRef<FlightModeGlobalConfig>(defaultGlobalConfig());
  const [globalDirty, setGlobalDirty] = useState(false);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showCommitButton, setShowCommitButton] = useState(false);

  const fetchParams = useCallback(async () => {
    if (!protocol) return;
    setLoading(true);
    try {
      const chParam = await protocol.getParameter(channelParam);

      const g: FlightModeGlobalConfig = {
        modeChannel: String(chParam.value),
        initialMode: defaultGlobalConfig().initialMode,
      };
      // INITIAL_MODE is ArduPilot only; PX4 picks its boot mode from a separate
      // parameter and this control is disabled for PX4 in the UI.
      if (!isPx4) {
        const initialModeParam = await protocol.getParameter("INITIAL_MODE");
        g.initialMode = String(initialModeParam.value);
      }
      setGlobalConfig(g);
      globalBaselineRef.current = { ...g };
      setGlobalDirty(false);

      const modeParams = await Promise.all(
        Array.from({ length: MODE_SLOT_COUNT }, (_, i) =>
          protocol.getParameter(`${slotPrefix}${i + 1}`),
        ),
      );

      let simpleBitmask = 0;
      let superSimpleBitmask = 0;
      // Simple / Super Simple are ArduCopter concepts with no PX4 equivalent.
      if (isCopter && !isPx4) {
        const [simpleParam, superSimpleParam] = await Promise.all([
          protocol.getParameter("SIMPLE"),
          protocol.getParameter("SUPER_SIMPLE"),
        ]);
        simpleBitmask = simpleParam.value;
        superSimpleBitmask = superSimpleParam.value;
      }

      const simpleSet = bitmaskToSet(simpleBitmask);
      const superSimpleSet = bitmaskToSet(superSimpleBitmask);

      const newSlots: ModeSlotConfig[] = modeParams.map((p, i) => ({
        mode: decodeSlotMode(firmwareHandler, p.value),
        simple: simpleSet.has(i),
        superSimple: superSimpleSet.has(i),
      }));

      setSlots(newSlots);
      baselineRef.current = newSlots.map((s) => ({ ...s }));
      setDirtySlots(new Set());
      setShowCommitButton(false);
      toast("Loaded flight mode configuration", "success");
    } catch {
      toast("Failed to load flight modes", "error");
    } finally {
      setLoading(false);
    }
  }, [protocol, firmwareHandler, isPx4, isCopter, channelParam, slotPrefix, toast]);

  const totalDirtyCount = dirtySlots.size + (globalDirty ? 1 : 0);
  const isDirty = totalDirtyCount > 0;

  const saveParams = useCallback(async () => {
    if (!protocol) return;
    if (!isDirty) return;
    setSaving(true);
    try {
      const writes: { name: string; value: number }[] = [];
      if (globalDirty) {
        const g = globalConfig;
        const gb = globalBaselineRef.current;
        if (g.modeChannel !== gb.modeChannel) {
          writes.push({ name: channelParam, value: Number(g.modeChannel) });
        }
        if (!isPx4 && g.initialMode !== gb.initialMode) {
          writes.push({ name: "INITIAL_MODE", value: Number(g.initialMode) });
        }
      }

      let simpleChanged = false;
      let superSimpleChanged = false;

      for (const idx of dirtySlots) {
        const slot = slots[idx];
        const base = baselineRef.current[idx];

        if (slot.mode !== base.mode && firmwareHandler) {
          if (firmwareHandler.firmwareType === "px4") {
            // PX4 mode slots hold the small mode-slot enum, not the packed
            // custom_mode. Skip (with a warning) any mode that has no PX4 slot.
            const slotValue = px4ModeToSlot(slot.mode as UnifiedFlightMode);
            if (slotValue === null) {
              toast(`${slot.mode} has no PX4 mode slot; skipped`, "warning");
            } else {
              writes.push({ name: `${slotPrefix}${idx + 1}`, value: slotValue });
            }
          } else {
            const { customMode } = firmwareHandler.encodeFlightMode(
              slot.mode as UnifiedFlightMode,
            );
            writes.push({ name: `${slotPrefix}${idx + 1}`, value: customMode });
          }
        }

        if (slot.simple !== base.simple) simpleChanged = true;
        if (slot.superSimple !== base.superSimple) superSimpleChanged = true;
      }

      if (isCopter && !isPx4 && simpleChanged) {
        const simpleSet = new Set<number>();
        for (let i = 0; i < MODE_SLOT_COUNT; i++) {
          if (slots[i].simple) simpleSet.add(i);
        }
        writes.push({ name: "SIMPLE", value: setToBitmask(simpleSet) });
      }

      if (isCopter && !isPx4 && superSimpleChanged) {
        const ssSet = new Set<number>();
        for (let i = 0; i < MODE_SLOT_COUNT; i++) {
          if (slots[i].superSimple) ssSet.add(i);
        }
        writes.push({ name: "SUPER_SIMPLE", value: setToBitmask(ssSet) });
      }

      // Each write reports the vehicle's own answer; the edit counts as saved
      // only when every one of them landed, otherwise it stays dirty to retry.
      const failures: string[] = [];
      for (const { name, value } of writes) {
        const result = await protocol.setParameter(name, value).catch(() => null);
        if (!result?.success) failures.push(`${name}: ${result?.message ?? "write failed"}`);
      }
      if (failures.length > 0) {
        toast(`Flight modes not fully saved. Failed: ${failures.join(", ")}`, "error");
        return;
      }

      baselineRef.current = slots.map((s) => ({ ...s }));
      globalBaselineRef.current = { ...globalConfig };
      setDirtySlots(new Set());
      setGlobalDirty(false);
      setShowCommitButton(true);
      toast("Saved to flight controller", "success");
    } catch {
      toast("Failed to save flight modes", "error");
    } finally {
      setSaving(false);
    }
  }, [protocol, firmwareHandler, isPx4, isCopter, channelParam, slotPrefix, slots, globalConfig, isDirty, globalDirty, dirtySlots, toast]);

  const commitToFlash = useCallback(async () => {
    if (!protocol) return;
    try {
      const result = await protocol.commitParamsToFlash();
      if (result.success) {
        setShowCommitButton(false);
        toast("Written to flash — persists after reboot", "success");
      } else {
        toast("Failed to write to flash", "error");
      }
    } catch {
      toast("Failed to write to flash", "error");
    }
  }, [protocol, toast]);

  const updateSlot = useCallback((idx: number, partial: Partial<ModeSlotConfig>) => {
    setSlots((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...partial };
      return next;
    });
    setDirtySlots((prev) => new Set(prev).add(idx));
  }, []);

  const resetSlot = useCallback((idx: number) => {
    setSlots((prev) => {
      const next = [...prev];
      next[idx] = { ...baselineRef.current[idx] };
      return next;
    });
    setDirtySlots((prev) => {
      const next = new Set(prev);
      next.delete(idx);
      return next;
    });
  }, []);

  const updateGlobal = useCallback((partial: Partial<FlightModeGlobalConfig>) => {
    setGlobalConfig((prev) => ({ ...prev, ...partial }));
    setGlobalDirty(true);
  }, []);

  return {
    slots,
    dirtySlots,
    globalConfig,
    globalDirty,
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
  };
}
