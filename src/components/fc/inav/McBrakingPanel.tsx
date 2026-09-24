/**
 * @module McBrakingPanel
 * @description iNav multicopter braking configuration.
 * Controls aggressive position hold on high-speed maneuvers by tuning
 * brake engage speed, disengage speed, timeout, and boost parameters.
 * @license GPL-3.0-only
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { PanelHeader } from "../shared/PanelHeader";
import { Button } from "@/components/ui/button";
import { Braces, Upload } from "lucide-react";
import type { INavMcBraking } from "@/lib/protocol/msp/msp-decoders-inav";
import { MC_BRAKING_RANGES, clampMcBraking } from "./mc-braking-ranges";

// platformType 0 = MULTIROTOR. MC braking applies only to multirotors.
const PLATFORM_MULTIROTOR = 0;

// ── Default ───────────────────────────────────────────────────

const DEFAULT: INavMcBraking = {
  speedThreshold: 150,
  disengageSpeed: 75,
  timeout: 2000,
  boostFactor: 100,
  boostTimeout: 750,
  boostSpeedThreshold: 150,
  boostDisengage: 75,
  bankAngle: 40,
};

// ── Component ─────────────────────────────────────────────────

export function McBrakingPanel() {
  const selectedProtocol = useDroneManager(selectSelectedProtocol);
  const connected = !!selectedProtocol;

  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [braking, setBraking] = useState<INavMcBraking>(DEFAULT);
  const [platformType, setPlatformType] = useState<number | null>(null);

  const { isArmed, lockMessage } = useArmedLock();
  useUnsavedGuard(dirty);

  useEffect(() => {
    const protocol = selectedProtocol;
    if (!protocol?.getMixerConfig) return;
    protocol.getMixerConfig().then((m) => {
      setPlatformType(m.platformType);
    }).catch(() => {
      // Leave platformType null on unsupported firmware.
    });
  }, [selectedProtocol]);

  function update<K extends keyof INavMcBraking>(key: K, value: INavMcBraking[K]) {
    setBraking((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  const handleRead = useCallback(async () => {
    const protocol = selectedProtocol;
    if (!protocol?.getMcBraking) { setError("MC braking config not supported"); return; }
    setLoading(true); setError(null);
    try {
      const data = await protocol.getMcBraking();
      setBraking(data); setHasLoaded(true); setDirty(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedProtocol]);

  const handleWrite = useCallback(async () => {
    const protocol = selectedProtocol;
    if (!protocol?.setMcBraking) { setError("MC braking write not supported"); return; }
    // Values outside the firmware range would wrap on the wire (bank angle 300
    // arrives as 44), so they are brought into range and shown before writing.
    const { value, adjusted } = clampMcBraking(braking);
    if (adjusted.length > 0) {
      setBraking(value);
      setError(`Adjusted to the flight controller's range: ${adjusted.join(", ")}. Review and write again.`);
      return;
    }
    setLoading(true); setError(null);
    try {
      const result = await protocol.setMcBraking(value);
      if (!result.success) { setError(result.message); return; }
      setDirty(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedProtocol, braking]);

  const fields: Array<{ key: keyof INavMcBraking; label: string; unit: string }> = [
    { key: "speedThreshold", label: "Engage speed", unit: "cm/s" },
    { key: "disengageSpeed", label: "Disengage speed", unit: "cm/s" },
    { key: "timeout", label: "Brake timeout", unit: "ms" },
    { key: "bankAngle", label: "Max bank angle", unit: "deg" },
    { key: "boostFactor", label: "Boost factor", unit: "%" },
    { key: "boostTimeout", label: "Boost timeout", unit: "ms" },
    { key: "boostSpeedThreshold", label: "Boost engage speed", unit: "cm/s" },
    { key: "boostDisengage", label: "Boost disengage speed", unit: "cm/s" },
  ];

  const isNonMultirotor = platformType !== null && platformType !== PLATFORM_MULTIROTOR;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-4">
        {isNonMultirotor && (
          <p className="text-[11px] text-text-tertiary border border-border-default rounded px-3 py-2 bg-bg-secondary">
            This panel applies to multirotor platforms. The connected flight controller is configured as a different platform.
          </p>
        )}
        <PanelHeader
          title="MC Braking"
          subtitle="Multicopter position-hold braking parameters"
          icon={<Braces size={16} />}
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

        {dirty && !isNonMultirotor && (
          <p className="text-[10px] font-mono text-status-warning">
            Unsaved changes : use Write to FC to persist.
          </p>
        )}

        {hasLoaded && !isNonMultirotor && (
          <div className="grid grid-cols-2 gap-3">
            {fields.map(({ key, label, unit }) => (
              <label key={key} className="flex flex-col gap-1">
                <span className="text-[10px] text-text-tertiary font-mono">
                  {label} ({unit})
                </span>
                <input
                  type="number"
                  min={MC_BRAKING_RANGES[key].min}
                  max={MC_BRAKING_RANGES[key].max}
                  value={braking[key]}
                  onChange={(e) => update(key, parseInt(e.target.value) || 0)}
                  className="bg-bg-tertiary border border-border-default rounded px-2 py-1 text-xs font-mono text-text-primary focus:outline-none focus:border-accent-primary"
                />
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
