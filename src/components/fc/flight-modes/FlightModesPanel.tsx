"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useDroneManager } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { bitmaskToSet, setToBitmask } from "@/lib/rc-options";
import { RotateCcw, Save, HardDrive, Info } from "lucide-react";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import type { UnifiedFlightMode } from "@/lib/protocol/types";
import { PwmRangeBar } from "../motors/PwmRangeBar";
import { ModeSlotRow } from "./ModeSlotRow";
import {
  MODE_PWM_RANGES,
  MODE_SLOT_COUNT,
  defaultSlot,
  defaultGlobalConfig,
} from "./flight-mode-constants";
import type { ModeSlotConfig, FlightModeGlobalConfig } from "./flight-mode-constants";

// ── Main Component ───────────────────────────────────────────

export function FlightModesPanel() {
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const { toast } = useToast();
  const { isArmed, lockMessage } = useArmedLock();
  const protocol = getSelectedProtocol();
  const firmwareHandler = protocol?.getFirmwareHandler() ?? null;
  const isCopter = firmwareHandler?.vehicleClass === "copter";

  // Live RC data
  const rcBuffer = useTelemetryStore((s) => s.rc);
  const latestRc = rcBuffer.latest();

  // Current heartbeat mode from drone store
  const heartbeatMode = useDroneStore((s) => s.flightMode);

  // ── Slot state ────────────────────────────────────────────
  const [slots, setSlots] = useState<ModeSlotConfig[]>(
    () => Array.from({ length: MODE_SLOT_COUNT }, defaultSlot),
  );
  const baselineRef = useRef<ModeSlotConfig[]>(
    Array.from({ length: MODE_SLOT_COUNT }, defaultSlot),
  );
  const [dirtySlots, setDirtySlots] = useState<Set<number>>(new Set());

  // ── Global config state ───────────────────────────────────
  const [globalConfig, setGlobalConfig] = useState<FlightModeGlobalConfig>(defaultGlobalConfig);
  const globalBaselineRef = useRef<FlightModeGlobalConfig>(defaultGlobalConfig());
  const [globalDirty, setGlobalDirty] = useState(false);

  // ── UI state ──────────────────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showCommitButton, setShowCommitButton] = useState(false);

  // ── Available modes from firmware handler ──────────────────

  const availableModes = useMemo(() => {
    if (firmwareHandler) {
      return firmwareHandler.getAvailableModes().map((m) => ({
        value: m,
        label: m,
      }));
    }
    return [
      "STABILIZE", "ACRO", "ALT_HOLD", "AUTO", "GUIDED", "LOITER",
      "RTL", "LAND", "CIRCLE", "POSHOLD", "AUTOTUNE", "MANUAL",
      "BRAKE", "SMART_RTL", "DRIFT", "SPORT",
    ].map((m) => ({ value: m, label: m }));
  }, [firmwareHandler]);

  // ── Channel options ──────────────────────────────────────

  const channelOptions = useMemo(
    () => Array.from({ length: 16 }, (_, i) => ({
      value: String(i + 1),
      label: `Channel ${i + 1}`,
    })),
    [],
  );

  // ── Current mode channel PWM value ───────────────────────

  const modeChIdx = Number(globalConfig.modeChannel) - 1;
  const currentPwm = latestRc?.channels[modeChIdx] ?? 0;

  // Determine active slot based on current PWM
  const activeSlot = useMemo(() => {
    if (currentPwm === 0) return -1;
    for (let i = 0; i < MODE_PWM_RANGES.length; i++) {
      const range = MODE_PWM_RANGES[i];
      if (currentPwm >= range.min && currentPwm <= range.max) return i;
    }
    return -1;
  }, [currentPwm]);

  // ── Duplicate mode detection ─────────────────────────────

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

  // ── Derived dirty count ──────────────────────────────────

  const totalDirtyCount = dirtySlots.size + (globalDirty ? 1 : 0);
  const isDirty = totalDirtyCount > 0;

  useUnsavedGuard(isDirty);

  // ── Fetch params ─────────────────────────────────────────

  const fetchParams = useCallback(async () => {
    if (!protocol) return;
    setLoading(true);
    try {
      // Read global config
      const [chParam, initialModeParam] = await Promise.all([
        protocol.getParameter("FLTMODE_CH"),
        protocol.getParameter("INITIAL_MODE"),
      ]);

      const g: FlightModeGlobalConfig = {
        modeChannel: String(chParam.value),
        initialMode: String(initialModeParam.value),
      };
      setGlobalConfig(g);
      globalBaselineRef.current = { ...g };
      setGlobalDirty(false);

      // Read 6 mode slots
      const modeParams = await Promise.all(
        Array.from({ length: MODE_SLOT_COUNT }, (_, i) =>
          protocol.getParameter(`FLTMODE${i + 1}`),
        ),
      );

      // Read bitmasks (copter only)
      let simpleBitmask = 0;
      let superSimpleBitmask = 0;
      if (isCopter) {
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
        mode: firmwareHandler
          ? firmwareHandler.decodeFlightMode(p.value)
          : "STABILIZE",
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
  }, [protocol, firmwareHandler, isCopter, toast]);

  // ── Auto-read on mount (Bug #1 fix) ─────────────────────

  useEffect(() => {
    fetchParams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Save params — only dirty writes (Bug #3 fix) ─────────

  const saveParams = useCallback(async () => {
    if (!protocol) return;
    if (!isDirty) return;
    setSaving(true);
    try {
      // Global config
      if (globalDirty) {
        const g = globalConfig;
        const gb = globalBaselineRef.current;
        if (g.modeChannel !== gb.modeChannel) {
          await protocol.setParameter("FLTMODE_CH", Number(g.modeChannel));
        }
        if (g.initialMode !== gb.initialMode) {
          await protocol.setParameter("INITIAL_MODE", Number(g.initialMode));
        }
      }

      // Per-slot modes
      let simpleChanged = false;
      let superSimpleChanged = false;

      for (const idx of dirtySlots) {
        const slot = slots[idx];
        const base = baselineRef.current[idx];

        // Write mode param if changed
        if (slot.mode !== base.mode && firmwareHandler) {
          const { customMode } = firmwareHandler.encodeFlightMode(
            slot.mode as UnifiedFlightMode,
          );
          await protocol.setParameter(`FLTMODE${idx + 1}`, customMode);
        }

        if (slot.simple !== base.simple) simpleChanged = true;
        if (slot.superSimple !== base.superSimple) superSimpleChanged = true;
      }

      // Write SIMPLE bitmask if any slot's simple changed (copter only)
      if (isCopter && simpleChanged) {
        const simpleSet = new Set<number>();
        for (let i = 0; i < MODE_SLOT_COUNT; i++) {
          if (slots[i].simple) simpleSet.add(i);
        }
        await protocol.setParameter("SIMPLE", setToBitmask(simpleSet));
      }

      // Write SUPER_SIMPLE bitmask if any slot's superSimple changed (copter only)
      if (isCopter && superSimpleChanged) {
        const ssSet = new Set<number>();
        for (let i = 0; i < MODE_SLOT_COUNT; i++) {
          if (slots[i].superSimple) ssSet.add(i);
        }
        await protocol.setParameter("SUPER_SIMPLE", setToBitmask(ssSet));
      }

      // Update baselines
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
  }, [protocol, firmwareHandler, isCopter, slots, globalConfig, isDirty, globalDirty, dirtySlots, toast]);

  // ── Commit to flash (Bug #2 fix) ─────────────────────────

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

  // ── Slot updaters ────────────────────────────────────────

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

  // ── Global config updater ────────────────────────────────

  const updateGlobal = useCallback((partial: Partial<FlightModeGlobalConfig>) => {
    setGlobalConfig((prev) => ({ ...prev, ...partial }));
    setGlobalDirty(true);
  }, []);

  // ── No protocol ──────────────────────────────────────────

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
        {/* ── Header ────────────────────────────────────────── */}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-text-primary">Flight Modes</h2>
            {isDirty && (
              <span className="flex items-center gap-1 text-[10px] text-status-warning">
                <span className="w-1.5 h-1.5 rounded-full bg-status-warning" />
                {totalDirtyCount} unsaved
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<RotateCcw size={12} />}
              loading={loading}
              onClick={fetchParams}
            >
              Read
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<Save size={12} />}
              loading={saving}
              disabled={!isDirty}
              onClick={saveParams}
            >
              Save{dirtySlots.size > 0 ? ` (${dirtySlots.size})` : ""}
            </Button>
            {showCommitButton && (
              <Button
                variant="secondary"
                size="sm"
                icon={<HardDrive size={12} />}
                onClick={commitToFlash}
              >
                Write to Flash
              </Button>
            )}
          </div>
        </div>

        {/* ── Current Mode Bar ──────────────────────────────── */}

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

        {/* ── Mode Switch Channel ───────────────────────────── */}

        <Card title="Mode Switch Channel">
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Select
                label="RC channel for flight mode switch"
                value={globalConfig.modeChannel}
                onChange={(v) => updateGlobal({ modeChannel: v })}
                options={channelOptions}
              />
              <Select
                label="Initial boot mode (INITIAL_MODE)"
                value={globalConfig.initialMode}
                onChange={(v) => updateGlobal({ initialMode: v })}
                options={[
                  { value: "0", label: "0 — Use mode switch" },
                  ...availableModes
                    .map((m) => {
                      if (firmwareHandler) {
                        try {
                          const { customMode } = firmwareHandler.encodeFlightMode(
                            m.value as UnifiedFlightMode,
                          );
                          return { value: String(customMode), label: `${customMode} — ${m.label}` };
                        } catch {
                          return null;
                        }
                      }
                      return { value: m.value, label: m.label };
                    })
                    .filter((opt): opt is { value: string; label: string } => opt !== null && opt.value !== "0"),
                ]}
              />
            </div>

            {/* PWM Range Bar */}
            <PwmRangeBar currentPwm={currentPwm} activeSlot={activeSlot} />

            <div className="flex items-center gap-2">
              <span className="text-[10px] text-text-secondary">Current PWM:</span>
              <span className="text-xs font-mono text-accent-primary tabular-nums">
                {currentPwm > 0 ? currentPwm : "\u2014"}
              </span>
              {activeSlot >= 0 && (
                <span className="text-[10px] text-status-success font-medium ml-1">
                  Slot {activeSlot + 1} active
                </span>
              )}
            </div>
          </div>
        </Card>

        {/* ── Duplicate Mode Info ───────────────────────────── */}

        {hasDuplicates && (
          <div className="flex items-center gap-2 p-2 bg-accent-primary/5 border border-accent-primary/20">
            <Info size={14} className="text-accent-primary shrink-0" />
            <span className="text-[10px] text-accent-primary">
              Same mode in multiple slots: {[...duplicateModes].join(", ")}. This is valid but unusual.
            </span>
          </div>
        )}

        {/* ── Armed Warning ──────────────────────────── */}

        {isArmed && (
          <div className="flex items-center gap-2 p-2 bg-status-warning/10 border border-status-warning/50">
            <span className="text-[10px] text-status-warning">{lockMessage}</span>
          </div>
        )}

        {/* ── Mode Slots ────────────────────────────────────── */}

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
