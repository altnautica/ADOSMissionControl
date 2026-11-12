/**
 * The locale bundles of the extensions whose Skills are registered, by
 * plugin id. An extension ships its Skill labels as keys into its own
 * `gcs.locales` bundle (`skill.fireRangefinder`), which the app's catalogue
 * cannot resolve; the skill host loads each bundle once and the label
 * resolver reads it here.
 *
 * @module skills/plugin-skill-strings
 * @license GPL-3.0-only
 */

import { create } from "zustand";

import type { PluginLocaleBundle } from "@/lib/plugins/plugin-locale";

interface PluginSkillStringsState {
  byPlugin: Readonly<Record<string, PluginLocaleBundle>>;
  set: (pluginId: string, bundle: PluginLocaleBundle) => void;
}

export const usePluginSkillStrings = create<PluginSkillStringsState>((set) => ({
  byPlugin: {},
  set: (pluginId, bundle) => set((s) => ({ byPlugin: { ...s.byPlugin, [pluginId]: bundle } })),
}));

/** The extension's word for `key`, or null when its bundle has none. */
export function pluginSkillString(pluginId: string | undefined, key: string): string | null {
  if (!pluginId) return null;
  const bundle = usePluginSkillStrings.getState().byPlugin[pluginId];
  return bundle && Object.prototype.hasOwnProperty.call(bundle, key) ? bundle[key] : null;
}
