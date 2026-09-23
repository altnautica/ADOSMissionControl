/**
 * @module OutputMappingPanel
 * @description iNav output mapping and timer output mode editor.
 * Shows the current output mapping (motor/servo/led assignments) and
 * allows changing the timer output mode for each timer group.
 * @license GPL-3.0-only
 */

"use client";

import { useCallback, useState } from "react";
import { useDroneManager } from "@/stores/drone-manager";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { PanelHeader } from "../shared/PanelHeader";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Cpu, Upload } from "lucide-react";
import type {
  INavOutputMappingExt2Entry,
  INavTimerOutputModeEntry,
} from "@/lib/protocol/msp/msp-decoders-inav";
import { TIMER_OUTPUT_MODE_OPTIONS, timerUsageLabel } from "./inav-output-mapping";

// ── Component ─────────────────────────────────────────────────

export function OutputMappingPanel() {
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const connected = !!getSelectedProtocol();

  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [mapping, setMapping] = useState<INavOutputMappingExt2Entry[]>([]);
  const [timerModes, setTimerModes] = useState<INavTimerOutputModeEntry[]>([]);

  const { isArmed, lockMessage } = useArmedLock();
  useUnsavedGuard(dirty);

  const handleRead = useCallback(async () => {
    const protocol = getSelectedProtocol();
    if (!protocol?.getOutputMapping || !protocol?.getTimerOutputModes) {
      setError("Output mapping not supported"); return;
    }
    setLoading(true); setError(null);
    try {
      const [map, modes] = await Promise.all([
        protocol.getOutputMapping(),
        protocol.getTimerOutputModes(),
      ]);
      setMapping(map); setTimerModes(modes);
      setHasLoaded(true); setDirty(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [getSelectedProtocol]);

  const handleWrite = useCallback(async () => {
    const protocol = getSelectedProtocol();
    if (!protocol?.setTimerOutputMode) { setError("Timer mode write not supported"); return; }
    setLoading(true); setError(null);
    try {
      const result = await protocol.setTimerOutputMode(timerModes);
      if (!result.success) { setError(result.message); return; }
      setDirty(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [getSelectedProtocol, timerModes]);

  function updateTimerMode(timerId: number, mode: number) {
    setTimerModes((prev) =>
      prev.map((e) => (e.timerId === timerId ? { ...e, mode } : e))
    );
    setDirty(true);
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-4">
        <PanelHeader
          title="Output Mapping"
          subtitle="Timer groups and output type assignments"
          icon={<Cpu size={16} />}
          loading={loading}
          loadProgress={null}
          hasLoaded={hasLoaded}
          onRead={handleRead}
          connected={connected}
          error={error}
        >
          {hasLoaded && timerModes.length > 0 && (
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
            {timerModes.length > 0 && (
              <div className="border border-border-default rounded p-3 space-y-2">
                <p className="text-[10px] font-mono text-text-tertiary uppercase tracking-wide">Timer output modes</p>
                {timerModes.map((entry) => (
                  <div key={entry.timerId} className="flex items-center gap-3">
                    <span className="text-[10px] font-mono text-text-tertiary w-16">Timer {entry.timerId}</span>
                    <div className="flex-1">
                      <Select
                        label=""
                        options={TIMER_OUTPUT_MODE_OPTIONS}
                        value={String(entry.mode)}
                        onChange={(v) => updateTimerMode(entry.timerId, parseInt(v))}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {mapping.length > 0 && (
              <div className="border border-border-default rounded p-3 space-y-1">
                <p className="text-[10px] font-mono text-text-tertiary uppercase tracking-wide">Output assignments (read-only)</p>
                <div className="grid grid-cols-3 gap-1 mt-2">
                  {mapping.map((entry, i) => (
                    <div key={i} className="flex items-center gap-1 text-[10px] font-mono">
                      <span className="text-text-tertiary w-6">O{i + 1}</span>
                      <span className="text-text-primary">{timerUsageLabel(entry.usageFlags)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
