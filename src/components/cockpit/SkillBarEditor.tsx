/**
 * The Skill Bar editor: an inline binding surface that replaces the live Skill
 * Bar while editing. The operator drags skills from the drawer onto slots,
 * swaps/clears slots by drag, captures a key chord or gamepad button per slot,
 * resets to defaults, applies the documented controller defaults, and manages
 * named loadout presets. While this is mounted the dispatcher is paused by the
 * cockpit (a captured key must not fire a skill).
 *
 * Keyboard flow (no pointer required): focus a slot -> open the drawer -> pick a
 * skill (Enter on a drawer item) -> the skill binds to the focused slot; the
 * slot's key/button capture buttons are reachable by Tab. Every bind/clear is
 * announced via a polite live region.
 *
 * @module fly/SkillBarEditor
 * @license GPL-3.0-only
 */

"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { RotateCcw, Gamepad2 } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { useSettingsStore } from "@/stores/settings-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useSkillRegistry, type Skill } from "@/lib/skills";
import { skillDisplayLabel } from "@/lib/skills/skill-label";
import { formatChord } from "@/lib/skills/chord";
import { DEFAULT_LOADOUT_ID } from "@/stores/settings/keybindings-slice";
import type { HotbarSlot } from "@/stores/settings/keybindings-slice";
import { SKILL_BUTTON_DEFAULTS } from "@/lib/input/skill-button-defaults";
import { useKeyCapture, useButtonCapture } from "@/hooks/use-binding-capture";
import { SkillDrawer } from "./SkillDrawer";
import { EditableSkillSlot } from "./EditableSkillSlot";
import { LoadoutPresetBar } from "./LoadoutPresetBar";
import { CockpitLayoutEditor } from "./CockpitLayoutEditor";
import type { SkillDragPayload } from "./skill-drag";

interface SkillBarEditorProps {
  onClose: () => void;
}

export function SkillBarEditor({ onClose }: SkillBarEditorProps) {
  const t = useTranslations("skillBindings");
  const tRoot = useTranslations();
  const { toast } = useToast();

  const selectedId = useDroneManager((s) => s.selectedDroneId);

  const loadouts = useSettingsStore((s) => s.loadouts);
  const activeLoadoutId = useSettingsStore((s) => s.activeLoadoutId);
  const bindSkillToSlot = useSettingsStore((s) => s.bindSkillToSlot);
  const setSlotKey = useSettingsStore((s) => s.setSlotKey);
  const setSlotGamepadButton = useSettingsStore((s) => s.setSlotGamepadButton);
  const resetLoadoutToDefaults = useSettingsStore((s) => s.resetLoadoutToDefaults);

  const registrySkills = useSkillRegistry((s) => s.skills);
  const resolveForDrone = useSkillRegistry((s) => s.resolveForDrone);

  const loadout = loadouts[activeLoadoutId] ?? loadouts[DEFAULT_LOADOUT_ID];
  const slots: HotbarSlot[] = loadout?.slots ?? [];

  const resolvedById = useMemo(() => {
    const map = new Map<string, Skill>();
    if (selectedId) {
      for (const skill of resolveForDrone(selectedId)) map.set(skill.id, skill);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, resolveForDrone, registrySkills]);

  const boundSkillIds = useMemo(() => {
    const set = new Set<string>();
    for (const slot of slots) if (slot.skillId) set.add(slot.skillId);
    return set;
  }, [slots]);

  const [focusedIndex, setFocusedIndex] = useState<number | null>(
    slots.length > 0 ? slots[0].index : null,
  );
  const [capturing, setCapturing] = useState<
    { index: number; mode: "key" | "button" } | null
  >(null);

  // Polite live-region announcement of the last bind/clear action.
  const [announcement, setAnnouncement] = useState("");
  const announce = useCallback((msg: string) => setAnnouncement(msg), []);

  const labelForSkillId = useCallback(
    (skillId: string | null): string => {
      if (!skillId) return t("empty");
      const skill = resolvedById.get(skillId);
      return skill ? skillDisplayLabel(skill, tRoot) : skillId;
    },
    [resolvedById, t, tRoot],
  );

  // ── Key / button capture for the active slot ────────────────────────────
  const keyCapture = useKeyCapture({
    onCapture: (chord) => {
      const target = capturing;
      setCapturing(null);
      if (!target || !loadout) return;
      // Identify a slot that already holds this chord, so we can name what got
      // reassigned (the slice's last-write-wins clears it under us).
      const prevHolder = loadout.slots.find(
        (s) => s.key === chord && s.index !== target.index,
      );
      setSlotKey(loadout.id, target.index, chord);
      const skillLabel = labelForSkillId(
        loadout.slots.find((s) => s.index === target.index)?.skillId ?? null,
      );
      if (prevHolder) {
        announce(
          t("announceKeyReassigned", {
            key: formatChord(chord),
            label: skillLabel,
            previous: labelForSkillId(prevHolder.skillId),
          }),
        );
      } else {
        announce(
          t("announceKeyBound", { key: formatChord(chord), label: skillLabel }),
        );
      }
    },
    onReserved: (chord) => {
      setCapturing(null);
      toast(t("reservedChord", { key: formatChord(chord) }), "warning");
    },
  });

  const buttonCapture = useButtonCapture({
    onCapture: (button) => {
      const target = capturing;
      setCapturing(null);
      if (!target || !loadout) return;
      setSlotGamepadButton(loadout.id, target.index, button);
      const skillLabel = labelForSkillId(
        loadout.slots.find((s) => s.index === target.index)?.skillId ?? null,
      );
      announce(t("announceButtonBound", { button, label: skillLabel }));
    },
  });

  const startCaptureKey = (index: number) => {
    buttonCapture.cancel();
    setCapturing({ index, mode: "key" });
    keyCapture.start();
  };
  const startCaptureButton = (index: number) => {
    keyCapture.cancel();
    setCapturing({ index, mode: "button" });
    buttonCapture.start();
  };

  // ── Drop handling: bind / swap / clear ──────────────────────────────────
  const handleDrop = (targetIndex: number, payload: SkillDragPayload) => {
    if (!loadout) return;
    if (payload.kind === "skill") {
      bindSkillToSlot(loadout.id, targetIndex, payload.skillId);
      announce(
        t("announceBound", {
          label: labelForSkillId(payload.skillId),
          slot: targetIndex + 1,
        }),
      );
      return;
    }
    // Slot -> slot swap.
    const from = payload.index;
    if (from === targetIndex) return;
    const fromSkill = loadout.slots.find((s) => s.index === from)?.skillId ?? null;
    const toSkill =
      loadout.slots.find((s) => s.index === targetIndex)?.skillId ?? null;
    bindSkillToSlot(loadout.id, targetIndex, fromSkill);
    bindSkillToSlot(loadout.id, from, toSkill);
    announce(
      t("announceSwapped", {
        a: targetIndex + 1,
        b: from + 1,
      }),
    );
  };

  // Drop onto the trash zone clears the dragged slot.
  const handleClearDrop = (payload: SkillDragPayload) => {
    if (!loadout) return;
    if (payload.kind !== "slot") return;
    bindSkillToSlot(loadout.id, payload.index, null);
    announce(t("announceCleared", { slot: payload.index + 1 }));
  };

  // ── Drawer pick: bind into the focused slot ─────────────────────────────
  const handlePickSkill = (skillId: string) => {
    if (!loadout) return;
    const target = focusedIndex ?? slots.find((s) => !s.skillId)?.index ?? slots[0]?.index;
    if (target === undefined) return;
    bindSkillToSlot(loadout.id, target, skillId);
    announce(
      t("announceBound", {
        label: labelForSkillId(skillId),
        slot: target + 1,
      }),
    );
  };

  const handleApplyControllerDefaults = () => {
    if (!loadout) return;
    let applied = 0;
    for (const def of SKILL_BUTTON_DEFAULTS) {
      const slot = loadout.slots.find((s) => s.skillId === def.skillId);
      if (slot) {
        setSlotGamepadButton(loadout.id, slot.index, def.button);
        applied += 1;
      }
    }
    toast(t("controllerDefaultsApplied", { count: applied }), "success");
    announce(t("controllerDefaultsApplied", { count: applied }));
  };

  const handleReset = () => {
    resetLoadoutToDefaults();
    toast(t("resetDone"), "success");
    announce(t("resetDone"));
  };

  const trashRef = useRef<HTMLDivElement>(null);

  return (
    <div className="pointer-events-auto flex max-h-[60vh] w-[min(880px,92vw)] flex-col gap-3 overflow-y-auto border border-border-default bg-bg-secondary/95 p-3 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text-primary">
          {t("editorTitle")}
        </h3>
        <Button variant="primary" size="sm" onClick={onClose}>
          {t("doneEditing")}
        </Button>
      </div>

      <p className="text-[11px] text-text-tertiary">{t("editorHint")}</p>

      <LoadoutPresetBar />

      {/* Slots row. */}
      <div
        className="flex flex-wrap gap-1.5"
        role="group"
        aria-label={t("slotsLabel")}
      >
        {slots.map((slot) => {
          const skill = slot.skillId
            ? resolvedById.get(slot.skillId) ?? null
            : null;
          const unavailable = Boolean(slot.skillId) && skill === null;
          return (
            <EditableSkillSlot
              key={slot.index}
              slot={slot}
              skill={skill}
              unavailable={unavailable}
              focused={focusedIndex === slot.index}
              capturing={
                capturing?.index === slot.index ? capturing.mode : null
              }
              onFocusSlot={() => setFocusedIndex(slot.index)}
              onDropPayload={(payload) => handleDrop(slot.index, payload)}
              onCaptureKey={() => startCaptureKey(slot.index)}
              onCaptureButton={() => startCaptureButton(slot.index)}
              onClearKey={() => {
                if (loadout) setSlotKey(loadout.id, slot.index, null);
                announce(t("announceKeyCleared", { slot: slot.index + 1 }));
              }}
              onClearButton={() => {
                if (loadout) setSlotGamepadButton(loadout.id, slot.index, null);
                announce(t("announceButtonCleared", { slot: slot.index + 1 }));
              }}
            />
          );
        })}
      </div>

      {/* Trash drop zone — drop a slot here to clear it. */}
      <div
        ref={trashRef}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("application/x-ados-skill")) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
          }
        }}
        onDrop={(e) => {
          const raw = e.dataTransfer.getData("application/x-ados-skill");
          if (!raw) return;
          try {
            handleClearDrop(JSON.parse(raw) as SkillDragPayload);
          } catch {
            // Malformed payload — ignore.
          }
          e.preventDefault();
        }}
        className="flex items-center justify-center border border-dashed border-border-default/60 py-2 text-[10px] uppercase tracking-wide text-text-tertiary"
      >
        {t("dropToClear")}
      </div>

      {/* Drawer. */}
      <div className="border-t border-border-default pt-2">
        <SkillDrawer
          droneId={selectedId}
          boundSkillIds={boundSkillIds}
          onPickSkill={handlePickSkill}
        />
      </div>

      {/* Actions. */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border-default pt-2">
        <Button
          variant="secondary"
          size="sm"
          icon={<Gamepad2 size={12} />}
          onClick={handleApplyControllerDefaults}
        >
          {t("applyControllerDefaults")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<RotateCcw size={12} />}
          onClick={handleReset}
        >
          {t("resetToDefaults")}
        </Button>
      </div>

      {/* Cockpit layout: which chrome cards the active loadout shows. */}
      <CockpitLayoutEditor />

      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}
