/**
 * @module PatternCameraRows
 * @description The camera rows shared by the camera patterns: the camera
 * picker (built-ins, the operator's custom cameras, then "Custom camera…"
 * which opens an inline editor), edit/delete for a custom camera, mounting
 * orientation, the two overlaps, GSD, and a warning when the trigger
 * distance asks the camera to shoot faster than it can.
 * @license GPL-3.0-only
 */
"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Pencil, Trash2 } from "lucide-react";
import { Select } from "@/components/ui/select";
import { PropertyRow } from "@/components/ui/property-row";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useSettingsStore } from "@/stores/settings-store";
import {
  CAMERA_PROFILES, computeGSD, maxSpeedForTriggerInterval, type CameraOrientation, type CameraProfile,
} from "@/lib/patterns/gsd-calculator";
import type { PatternCameraSettings } from "@/lib/patterns/types";
import { CAMERA_OPTIONS } from "./pattern-editor-constants";
import { CustomCameraEditor } from "./CustomCameraEditor";
import { DEFAULT_FRONTLAP_PCT, DEFAULT_SIDELAP_PCT } from "./pattern-camera";

/** Select value of the "Custom camera…" entry. */
const NEW_CAMERA_VALUE = "__new_camera__";

interface PatternCameraRowsProps {
  config: PatternCameraSettings;
  camera: CameraProfile | undefined;
  /** Distance from the camera to the surface it images, metres (flight height or wall distance). */
  rangeM: number;
  /** Pattern speed, m/s, and the trigger distance in use, metres (for the trigger-rate check). */
  speed: number;
  triggerDistance: number;
  /** Apply a camera field change; the pattern recomputes its spacings. */
  onChange: (update: Partial<PatternCameraSettings>) => void;
  /** Hide the overlap sliders (the survey places them itself). */
  hideOverlaps?: boolean;
}

const iconButton =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-text-tertiary transition-colors hover:bg-bg-tertiary hover:text-text-primary cursor-pointer focus-ring";

export function PatternCameraRows({
  config, camera, rangeM, speed, triggerDistance, onChange, hideOverlaps = false,
}: PatternCameraRowsProps) {
  const t = useTranslations("planner");
  const tc = useTranslations("planner.pattern.camera");
  const te = useTranslations("planner.inspector.editor");
  const customCameras = useSettingsStore((s) => s.customCameras);
  const addCustomCamera = useSettingsStore((s) => s.addCustomCamera);
  const updateCustomCamera = useSettingsStore((s) => s.updateCustomCamera);
  const removeCustomCamera = useSettingsStore((s) => s.removeCustomCamera);
  /** null = closed; "new" = adding; otherwise the name of the camera being edited. */
  const [editing, setEditing] = useState<string | null>(null);

  const options = useMemo(() => [
    ...CAMERA_OPTIONS,
    ...customCameras.map((c) => ({ value: c.name, label: c.name })),
    { value: NEW_CAMERA_VALUE, label: tc("custom") },
  ], [customCameras, tc]);

  const isCustom = !!camera && customCameras.some((c) => c.name === camera.name);
  const takenNames = useMemo(
    () => [...CAMERA_PROFILES.map((c) => c.name), ...customCameras.map((c) => c.name)],
    [customCameras],
  );
  const sidelap = config._sidelap ?? DEFAULT_SIDELAP_PCT;
  const frontlap = config._frontlap ?? DEFAULT_FRONTLAP_PCT;
  const orientation: CameraOrientation = config._orientation ?? "landscape";
  const gsd = camera ? computeGSD(rangeM, camera.focalLength, camera.sensorWidth, camera.imageWidth) : 0;
  const maxSpeed = camera ? maxSpeedForTriggerInterval(camera, triggerDistance) : null;
  const tooFast = maxSpeed !== null && speed > maxSpeed;

  const pick = (value: string) => {
    if (value === NEW_CAMERA_VALUE) { setEditing("new"); return; }
    setEditing(null);
    onChange(value ? { _cameraName: value, _sidelap: sidelap, _frontlap: frontlap } : { _cameraName: "" });
  };

  return (
    <div className="flex flex-col">
      <PropertyRow label={t("cameraProfile")}
        trailing={isCustom ? (
          <span className="flex">
            <button type="button" className={iconButton} title={tc("edit")} aria-label={tc("edit")}
              onClick={() => setEditing(camera.name)}><Pencil size={12} /></button>
            <button type="button" className={iconButton} title={tc("delete")} aria-label={tc("delete")}
              onClick={() => { removeCustomCamera(camera.name); setEditing(null); onChange({ _cameraName: "" }); }}>
              <Trash2 size={12} />
            </button>
          </span>
        ) : undefined}>
        <Select ariaLabel={t("cameraProfile")} compact options={options}
          value={editing === "new" ? NEW_CAMERA_VALUE : camera?.name ?? config._cameraName ?? ""} onChange={pick} />
      </PropertyRow>

      {editing !== null && (
        <CustomCameraEditor
          key={editing}
          initial={editing === "new" ? undefined : customCameras.find((c) => c.name === editing)}
          takenNames={takenNames}
          onCancel={() => setEditing(null)}
          onSave={(saved) => {
            if (editing === "new") addCustomCamera(saved);
            else updateCustomCamera(editing, saved);
            setEditing(null);
            onChange({ _cameraName: saved.name, _sidelap: sidelap, _frontlap: frontlap });
          }}
        />
      )}

      {camera && (
        <>
          <PropertyRow label={tc("orientation")}>
            <SegmentedControl<CameraOrientation> size="sm" stretch ariaLabel={tc("orientation")}
              options={[
                { value: "landscape", label: tc("landscape") },
                { value: "portrait", label: tc("portrait") },
              ]}
              value={orientation} onChange={(_orientation) => onChange({ _orientation })} />
          </PropertyRow>
          <PropertyRow label={te("gsd")} hint={te("gsdHint")}>
            <span className="block truncate font-mono text-xs text-text-primary">{(gsd * 100).toFixed(2)} cm/px</span>
          </PropertyRow>
          {!hideOverlaps && (
            <>
              <OverlapRow label={t("sidelap")} value={sidelap} onChange={(_sidelap) => onChange({ _sidelap })} />
              <OverlapRow label={te("frontlap")} value={frontlap} onChange={(_frontlap) => onChange({ _frontlap })} />
            </>
          )}
          {tooFast && (
            <p className="py-0.5 text-[11px] text-status-warning" role="status">
              {tc("tooFast", { speed: (Math.floor(maxSpeed * 10) / 10).toFixed(1) })}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** A 20–95 % overlap slider. */
export function OverlapRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <PropertyRow label={label}
      trailing={<span className="w-9 text-right font-mono text-xs text-text-primary">{value}%</span>}>
      <input type="range" min={20} max={95} step={5} aria-label={label} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1 bg-bg-tertiary appearance-none cursor-pointer accent-accent-primary" />
    </PropertyRow>
  );
}
