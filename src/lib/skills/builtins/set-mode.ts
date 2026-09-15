/**
 * The parameterised mode-change skill behind the flight-mode dropdown.
 *
 * The dropdown offers every mode the airframe's firmware family defines, which
 * is far more than the five one-press presets in `./modes`. It used to call
 * `protocol.setFlightMode` directly and, with no protocol, write the chosen mode
 * into the local drone store — so the mode label changed and a "Mode changed"
 * toast fired for a command that was never transmitted. Routing it here puts it
 * behind the same dispatcher every other flight action uses: the no-link gate,
 * the debounce, and the explicit surfacing of a refusal the vehicle returns.
 *
 * Not bindable: a mode change is meaningless without the mode, so this takes no
 * bar slot and no key binding. The presets in `./modes` are what bind.
 *
 * @module skills/builtins/set-mode
 * @license GPL-3.0-only
 */

import type { Skill } from "../types";
import { disabledIfNoLink, REASON } from "./_shared";

export const setModeSkill: Skill = {
  id: "set-mode",
  label: "skills.setMode",
  icon: "ListFilter",
  category: "flight",
  source: "builtin",
  toggle: false,
  bindable: false,
  armRequirement: "any",
  getState: (ctx) => disabledIfNoLink(ctx) ?? { kind: "idle" },
  activate: async (ctx, args) => {
    const target = args?.targetMode;
    if (!target) {
      return {
        success: false,
        resultCode: -1,
        message: REASON.modeUnavailable,
      };
    }
    // Refuse a mode this firmware does not offer rather than sending it and
    // letting it fail silently. An empty list means the GCS has no firmware
    // handler to ask, which is not evidence the mode is unavailable.
    if (
      ctx.availableModes.length > 0 &&
      !ctx.availableModes.includes(target)
    ) {
      return {
        success: false,
        resultCode: -1,
        message: REASON.modeUnavailable,
      };
    }
    // The vehicle's own answer goes back to the dispatcher, which surfaces a
    // refusal. Nothing writes the mode locally: the mode label moves when a
    // heartbeat reports the vehicle in it, and not before.
    return ctx.protocol?.setFlightMode(target);
  },
};
