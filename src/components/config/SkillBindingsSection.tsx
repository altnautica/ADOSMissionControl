/**
 * The input-config Skill / Keyboard bindings section. Reads and writes the
 * ACTIVE loadout: a preset selector, a keyboard-bindings table (per non-empty
 * slot: skill label + chord + rebind capture + clear), a gamepad column on the
 * same rows (button + rebind capture + clear), and an "apply controller
 * defaults" action. This is the non-cockpit home for binding management, so the
 * live bindings here double as the self-documenting cheatsheet that the static
 * shortcuts panel used to be.
 *
 * Browser gamepad polling is started for this section so a captured button edge
 * is available even though the agent device list is polled separately.
 *
 * @module config/SkillBindingsSection
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Keyboard, Gamepad2, X, RotateCcw } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useSkillRegistry, type Skill } from "@/lib/skills";
import { skillDisplayLabel } from "@/lib/skills/skill-label";
import { formatChord } from "@/lib/skills/chord";
import { DEFAULT_LOADOUT_ID } from "@/stores/settings/keybindings-slice";
import type { HotbarSlot } from "@/stores/settings/keybindings-slice";
import { SKILL_BUTTON_DEFAULTS } from "@/lib/input/skill-button-defaults";
import { useKeyCapture, useButtonCapture } from "@/hooks/use-binding-capture";
import {
  startGamepadPolling,
  stopGamepadPolling,
} from "@/lib/input/gamepad-poller";
import { LoadoutPresetBar } from "@/components/cockpit/LoadoutPresetBar";

export function SkillBindingsSection() {
  const t = useTranslations("skillBindings");
  const tRoot = useTranslations();
  const { toast } = useToast();

  // A browser gamepad only reports while a poller runs, so this section starts
  // the reader for its "press a button" capture. It never starts the
  // manual-control stream: a keybinding panel must not open an RC override on
  // whatever aircraft happens to be connected.
  useEffect(() => {
    startGamepadPolling();
    return () => stopGamepadPolling();
  }, []);

  const selectedId = useDroneManager((s) => s.selectedDroneId);
  const loadouts = useSettingsStore((s) => s.loadouts);
  const activeLoadoutId = useSettingsStore((s) => s.activeLoadoutId);
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

  const labelForSlot = (slot: HotbarSlot): string => {
    if (!slot.skillId) return t("empty");
    const skill = resolvedById.get(slot.skillId);
    return skill ? skillDisplayLabel(skill, tRoot) : slot.skillId;
  };

  // Capture state shared by both columns: which slot + which mode is capturing.
  const [capturing, setCapturing] = useState<
    { index: number; mode: "key" | "button" } | null
  >(null);
  const [announcement, setAnnouncement] = useState("");

  const keyCapture = useKeyCapture({
    onCapture: (chord) => {
      const target = capturing;
      setCapturing(null);
      if (!target || !loadout) return;
      const prevHolder = loadout.slots.find(
        (s) => s.key === chord && s.index !== target.index,
      );
      setSlotKey(loadout.id, target.index, chord);
      if (prevHolder) {
        setAnnouncement(
          t("announceKeyReassigned", {
            key: formatChord(chord),
            label: labelForSlotIndex(target.index),
            previous: labelForSlotIndex(prevHolder.index),
          }),
        );
      } else {
        setAnnouncement(
          t("announceKeyBound", {
            key: formatChord(chord),
            label: labelForSlotIndex(target.index),
          }),
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
      setAnnouncement(
        t("announceButtonBound", {
          button,
          label: labelForSlotIndex(target.index),
        }),
      );
    },
  });

  const labelForSlotIndex = (index: number): string => {
    const slot = loadout?.slots.find((s) => s.index === index);
    return slot ? labelForSlot(slot) : t("empty");
  };

  const startKey = (index: number) => {
    buttonCapture.cancel();
    setCapturing({ index, mode: "key" });
    keyCapture.start();
  };
  const startButton = (index: number) => {
    keyCapture.cancel();
    setCapturing({ index, mode: "button" });
    buttonCapture.start();
  };

  const handleApplyDefaults = () => {
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
    setAnnouncement(t("controllerDefaultsApplied", { count: applied }));
  };

  const handleReset = () => {
    resetLoadoutToDefaults();
    toast(t("resetDone"), "success");
    setAnnouncement(t("resetDone"));
  };

  // Only non-empty slots appear in the bindings table; the live bindings are
  // self-documenting, replacing the static cheatsheet.
  const boundSlots = slots.filter((s) => s.skillId !== null);

  const isDefault = activeLoadoutId === DEFAULT_LOADOUT_ID;

  return (
    <section className="rounded border border-border-default bg-bg-secondary p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-medium text-text-primary">{t("title")}</h2>
        <div className="flex items-center gap-1">
          <Button
            variant="secondary"
            size="sm"
            icon={<Gamepad2 size={12} />}
            onClick={handleApplyDefaults}
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
      </div>

      <p className="mb-4 text-xs text-text-secondary">{t("configHint")}</p>

      <div className="mb-4">
        <LoadoutPresetBar />
      </div>

      {boundSlots.length === 0 ? (
        <p className="py-4 text-center text-sm text-text-secondary">
          {isDefault ? t("noBindings") : t("noBindingsPreset")}
        </p>
      ) : (
        <div className="overflow-hidden rounded border border-border-default">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg-tertiary text-xs uppercase tracking-wide text-text-secondary">
                <tr>
                  <th className="px-3 py-2 text-left">{t("colSkill")}</th>
                  <th className="px-3 py-2 text-left">{t("colKey")}</th>
                  <th className="px-3 py-2 text-left">{t("colButton")}</th>
                </tr>
              </thead>
              <tbody>
                {boundSlots.map((slot) => {
                  const chordLabel = slot.key ? formatChord(slot.key) : null;
                  const capKey =
                    capturing?.index === slot.index &&
                    capturing.mode === "key";
                  const capBtn =
                    capturing?.index === slot.index &&
                    capturing.mode === "button";
                  return (
                    <tr
                      key={slot.index}
                      className="border-t border-border-default"
                    >
                      <td className="px-3 py-2 text-text-primary">
                        {labelForSlot(slot)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => startKey(slot.index)}
                            aria-label={
                              chordLabel
                                ? t("rebindKeyFrom", { key: chordLabel })
                                : t("captureKey")
                            }
                            className={cn(
                              "flex items-center gap-1 border px-2 py-0.5 text-xs font-mono",
                              "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary",
                              capKey
                                ? "border-accent-primary text-accent-primary motion-safe:animate-pulse"
                                : "border-border-default text-text-secondary hover:border-accent-primary",
                            )}
                          >
                            <Keyboard size={11} aria-hidden="true" />
                            <span>
                              {capKey
                                ? t("pressKey")
                                : (chordLabel ?? t("noKey"))}
                            </span>
                          </button>
                          {slot.key ? (
                            <button
                              type="button"
                              onClick={() =>
                                loadout &&
                                setSlotKey(loadout.id, slot.index, null)
                              }
                              aria-label={t("clearKey")}
                              className="text-text-tertiary hover:text-status-error focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
                            >
                              <X size={12} aria-hidden="true" />
                            </button>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => startButton(slot.index)}
                            aria-label={
                              slot.gamepadButton !== null
                                ? t("rebindButtonFrom", {
                                    button: slot.gamepadButton,
                                  })
                                : t("captureButton")
                            }
                            className={cn(
                              "flex items-center gap-1 border px-2 py-0.5 text-xs font-mono",
                              "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary",
                              capBtn
                                ? "border-accent-primary text-accent-primary motion-safe:animate-pulse"
                                : "border-border-default text-text-secondary hover:border-accent-primary",
                            )}
                          >
                            <Gamepad2 size={11} aria-hidden="true" />
                            <span>
                              {capBtn
                                ? t("pressButton")
                                : slot.gamepadButton !== null
                                  ? t("buttonN", { button: slot.gamepadButton })
                                  : t("noButton")}
                            </span>
                          </button>
                          {slot.gamepadButton !== null ? (
                            <button
                              type="button"
                              onClick={() =>
                                loadout &&
                                setSlotGamepadButton(
                                  loadout.id,
                                  slot.index,
                                  null,
                                )
                              }
                              aria-label={t("clearButton")}
                              className="text-text-tertiary hover:text-status-error focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
                            >
                              <X size={12} aria-hidden="true" />
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </section>
  );
}
