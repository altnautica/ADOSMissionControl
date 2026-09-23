/**
 * @module RateDynamicsPanel
 * @description iNav rate dynamics editor. Reads the six rate-dynamics settings
 * (sensitivity, correction and weight, each for center and end stick) with the
 * range the connected firmware reports for each, and writes them back through
 * the named settings system. A value outside its range is never sent, and a
 * setting the FC refuses fails the write.
 * @license GPL-3.0-only
 */

"use client";

import { PanelHeader } from "../shared/PanelHeader";
import { Button } from "@/components/ui/button";
import { Activity, Upload } from "lucide-react";
import { useSettingsParams } from "@/hooks/use-settings-params";
import type { DroneProtocol } from "@/lib/protocol/types";
import {
  emptySettingGroup, rangeError, readSettingGroup, writeSettingGroup,
  type SettingGroup, type SettingSpec,
} from "./inav-setting-fields";

type RateDynamicsKey =
  | "sensitivityCenter" | "sensitivityEnd"
  | "correctionCenter" | "correctionEnd"
  | "weightCenter" | "weightEnd";

const FIELDS: ReadonlyArray<SettingSpec<RateDynamicsKey> & { label: string; hint: string }> = [
  { key: "sensitivityCenter", name: "rate_dynamics_center_sensitivity", label: "Sensitivity center", hint: "Mid-stick response" },
  { key: "sensitivityEnd", name: "rate_dynamics_end_sensitivity", label: "Sensitivity end", hint: "Full-stick response" },
  { key: "correctionCenter", name: "rate_dynamics_center_correction", label: "Correction center", hint: "Mid-stick snap correction" },
  { key: "correctionEnd", name: "rate_dynamics_end_correction", label: "Correction end", hint: "Full-stick snap correction" },
  { key: "weightCenter", name: "rate_dynamics_center_weight", label: "Weight center", hint: "Mid-stick weighting" },
  { key: "weightEnd", name: "rate_dynamics_end_weight", label: "Weight end", hint: "Full-stick weighting" },
];

const settingsSupported = (p: DroneProtocol): boolean => !!p.settings;
const readRateDynamics = (p: DroneProtocol) => readSettingGroup(p.settings!, FIELDS);
const writeRateDynamics = (p: DroneProtocol, g: SettingGroup<RateDynamicsKey>) => writeSettingGroup(p.settings!, FIELDS, g);

export function RateDynamicsPanel() {
  const {
    values: group, setValues, loading, error, hasLoaded, dirty,
    connected, isArmed, lockMessage, read, write,
  } = useSettingsParams<SettingGroup<RateDynamicsKey>>({
    panelId: "inav-rate-dynamics",
    initial: emptySettingGroup(),
    read: readRateDynamics,
    write: writeRateDynamics,
    supported: settingsSupported,
    unsupportedMessage: "Settings not available on this firmware",
  });

  const handleChange = (key: RateDynamicsKey, value: number) => {
    setValues((prev) => ({ ...prev, values: { ...prev.values, [key]: value } }));
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-4">
        <PanelHeader
          title="Rate Dynamics"
          subtitle="Stick-response curve shaping, within the ranges the flight controller reports."
          icon={<Activity size={16} />}
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
          <div className="border border-border-default rounded p-4 space-y-3">
            {dirty && (
              <p className="text-[10px] font-mono text-status-warning">
                Unsaved changes : use Write to FC to persist.
              </p>
            )}
            {FIELDS.map((f) => {
              const value = group.values[f.key];
              const range = group.ranges[f.key];
              if (value === undefined || !range) return null;
              const problem = rangeError(value, range);
              return (
                <div key={f.key} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-text-secondary">
                      {f.label}
                      <span className="ml-1 text-text-tertiary">({range.min} to {range.max})</span>
                    </span>
                    <span className="text-[11px] font-mono text-text-primary">{value}</span>
                  </div>
                  <input
                    type="range"
                    min={range.min}
                    max={range.max}
                    value={value}
                    disabled={isArmed}
                    onChange={(e) => handleChange(f.key, parseInt(e.target.value, 10))}
                    className="w-full"
                  />
                  {problem && <span className="text-[10px] font-mono text-status-error">{problem}</span>}
                  <span className="text-[10px] text-text-tertiary">{f.hint}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
