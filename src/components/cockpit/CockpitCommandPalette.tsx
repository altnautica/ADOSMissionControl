"use client";

/**
 * @module fly/CockpitCommandPalette
 * @description A searchable command palette over the SAME Skill registry the
 * Skill Bar reads — one place to find and fire any command available on the
 * selected drone (built-in Arm/RTH/Land/Mode + plugin behaviors), without
 * hunting the bar or remembering a chord. It is a pure projection: it resolves
 * the drone's skills, shows each skill's live state (a disabled skill is greyed
 * with its real reason, never hidden), and fires the chosen one through the
 * shared {@link activate} pipeline so confirm / arm-gating / idempotency are
 * identical to every other trigger path (the palette asserts no state
 * of its own).
 *
 * @license GPL-3.0-only
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useTranslations } from "next-intl";
import { Command, Search } from "lucide-react";

import {
  activate,
  buildSkillContext,
  useSkillRegistry,
  type Skill,
  type SkillState,
} from "@/lib/skills";
import { skillDisplayLabel, skillEffectText } from "@/lib/skills/skill-label";
import { resolveSkillIcon } from "@/lib/skills/skill-icon";
import { useSettingsStore } from "@/stores/settings-store";
import { DEFAULT_LOADOUT_ID } from "@/stores/settings/keybindings-slice";
import { cn } from "@/lib/utils";

const IDLE: SkillState = { kind: "idle" };

interface CockpitCommandPaletteProps {
  droneId: string;
  onClose: () => void;
}

interface Row {
  skill: Skill;
  state: SkillState;
  label: string;
  effect: string;
  /** The bound keyboard chord for this skill on the active loadout, if any. */
  hotkey: string | null;
}

export function CockpitCommandPalette({
  droneId,
  onClose,
}: CockpitCommandPaletteProps) {
  const t = useTranslations("commandPalette");
  const tRoot = useTranslations();
  const inputRef = useRef<HTMLInputElement>(null);

  // Subscribe to the registry so the list + per-skill state stay live while the
  // palette is open (a skill enabling/disabling re-renders the rows).
  const registrySkills = useSkillRegistry((s) => s.skills);
  const registryStates = useSkillRegistry((s) => s.states);
  const resolveForDrone = useSkillRegistry((s) => s.resolveForDrone);

  const loadouts = useSettingsStore((s) => s.loadouts);
  const activeLoadoutId = useSettingsStore((s) => s.activeLoadoutId);
  const loadout = loadouts[activeLoadoutId] ?? loadouts[DEFAULT_LOADOUT_ID];

  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);

  const rows = useMemo<Row[]>(() => {
    if (!droneId) return [];
    const skills = resolveForDrone(droneId);
    const stateMap = registryStates.get(droneId);
    // Map each skill id to its bound chord (for the row's hotkey hint).
    const chordOf = new Map<string, string>();
    for (const slot of loadout?.slots ?? []) {
      if (slot.skillId && slot.key) chordOf.set(slot.skillId, slot.key);
    }
    return skills.map((skill) => ({
      skill,
      state: stateMap?.get(skill.id) ?? IDLE,
      label: skillDisplayLabel(skill, tRoot),
      effect: skillEffectText(skill, tRoot),
      hotkey: chordOf.get(skill.id) ?? null,
    }));
    // registrySkills is a dep so a register/unregister re-resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [droneId, resolveForDrone, registrySkills, registryStates, loadout, tRoot]);

  const filtered = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.label.toLowerCase().includes(q) ||
        r.effect.toLowerCase().includes(q) ||
        r.skill.id.toLowerCase().includes(q),
    );
  }, [rows, query]);

  // Keep the highlight in range as the filtered set shrinks/grows.
  useEffect(() => {
    setHighlight((h) => (filtered.length === 0 ? 0 : Math.min(h, filtered.length - 1)));
  }, [filtered.length]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const run = useCallback(
    (row: Row | undefined) => {
      if (!row || !droneId) return;
      // Close first so a skill that opens a confirm dialog (app-level host)
      // shows over the cockpit, not under the palette. `activate` still routes
      // through confirm / arm-gating / the reason toast for a disabled skill.
      onClose();
      void activate(row.skill.id, buildSkillContext(droneId));
    },
    [droneId, onClose],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlight((h) => (filtered.length ? (h + 1) % filtered.length : 0));
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlight((h) =>
          filtered.length ? (h - 1 + filtered.length) % filtered.length : 0,
        );
        break;
      case "Enter":
        e.preventDefault();
        run(filtered[highlight]);
        break;
      case "Escape":
        e.preventDefault();
        // Own Escape while the palette is open so it never falls through to the
        // shell's immersive-exit handler.
        e.stopPropagation();
        onClose();
        break;
      default:
        break;
    }
  };

  return (
    <div
      className="absolute inset-0 z-50 flex items-start justify-center bg-scrim/50 p-4 pt-[12vh] backdrop-blur-sm"
      onMouseDown={(e) => {
        // Click on the dimmer (not the dialog) closes.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("title")}
        className="w-full max-w-lg overflow-hidden rounded-lg border border-border-default bg-bg-secondary shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-border-default px-3 py-2">
          <Search size={15} className="flex-none text-text-tertiary" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("placeholder")}
            aria-label={t("title")}
            className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none"
          />
          <Command size={13} className="flex-none text-text-tertiary" aria-hidden="true" />
        </div>

        <ul role="listbox" aria-label={t("title")} className="max-h-[46vh] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <li className="px-3 py-6 text-center text-xs text-text-tertiary">
              {rows.length === 0 ? t("empty") : t("noResults")}
            </li>
          ) : (
            filtered.map((row, i) => {
              const Icon = resolveSkillIcon(row.skill.icon);
              const disabled = row.state.kind === "disabled";
              const reason =
                disabled && row.state.reason
                  ? safeTranslate(tRoot, row.state.reason)
                  : null;
              const active = i === highlight;
              return (
                <li key={row.skill.id} role="option" aria-selected={active}>
                  <button
                    type="button"
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => run(row)}
                    className={cn(
                      "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors",
                      active ? "bg-accent-primary/10" : "hover:bg-bg-tertiary/60",
                    )}
                  >
                    <Icon
                      size={16}
                      className={cn(
                        "flex-none",
                        disabled ? "text-text-tertiary" : "text-accent-primary",
                      )}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block truncate text-sm",
                          disabled ? "text-text-tertiary" : "text-text-primary",
                        )}
                      >
                        {row.label}
                      </span>
                      <span className="block truncate text-[11px] text-text-tertiary">
                        {reason ?? row.effect}
                      </span>
                    </span>
                    {row.state.kind === "active" && (
                      <span className="flex-none rounded bg-status-success/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-status-success">
                        {tRoot("skills.state.active")}
                      </span>
                    )}
                    {row.hotkey && (
                      <kbd className="flex-none rounded border border-border-default bg-bg-tertiary px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">
                        {row.hotkey}
                      </kbd>
                    )}
                  </button>
                </li>
              );
            })
          )}
        </ul>

        <div className="border-t border-border-default px-3 py-1.5 text-center text-[10px] text-text-tertiary">
          {t("hint")}
        </div>
      </div>
    </div>
  );
}

function safeTranslate(
  t: ReturnType<typeof useTranslations>,
  key: string,
): string {
  try {
    return t(key);
  } catch {
    return key;
  }
}
