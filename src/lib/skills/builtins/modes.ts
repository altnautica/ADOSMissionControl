/**
 * Mode-preset skills — one-press shortcuts to the common flight modes. Each
 * preset is its own Skill with a baked target mode (not one parameterized
 * skill), so it binds to its own slot/key. A preset reports disabled when the
 * connected firmware does not offer its mode. One-shot, any arm state, no
 * confirm.
 *
 * @module skills/builtins/modes
 * @license GPL-3.0-only
 */

import type { Skill } from "../types";
import type { UnifiedFlightMode } from "@/lib/protocol/types";
import { disabledIfNoLink, REASON } from "./_shared";

interface ModePreset {
  id: string;
  label: string;
  icon: string;
  mode: UnifiedFlightMode;
}

const PRESETS: ModePreset[] = [
  { id: "mode.loiter", label: "skills.modeLoiter", icon: "LocateFixed", mode: "LOITER" },
  { id: "mode.althold", label: "skills.modeAltHold", icon: "MoveVertical", mode: "ALT_HOLD" },
  { id: "mode.stabilize", label: "skills.modeStabilize", icon: "Crosshair", mode: "STABILIZE" },
  { id: "mode.guided", label: "skills.modeGuided", icon: "Navigation", mode: "GUIDED" },
  { id: "mode.auto", label: "skills.modeAuto", icon: "Route", mode: "AUTO" },
];

function makeModeSkill(preset: ModePreset): Skill {
  return {
    id: preset.id,
    label: preset.label,
    icon: preset.icon,
    category: "flight",
    source: "builtin",
    toggle: false,
    armRequirement: "any",
    getState: (ctx) => {
      const noLink = disabledIfNoLink(ctx);
      if (noLink) return noLink;
      if (!ctx.availableModes.includes(preset.mode)) {
        return { kind: "disabled", reason: REASON.modeUnavailable };
      }
      return { kind: "idle" };
    },
    activate: async (ctx, args) => {
      // The preset bakes its own target mode; args.targetMode is an override
      // seam for a generic caller but defaults to the preset's mode. The
      // vehicle's answer goes back to the dispatcher, which surfaces a
      // refused mode change and spends nothing on it.
      const target = args?.targetMode ?? preset.mode;
      return ctx.protocol?.setFlightMode(target);
    },
  };
}

export const modeSkills: Skill[] = PRESETS.map(makeModeSkill);
