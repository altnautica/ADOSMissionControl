/**
 * @module EzTunePanel
 * @description iNav EZ Tune configuration editor.
 * Reads and writes the EZ Tune block via the iNav MSP2 extension.
 * EZ Tune provides simplified single-slider tuning that internally
 * scales PID, filter, and rate parameters.
 * @license GPL-3.0-only
 */

"use client";

import { PanelHeader } from "../shared/PanelHeader";
import { Button } from "@/components/ui/button";
import { Sliders, Upload } from "lucide-react";
import { useSettingsParams } from "@/hooks/use-settings-params";
import type { DroneProtocol } from "@/lib/protocol/types";
import type { INavEzTune } from "@/lib/protocol/msp/msp-decoders-inav";
import { EZ_TUNE_DEFAULTS, EZ_TUNE_FIELDS, ezTuneRangeError, type EzTuneSliderKey } from "./ez-tune-fields";

// ── Helpers ───────────────────────────────────────────────────

const ezTuneSupported = (p: DroneProtocol): boolean => typeof p.getEzTune === "function";

async function readEzTune(protocol: DroneProtocol): Promise<INavEzTune> {
  return protocol.getEzTune!();
}

async function writeEzTune(protocol: DroneProtocol, values: INavEzTune): Promise<void> {
  const problem = ezTuneRangeError(values);
  if (problem) throw new Error(problem);
  const result = await protocol.setEzTune!(values);
  if (!result.success) throw new Error(result.message);
}

// ── Component ─────────────────────────────────────────────────

export function EzTunePanel() {
  const {
    values, setValues, loading, error, hasLoaded, dirty,
    connected, isArmed, lockMessage, read, write,
  } = useSettingsParams<INavEzTune>({
    panelId: "inav-ez-tune",
    initial: EZ_TUNE_DEFAULTS,
    read: readEzTune,
    write: writeEzTune,
    supported: ezTuneSupported,
    unsupportedMessage: "EZ Tune not available on this firmware",
  });

  function handleSlider(key: EzTuneSliderKey, raw: string) {
    setValues((prev) => ({ ...prev, [key]: parseInt(raw, 10) }));
  }

  function handleToggle() {
    setValues((prev) => ({ ...prev, enabled: !prev.enabled }));
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-4">
        <PanelHeader
          title="EZ Tune"
          subtitle="Simplified PID and filter tuning via unified sliders."
          icon={<Sliders size={16} />}
          loading={loading}
          loadProgress={null}
          hasLoaded={hasLoaded}
          onRead={read}
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
              onClick={write}
            >
              Write to FC
            </Button>
          )}
        </PanelHeader>

        {hasLoaded && (
          <div className="border border-border-default rounded p-4 space-y-4">
            {dirty && (
              <p className="text-[10px] font-mono text-status-warning">
                Unsaved changes : use Write to FC to persist.
              </p>
            )}
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-text-secondary">Enable EZ Tune</span>
              <button
                onClick={handleToggle}
                className={`text-[11px] px-3 py-1 rounded border ${
                  values.enabled
                    ? "border-accent-primary bg-accent-primary/20 text-accent-primary"
                    : "border-border-default text-text-secondary"
                }`}
              >
                {values.enabled ? "Enabled" : "Disabled"}
              </button>
            </div>

            {EZ_TUNE_FIELDS.map((f) => (
              <div key={f.key} className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-text-secondary">{f.label}</span>
                  <span className="text-[11px] font-mono text-text-primary">{values[f.key]}</span>
                </div>
                <input
                  type="range"
                  min={f.min}
                  max={f.max}
                  value={values[f.key] as number}
                  onChange={(e) => handleSlider(f.key, e.target.value)}
                  className="w-full"
                />
                <span className="text-[10px] text-text-tertiary">{f.hint}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
