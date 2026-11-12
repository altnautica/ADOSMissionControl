/**
 * Resolve a skill's display label + one-line effect for the bar and slots.
 *
 * A built-in the shared cockpit spec lists is named by the spec
 * (`builtins.json` `label`), the same words on every surface. A built-in
 * only this app has carries an i18n key ROOT in `label` (e.g.
 * `"skills.arm"`); its name lives at `<root>.label` and its effect at
 * `<root>.effect`. A plugin skill's label is a key into the extension's own
 * locale bundle (resolved there first), an app key, or a literal; an
 * unresolved key is humanized, never shown raw.
 *
 * @module skills/skill-label
 * @license GPL-3.0-only
 */

import { SPEC_BUILTINS } from "@/lib/cockpit/spec-builtins";
import { pluginSkillString } from "./plugin-skill-strings";
import type { Skill } from "./types";

/** The spec's built-in names, by skill id. */
const SPEC_LABEL: Readonly<Record<string, string>> = Object.fromEntries(SPEC_BUILTINS.map((b) => [b.id, b.label]));

type Translate = ((key: string, values?: Record<string, string | number>) => string) & {
  has?: (key: string) => boolean;
};

/** The display name for a skill. */
export function skillDisplayLabel(skill: Skill, t: Translate): string {
  if (skill.source === "plugin") {
    // The extension's own bundle first, then the app catalogue; a key neither
    // carries is humanized. Never with ".label" appended.
    return pluginSkillString(skill.pluginId, skill.label) ?? safeTranslateOrLiteral(skill.label, t);
  }
  return SPEC_LABEL[skill.id] ?? t(`${skill.label}.label`);
}

/**
 * Resolve a contribution's display label for surfaces that render a plugin's
 * declared label directly (the install pop-up, the plugin cards) WITHOUT a
 * translate function. A plugin often ships its label as a key into its OWN
 * bundle catalog (e.g. `"skill.track"`) that the GCS next-intl catalog cannot
 * resolve — rather than leak the raw key, humanize the last dotted segment
 * (`"skill.track"` -> "Track", `"camera.zoom_in"` -> "Zoom In"). A human label
 * that already contains a space or capital is passed through untouched.
 */
export function resolveContribLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return trimmed;
  // Looks like a display string already (has whitespace or a capital letter).
  if (/\s/.test(trimmed) || /[A-Z]/.test(trimmed)) return trimmed;
  // Dotted lowercase identifier key -> humanize the last segment.
  if (/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(trimmed)) {
    const last = trimmed.split(".").pop() ?? trimmed;
    return humanize(last);
  }
  // A bare lowercase token/id -> humanize it too.
  if (/^[a-z][a-z0-9_-]*$/.test(trimmed)) return humanize(trimmed);
  return trimmed;
}

function humanize(token: string): string {
  return token
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** The one-line effect text for a skill, or "" when none (plugin skills). */
export function skillEffectText(skill: Skill, t: Translate): string {
  if (skill.source === "plugin") return "";
  return t(`${skill.label}.effect`);
}

function safeTranslateOrLiteral(value: string, t: Translate): string {
  if (!value.includes(".")) return value;
  if (t.has && !t.has(value)) return resolveContribLabel(value);
  try {
    return t(value);
  } catch {
    return resolveContribLabel(value);
  }
}
