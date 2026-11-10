/**
 * @module cockpit/nav-source-text
 * @description The navigation-source chip and popover words, from the shared
 * cockpit spec (`nav_source.*`). Spec text is sentence case; the chip draws
 * it in capitals through CSS.
 *
 * @license GPL-3.0-only
 */

import { specString } from "@/lib/cockpit/spec-strings";
import type { GpsFixWord, NavQuality, NavSourceResult } from "@/lib/hud/nav-source";

/** `noFix` → `no_fix`: the spec's keys are snake case. */
function snakeKey(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/** Spec text for a GPS fix word; no fix reads the spec's "No fix". */
export function navFixText(fix: GpsFixWord): string {
  return fix === "none" ? specString("alert.gps_no_3d.no_fix") : specString(`nav_source.fix.${snakeKey(fix)}`);
}

/** Spec text for a nav quality word. */
export function navQualityText(q: NavQuality): string {
  return specString(`nav_source.q.${snakeKey(q)}`);
}

/** Chip label and quality word for a resolved source. */
export function navSourceText(r: NavSourceResult): { label: string; word: string | null } {
  const word = r.quality ? navQualityText(r.quality) : null;
  switch (r.kind) {
    case "stale":
      return { label: specString("nav_source.stale"), word: null };
    case "dr":
      return { label: specString("nav_source.dr"), word };
    case "ext":
      return { label: specString("nav_source.ext_nav"), word };
    case "flow":
      return { label: specString("nav_source.flow"), word };
    case "gps": {
      const fix = navFixText(r.fix ?? "none");
      return {
        label: r.sats !== undefined
          ? specString("nav_source.chip_gps", { fix, sats: r.sats })
          : specString("nav_source.chip_gps_no_sats", { fix }),
        word,
      };
    }
  }
}
