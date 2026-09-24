/**
 * @module BatteryProfilePanel
 * @description iNav battery profile editor.
 * Reads the active battery profile, allows editing voltage thresholds and
 * capacity settings, and writes back. Also allows switching battery profiles.
 * @license GPL-3.0-only
 */

"use client";

import { useCallback, useState } from "react";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { PanelHeader } from "../shared/PanelHeader";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { BatteryCharging, Upload } from "lucide-react";
import type { INavBatteryConfig } from "@/lib/protocol/msp/msp-decoders-inav";

// ── Constants ─────────────────────────────────────────────────

const PROFILE_OPTIONS = [
  { value: "0", label: "Profile 1" },
  { value: "1", label: "Profile 2" },
  { value: "2", label: "Profile 3" },
];

/** iNav `bat_capacity_unit`: MAH = 0, MWH = 1. */
const CAPACITY_UNIT_OPTIONS = [
  { value: "0", label: "mAh" },
  { value: "1", label: "mWh" },
];

const VOLTAGE_SOURCE_OPTIONS = [
  { value: "0", label: "Raw (VBAT pin)" },
  { value: "1", label: "SAG compensated" },
];

const DEFAULT_CFG: INavBatteryConfig = {
  voltageScale: 1100, // 1.10 divider scale at iNav's 10x resolution — replaced by the FC-read value when present
  capacityMah: 2200,
  capacityWarningMah: 440,
  capacityCriticalMah: 220,
  capacityUnit: 0,
  voltageSource: 0,
  cells: 0,
  cellDetect: 1,
  // iNav stores cell voltages in 0.01 V.
  cellMin: 330,
  cellMax: 420,
  cellWarning: 350,
  currentScale: 400,
  currentOffset: 0,
};

// ── Component ─────────────────────────────────────────────────

export function BatteryProfilePanel() {
  const selectedProtocol = useDroneManager(selectSelectedProtocol);
  const connected = !!selectedProtocol;

  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [activeProfile, setActiveProfile] = useState(0);
  const [cfg, setCfg] = useState<INavBatteryConfig>(DEFAULT_CFG);

  const { isArmed, lockMessage } = useArmedLock();
  useUnsavedGuard(dirty);

  function updateCfg<K extends keyof INavBatteryConfig>(key: K, value: INavBatteryConfig[K]) {
    setCfg((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  const handleRead = useCallback(async () => {
    const protocol = selectedProtocol;
    if (!protocol?.getBatteryConfig || !protocol.getActiveProfiles) { setError("Battery config not supported"); return; }
    setLoading(true); setError(null);
    try {
      // The FC edits the battery profile it is flying, so both are read together.
      const [profiles, data] = await Promise.all([protocol.getActiveProfiles(), protocol.getBatteryConfig()]);
      setActiveProfile(profiles.batteryProfile);
      setCfg(data); setHasLoaded(true); setDirty(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedProtocol]);

  const handleWrite = useCallback(async () => {
    const protocol = selectedProtocol;
    if (!protocol?.setBatteryConfig) { setError("Battery config not supported"); return; }
    setLoading(true); setError(null);
    try {
      const result = await protocol.setBatteryConfig(cfg);
      if (!result.success) { setError(result.message); return; }
      setDirty(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedProtocol, cfg]);

  const handleSwitchProfile = useCallback(async (idx: number) => {
    const protocol = selectedProtocol;
    if (!protocol?.selectBatteryProfile || !protocol.getActiveProfiles || !protocol.getBatteryConfig) {
      setError("Profile switch not supported");
      return;
    }
    setLoading(true); setError(null);
    try {
      const result = await protocol.selectBatteryProfile(idx);
      if (!result.success) { setError(result.message); return; }
      // Show the profile the FC reports, not the one requested.
      const [profiles, data] = await Promise.all([protocol.getActiveProfiles(), protocol.getBatteryConfig()]);
      setActiveProfile(profiles.batteryProfile);
      if (profiles.batteryProfile !== idx) setError(`The flight controller stayed on profile ${profiles.batteryProfile + 1}`);
      setCfg(data); setHasLoaded(true); setDirty(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedProtocol]);

  const capacityUnit = cfg.capacityUnit === 1 ? "mWh" : "mAh";

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-4">
        <PanelHeader
          title="Battery Profiles"
          subtitle="Voltage thresholds, capacity, and current sensor settings"
          icon={<BatteryCharging size={16} />}
          loading={loading}
          loadProgress={null}
          hasLoaded={hasLoaded}
          onRead={handleRead}
          connected={connected}
          error={error}
        >
          {hasLoaded && (
            <Button
              variant="primary"
              size="sm"
              icon={<Upload size={12} />}
              loading={loading}
              disabled={!connected || loading || isArmed}
              title={isArmed ? lockMessage : undefined}
              onClick={handleWrite}
            >
              Write to FC
            </Button>
          )}
        </PanelHeader>

        {dirty && (
          <p className="text-[10px] font-mono text-status-warning">
            Unsaved changes : use Write to FC to persist.
          </p>
        )}

        {hasLoaded && (
          <div className="space-y-4">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-text-tertiary font-mono">Active profile</span>
              <Select
                label=""
                options={PROFILE_OPTIONS}
                value={String(activeProfile)}
                disabled={!connected || loading || isArmed}
                onChange={(v) => handleSwitchProfile(parseInt(v))}
              />
            </div>

            <div className="border border-border-default rounded p-3 space-y-3">
              <p className="text-[10px] font-mono text-text-tertiary uppercase tracking-wide">Cell voltages (0.01 V)</p>
              <div className="grid grid-cols-3 gap-2">
                {(["cellMin", "cellMax", "cellWarning"] as const).map((key) => (
                  <label key={key} className="flex flex-col gap-1">
                    <span className="text-[10px] text-text-tertiary font-mono capitalize">
                      {key === "cellMin" ? "Min" : key === "cellMax" ? "Max" : "Warning"}
                    </span>
                    <input
                      type="number"
                      value={cfg[key]}
                      onChange={(e) => updateCfg(key, parseInt(e.target.value) || 0)}
                      className="bg-bg-tertiary border border-border-default rounded px-2 py-1 text-xs font-mono text-text-primary focus:outline-none focus:border-accent-primary"
                    />
                  </label>
                ))}
              </div>
            </div>

            <div className="border border-border-default rounded p-3 space-y-3">
              <p className="text-[10px] font-mono text-text-tertiary uppercase tracking-wide">Capacity</p>
              <div className="grid grid-cols-2 gap-2">
                {(["capacityMah", "capacityWarningMah", "capacityCriticalMah"] as const).map((key) => (
                  <label key={key} className="flex flex-col gap-1">
                    <span className="text-[10px] text-text-tertiary font-mono">
                      {key === "capacityMah" ? `Total (${capacityUnit})` : key === "capacityWarningMah" ? `Warning (${capacityUnit})` : `Critical (${capacityUnit})`}
                    </span>
                    <input
                      type="number"
                      value={cfg[key]}
                      onChange={(e) => updateCfg(key, parseInt(e.target.value) || 0)}
                      className="bg-bg-tertiary border border-border-default rounded px-2 py-1 text-xs font-mono text-text-primary focus:outline-none focus:border-accent-primary"
                    />
                  </label>
                ))}
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] text-text-tertiary font-mono">Capacity unit</span>
                  <Select
                    label=""
                    options={CAPACITY_UNIT_OPTIONS}
                    value={String(cfg.capacityUnit)}
                    onChange={(v) => updateCfg("capacityUnit", parseInt(v))}
                  />
                </div>
              </div>
            </div>

            <div className="border border-border-default rounded p-3 space-y-3">
              <p className="text-[10px] font-mono text-text-tertiary uppercase tracking-wide">Current sensor</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-text-tertiary font-mono">Scale (mV/A x10)</span>
                  <input
                    type="number"
                    value={cfg.currentScale}
                    onChange={(e) => updateCfg("currentScale", parseInt(e.target.value) || 0)}
                    className="bg-bg-tertiary border border-border-default rounded px-2 py-1 text-xs font-mono text-text-primary focus:outline-none focus:border-accent-primary"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-text-tertiary font-mono">Offset (mA)</span>
                  <input
                    type="number"
                    value={cfg.currentOffset}
                    onChange={(e) => updateCfg("currentOffset", parseInt(e.target.value) || 0)}
                    className="bg-bg-tertiary border border-border-default rounded px-2 py-1 text-xs font-mono text-text-primary focus:outline-none focus:border-accent-primary"
                  />
                </label>
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] text-text-tertiary font-mono">Voltage source</span>
                  <Select
                    label=""
                    options={VOLTAGE_SOURCE_OPTIONS}
                    value={String(cfg.voltageSource)}
                    onChange={(v) => updateCfg("voltageSource", parseInt(v))}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
