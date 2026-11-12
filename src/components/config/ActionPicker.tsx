"use client";

/** The action select of the controller binding sheet: built-in actions by group, then plugin skills. */

import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { DS4_ACTIONS } from "@/lib/input/ds4-bindings";
import { useSkillRegistry } from "@/lib/skills";

const GROUP_LABEL: Record<string, string> = {
  flight: "Flight",
  skills: "Skills",
  camera: "Camera",
  view: "View & layers",
  profile: "Profile",
  none: "None",
};

export function ActionPicker({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const tq = useTranslations("configUi.controlsSettings");
  const registry = useSkillRegistry((s) => s.skills);
  const skills = useMemo(() => [...registry.values()].filter((s) => s.source === "plugin"), [registry]);
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="min-h-12 w-full rounded border border-border-default bg-bg-secondary px-2 text-xs"
      aria-label={tq("action")}
    >
      {Object.keys(GROUP_LABEL).map((g) =>
        g === "none" ? (
          <option key="none" value="none">
            {tq("none")}
          </option>
        ) : g === "skills" ? (
          <optgroup key={g} label={GROUP_LABEL[g]}>
            {skills.map((s) => (
              <option key={s.id} value={`skill:${s.id}`}>
                {s.id}
              </option>
            ))}
          </optgroup>
        ) : (
          <optgroup key={g} label={GROUP_LABEL[g]}>
            {DS4_ACTIONS.filter((a) => a.group === g).map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </optgroup>
        ),
      )}
    </select>
  );
}
