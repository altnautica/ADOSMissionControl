"use client";

import { useState, useMemo } from "react";
import { usePanelParams } from "@/hooks/use-panel-params";
import { useParamMetadataMap } from "@/hooks/use-param-metadata";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { useToast } from "@/components/ui/toast";
import { useFlashCommitToast } from "@/hooks/use-flash-commit-toast";
import { ArmedWarningBanner } from "@/components/indicators/ArmedWarningBanner";
import { PanelHeader } from "../shared/PanelHeader";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Cpu, Save, HardDrive, RotateCcw } from "lucide-react";
import { Px4ActuatorTest } from "../px4/Px4ActuatorTest";
import { PX4_OUTPUT_FUNCTION_OPTIONS } from "./px4-output-functions";

// ── Constants ────────────────────────────────────────────────

const MAX_ROTORS = 8;
const MAX_PWM = 8;

const ACTUATOR_PARAMS: string[] = [
  "CA_ROTOR_COUNT",
  ...Array.from({ length: MAX_ROTORS }, (_, i) => [
    `CA_ROTOR${i}_PX`, `CA_ROTOR${i}_PY`, `CA_ROTOR${i}_PZ`,
  ]).flat(),
  ...Array.from({ length: MAX_PWM }, (_, i) => `PWM_MAIN_FUNC${i + 1}`),
  "CA_SV_CS_COUNT",
];

// ── Component ────────────────────────────────────────────────

export function ActuatorPanel() {
  const { toast } = useToast();
  const { showFlashResult } = useFlashCommitToast();
  const [saving, setSaving] = useState(false);

  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded,
    refresh, setLocalValue, saveAllToRam, commitToFlash,
  } = usePanelParams({ paramNames: ACTUATOR_PARAMS, panelId: "actuator", autoLoad: true });
  useUnsavedGuard(dirtyParams.size > 0);

  const connected = useDroneManager(selectSelectedProtocol) !== null;
  const hasDirty = dirtyParams.size > 0;
  const rotorCount = params.get("CA_ROTOR_COUNT") ?? 4;

  // Output-function labels: prefer the firmware-exact enum carried in the
  // FC-served parameter metadata (PWM_MAIN_FUNC values), so the full, correct
  // function set is shown for this exact build; fall back to the static list
  // offline or when metadata is unavailable.
  const metadata = useParamMetadataMap();
  const functionOptions = useMemo(() => {
    const values = metadata.get("PWM_MAIN_FUNC1")?.values;
    if (values && values.size > 0) {
      return [...values.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([code, label]) => ({ value: String(code), label: `${code}: ${label}` }));
    }
    return [...PX4_OUTPUT_FUNCTION_OPTIONS];
  }, [metadata]);
  // Keep the current value selectable even if it is not in the enum list.
  const optionsFor = (current: number) =>
    functionOptions.some((o) => o.value === String(current))
      ? functionOptions
      : [...functionOptions, { value: String(current), label: `${current}` }];

  // Motor geometry for SVG visualization
  const rotorPositions = useMemo(() => {
    const positions: Array<{ x: number; y: number; z: number; idx: number }> = [];
    for (let i = 0; i < Math.min(rotorCount, MAX_ROTORS); i++) {
      positions.push({
        idx: i,
        x: params.get(`CA_ROTOR${i}_PX`) ?? 0,
        y: params.get(`CA_ROTOR${i}_PY`) ?? 0,
        z: params.get(`CA_ROTOR${i}_PZ`) ?? 0,
      });
    }
    return positions;
  }, [rotorCount, params]);

  async function handleSave() {
    setSaving(true);
    const ok = await saveAllToRam();
    setSaving(false);
    if (ok) toast("Actuator config saved", "success");
    else toast("Failed to save actuator config", "error");
  }

  async function handleFlash() {
    const ok = await commitToFlash();
    showFlashResult(ok, { successMessage: "Written to flash" });
  }

  return (
    <ArmedWarningBanner>
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl space-y-6">
        <PanelHeader
          icon={<Cpu size={16} />}
          title="Actuator Configuration"
          subtitle="PX4 Control Allocation — motor geometry and output mapping"
          loading={loading}
          loadProgress={loadProgress}
          hasLoaded={hasLoaded}
          error={error}
          onRead={refresh}
          connected={connected}
        />

        {hasLoaded && (
          <>
            {/* Motor Geometry */}
            <section>
              <h3 className="text-sm font-medium text-text-primary mb-3">Motor Geometry</h3>
              <div className="flex gap-6">
                {/* SVG top-down view */}
                <div className="w-48 h-48 bg-bg-tertiary rounded-lg border border-border-default flex items-center justify-center shrink-0">
                  <svg viewBox="-1.2 -1.2 2.4 2.4" className="w-40 h-40">
                    {/* Crosshair */}
                    <line x1="-1" y1="0" x2="1" y2="0" stroke="currentColor" strokeWidth="0.02" className="text-border-default" />
                    <line x1="0" y1="-1" x2="0" y2="1" stroke="currentColor" strokeWidth="0.02" className="text-border-default" />
                    {/* Nose direction */}
                    <polygon points="0,-0.15 -0.05,-0.05 0.05,-0.05" fill="currentColor" className="text-text-tertiary" />
                    {/* Motors */}
                    {rotorPositions.map((r) => {
                      const scale = 3;
                      const cx = r.y * scale;
                      const cy = -r.x * scale;
                      return (
                        <g key={r.idx}>
                          <circle cx={cx} cy={cy} r={0.18} fill="none" stroke="currentColor" strokeWidth="0.04" className="text-accent-primary" />
                          <text x={cx} y={cy + 0.06} textAnchor="middle" fontSize="0.14" fill="currentColor" className="text-text-primary font-medium">
                            {r.idx + 1}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                </div>

                {/* Rotor position inputs */}
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2 mb-2">
                    <label className="text-xs text-text-secondary">Rotor Count</label>
                    <Input
                      type="number" min={1} max={8} step={1}
                      value={String(rotorCount)}
                      onChange={(e) => setLocalValue("CA_ROTOR_COUNT", Number(e.target.value) || 4)}
                      className="h-7 text-xs w-16"
                    />
                  </div>
                  <div className="grid grid-cols-4 gap-1 text-[10px] text-text-tertiary font-medium">
                    <span>Motor</span><span>X (fwd)</span><span>Y (right)</span><span>Z (down)</span>
                  </div>
                  {rotorPositions.map((r) => (
                    <div key={r.idx} className="grid grid-cols-4 gap-1">
                      <span className="text-xs text-text-primary flex items-center">M{r.idx + 1}</span>
                      {(["PX", "PY", "PZ"] as const).map((axis) => {
                        const param = `CA_ROTOR${r.idx}_${axis}`;
                        return (
                          <Input
                            key={axis}
                            type="number" step={0.01} min={-2} max={2}
                            value={String(params.get(param) ?? 0)}
                            onChange={(e) => setLocalValue(param, Number(e.target.value) || 0)}
                            className="h-7 text-xs"
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* PWM Output Functions */}
            <section>
              <h3 className="text-sm font-medium text-text-primary mb-3">PWM Output Functions</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {Array.from({ length: MAX_PWM }, (_, i) => {
                  const param = `PWM_MAIN_FUNC${i + 1}`;
                  return (
                    <div key={param} className="flex items-center gap-3 p-2 rounded bg-bg-tertiary">
                      <span className="text-xs font-medium text-text-primary w-16">MAIN {i + 1}</span>
                      <Select
                        value={String(params.get(param) ?? 0)}
                        onChange={(v) => setLocalValue(param, Number(v))}
                        options={optionsFor(params.get(param) ?? 0)}
                        searchable
                        className="flex-1"
                      />
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Control Surface Count */}
            <section>
              <h3 className="text-sm font-medium text-text-primary mb-3">Control Surfaces</h3>
              <div className="flex items-center gap-3 p-3 rounded bg-bg-tertiary">
                <label className="text-xs text-text-secondary">Surface Count</label>
                <Input
                  type="number" min={0} max={8} step={1}
                  value={String(params.get("CA_SV_CS_COUNT") ?? 0)}
                  onChange={(e) => setLocalValue("CA_SV_CS_COUNT", Number(e.target.value) || 0)}
                  className="h-7 text-xs w-16"
                />
              </div>
            </section>

            {/* Live actuator test */}
            <section>
              <h3 className="text-sm font-medium text-text-primary mb-3">Actuator Test</h3>
              <Px4ActuatorTest connected={connected} />
            </section>

            {/* Save / Flash */}
            <div className="flex gap-2 pt-2">
              <Button size="sm" disabled={!hasDirty || saving} onClick={handleSave}>
                <Save size={14} className="mr-1" /> {saving ? "Saving..." : "Save"}
              </Button>
              <Button size="sm" variant="secondary" disabled={!hasRamWrites} onClick={handleFlash}>
                <HardDrive size={14} className="mr-1" /> Write to Flash
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
    </ArmedWarningBanner>
  );
}
