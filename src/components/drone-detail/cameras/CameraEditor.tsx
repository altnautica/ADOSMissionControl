"use client";

/**
 * @module drone-detail/cameras/CameraEditor
 * @description Modal for editing (or assigning) one camera: name, mount
 * orientation, purposes, enabled + primary-stream designation, and an advanced
 * disclosure for field-of-view + mount pitch. Save builds a minimal patch of the
 * changed fields and hands it up; the tab persists the whole leg list.
 * @license GPL-3.0-only
 */

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { Select, type SelectOption } from "@/components/ui/select";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import {
  CAMERA_ORIENTATIONS,
  CAMERA_PURPOSES,
  type RosterCamera,
} from "@/lib/agent/feature-types";
import type { CameraPatch } from "@/lib/agent/camera-roster";
import { cn } from "@/lib/utils";

const INPUT_CLASS =
  "w-full rounded-md border border-border-default bg-bg-tertiary px-2 py-1.5 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none";

/** Parse a number field to a finite number, or null for an empty / invalid entry. */
function toNum(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(b);
  return a.every((x) => set.has(x));
}

export function CameraEditor({
  camera,
  saving,
  onClose,
  onSave,
}: {
  camera: RosterCamera;
  saving: boolean;
  onClose: () => void;
  onSave: (id: string, patch: CameraPatch) => void;
}) {
  const t = useTranslations("cameras");
  const discovered = camera.state === "discovered_unassigned";

  const [name, setName] = useState(camera.name ?? "");
  const [orientation, setOrientation] = useState(camera.orientation ?? "");
  const [purpose, setPurpose] = useState<string[]>([...camera.purpose]);
  const [enabled, setEnabled] = useState(discovered ? true : camera.enabled);
  const [primary, setPrimary] = useState(camera.role === "primary");
  const [fov, setFov] = useState(
    camera.fov_deg != null ? String(camera.fov_deg) : "",
  );
  const [mount, setMount] = useState(
    camera.mount_pitch_deg != null ? String(camera.mount_pitch_deg) : "",
  );

  const orientationOptions = useMemo<SelectOption[]>(
    () => [
      { value: "", label: t("orientation.none") },
      ...CAMERA_ORIENTATIONS.map((o) => ({
        value: o,
        label: t(`orientation.${o}`),
      })),
    ],
    [t],
  );

  const togglePurpose = (p: string) =>
    setPurpose((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    );

  const handleSave = () => {
    const patch: CameraPatch = {};
    const trimmedName = name.trim();
    if (trimmedName !== (camera.name ?? "")) {
      patch.name = trimmedName === "" ? null : trimmedName;
    }
    if (orientation !== (camera.orientation ?? "")) {
      patch.orientation = orientation === "" ? null : orientation;
    }
    if (!sameSet(purpose, camera.purpose)) patch.purpose = purpose;
    // The primary stream is always served, so it is always enabled.
    const effectiveEnabled = primary || enabled;
    if (!discovered && effectiveEnabled !== camera.enabled) {
      patch.enabled = effectiveEnabled;
    }
    const wasPrimary = camera.role === "primary";
    if (!discovered && primary !== wasPrimary) {
      patch.role = primary ? "primary" : null;
    }
    const fovNum = toNum(fov);
    if (fovNum !== (camera.fov_deg ?? null)) patch.fov_deg = fovNum;
    const mountNum = toNum(mount);
    if (mountNum !== (camera.mount_pitch_deg ?? null)) {
      patch.mount_pitch_deg = mountNum;
    }
    onSave(camera.id, patch);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={discovered ? t("editor.assignTitle") : t("editor.title")}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {t("editor.cancel")}
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {t("editor.save")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <label className="block space-y-1">
          <span className="text-xs text-text-secondary">{t("editor.name")}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("editor.namePlaceholder")}
            className={INPUT_CLASS}
          />
        </label>

        <div className="space-y-1">
          <span className="text-xs text-text-secondary">
            {t("editor.orientation")}
          </span>
          <Select
            options={orientationOptions}
            value={orientation}
            onChange={setOrientation}
          />
        </div>

        <div className="space-y-1.5">
          <span className="text-xs text-text-secondary">
            {t("editor.purpose")}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {CAMERA_PURPOSES.map((p) => {
              const on = purpose.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  aria-pressed={on}
                  onClick={() => togglePurpose(p)}
                  className={cn(
                    "rounded-md border px-2 py-0.5 text-xs transition-colors",
                    on
                      ? "border-accent-primary bg-accent-primary/10 text-accent-primary"
                      : "border-border-default bg-bg-secondary text-text-secondary hover:border-border-strong",
                  )}
                >
                  {t(`purpose.${p}`)}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-text-tertiary">
            {t("editor.purposeHint")}
          </p>
        </div>

        {!discovered ? (
          <div className="space-y-2 rounded-md border border-border-default bg-bg-tertiary/40 p-3">
            <Toggle
              label={t("editor.enabled")}
              checked={primary || enabled}
              onChange={setEnabled}
              disabled={primary}
            />
            {primary ? (
              <p className="text-[11px] text-text-tertiary">
                {t("editor.primaryAlwaysOn")}
              </p>
            ) : null}
            <Toggle
              label={t("editor.primary")}
              checked={primary}
              onChange={setPrimary}
            />
            <p className="text-[11px] text-text-tertiary">
              {t("editor.primaryHint")}
            </p>
          </div>
        ) : null}

        <CollapsibleSection title={t("editor.advanced")} defaultOpen={false}>
          <div className="grid grid-cols-2 gap-3 pt-2">
            <label className="block space-y-1">
              <span className="text-xs text-text-secondary">
                {t("editor.fov")}
              </span>
              <input
                type="number"
                value={fov}
                onChange={(e) => setFov(e.target.value)}
                className={INPUT_CLASS}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-text-secondary">
                {t("editor.mountPitch")}
              </span>
              <input
                type="number"
                value={mount}
                onChange={(e) => setMount(e.target.value)}
                className={INPUT_CLASS}
              />
            </label>
          </div>
        </CollapsibleSection>
      </div>
    </Modal>
  );
}
