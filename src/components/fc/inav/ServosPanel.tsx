/**
 * @module ServosPanel
 * @description iNav servo configuration editor (fixed-wing and VTOL).
 * Reads servo configs from the FC, allows editing travel limits and center,
 * and writes each slot back individually.
 * @license GPL-3.0-only
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { useDroneManager } from "@/stores/drone-manager";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { PanelHeader } from "../shared/PanelHeader";
import { Button } from "@/components/ui/button";
import { Sliders, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import type { INavServoConfig } from "@/lib/protocol/msp/msp-decoders-inav";

// platformType 0 = MULTIROTOR. Servos are only meaningful on other platforms.
const PLATFORM_MULTIROTOR = 0;

// ── Component ─────────────────────────────────────────────────

export function ServosPanel() {
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const connected = !!getSelectedProtocol();

  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [servos, setServos] = useState<INavServoConfig[]>([]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [platformType, setPlatformType] = useState<number | null>(null);

  const { isArmed, lockMessage } = useArmedLock();
  useUnsavedGuard(dirty);

  useEffect(() => {
    const protocol = getSelectedProtocol();
    if (!protocol?.getMixerConfig) return;
    protocol.getMixerConfig().then((m) => {
      setPlatformType(m.platformType);
    }).catch(() => {
      // Leave platformType null so the panel shows normally on unsupported firmware.
    });
  }, [getSelectedProtocol]);

  function updateServo(idx: number, partial: Partial<INavServoConfig>) {
    setServos((prev) => prev.map((s, i) => (i === idx ? { ...s, ...partial } : s)));
    setDirty(true);
  }

  const handleRead = useCallback(async () => {
    const protocol = getSelectedProtocol();
    if (!protocol?.getServoConfigs) { setError("Servo config not supported"); return; }
    setLoading(true); setError(null);
    try {
      const data = await protocol.getServoConfigs();
      setServos(data); setHasLoaded(true); setDirty(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [getSelectedProtocol]);

  const handleWrite = useCallback(async () => {
    const protocol = getSelectedProtocol();
    if (!protocol?.setServoConfig) { setError("Servo write not supported"); return; }
    setLoading(true); setError(null);
    try {
      for (let i = 0; i < servos.length; i++) {
        const result = await protocol.setServoConfig(i, servos[i]);
        if (!result.success) { setError(result.message); return; }
      }
      setDirty(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [getSelectedProtocol, servos]);

  const isMultirotor = platformType === PLATFORM_MULTIROTOR;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-4">
        {isMultirotor && (
          <p className="text-[11px] text-text-tertiary border border-border-default rounded px-3 py-2 bg-bg-secondary">
            This panel applies to fixed-wing and tricopter platforms. The connected flight controller is configured as a multirotor.
          </p>
        )}
        <PanelHeader
          title="Servo Config"
          subtitle="Travel limits, center position, and rate"
          icon={<Sliders size={16} />}
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

        {dirty && !isMultirotor && (
          <p className="text-[10px] font-mono text-status-warning">
            Unsaved changes : use Write to FC to persist.
          </p>
        )}

        {hasLoaded && !isMultirotor && (
          <div className="space-y-1">
            {servos.map((sv, idx) => (
              <div
                key={idx}
                onClick={() => setActiveIndex(activeIndex === idx ? null : idx)}
                className={cn(
                  "border border-border-default rounded cursor-pointer transition-colors bg-surface-primary",
                  activeIndex === idx && "border-accent-primary",
                )}
              >
                <div className="flex items-center gap-3 px-3 py-2">
                  <span className="text-[10px] font-mono text-text-tertiary w-6">S{idx + 1}</span>
                  <span className="text-xs font-mono text-text-secondary">
                    {sv.min} / {sv.middle} / {sv.max}
                  </span>
                  <span className="text-[10px] font-mono text-text-tertiary ml-auto">
                    rate: {sv.rate}
                  </span>
                </div>

                {activeIndex === idx && (
                  <div
                    className="px-3 pb-3 space-y-2 border-t border-border-default"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="grid grid-cols-3 gap-2 mt-2">
                      {(["min", "middle", "max"] as const).map((key) => (
                        <label key={key} className="flex flex-col gap-1">
                          <span className="text-[10px] text-text-tertiary font-mono capitalize">{key} (µs)</span>
                          <input
                            type="number"
                            value={sv[key]}
                            onChange={(e) => updateServo(idx, { [key]: parseInt(e.target.value) || 0 })}
                            className="bg-bg-tertiary border border-border-default rounded px-2 py-1 text-xs font-mono text-text-primary focus:outline-none focus:border-accent-primary"
                          />
                        </label>
                      ))}
                    </div>
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] text-text-tertiary font-mono">Rate (%)</span>
                      <input
                        type="number"
                        min={-125}
                        max={125}
                        value={sv.rate}
                        onChange={(e) =>
                          updateServo(idx, { rate: Math.max(-125, Math.min(125, parseInt(e.target.value) || 0)) })
                        }
                        className="bg-bg-tertiary border border-border-default rounded px-2 py-1 text-xs font-mono text-text-primary focus:outline-none focus:border-accent-primary"
                      />
                    </label>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
