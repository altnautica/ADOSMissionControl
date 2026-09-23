/**
 * @module plugins/registry-row
 * @description The plugin registry catalog row the per-drone Plugins tab
 * renders, shared by the live registry grid and the demo catalog fixture.
 * @license GPL-3.0-only
 */

import type { PluginTargetProfile } from "./types";

export type RegistryCategory = "drivers" | "ui" | "ai" | "telemetry" | "tools";

export interface RegistryPluginRow {
  _id: string;
  plugin_id: string;
  name: string;
  description: string;
  category: RegistryCategory;
  license: string;
  author_id: string;
  verified_publisher: boolean;
  latest_version: string;
  icon_url?: string;
  /** A declared named icon (shared icon vocabulary, e.g. "camera"). When the
   * catalog carries one it drives the preview glyph; otherwise the card's
   * per-plugin fallback map (then the category glyph) applies. */
  icon?: string;
  tier?: "first_party" | "verified" | "community";
  /** Node profiles the plugin's agent half targets (`drone` /
   * `ground-station` / `workstation`), denormalized from the manifest. Absent
   * on older catalog rows, which are treated as drone-only by
   * `pluginMatchesProfile`, so a drone-targeting plugin is not offered on a
   * ground-station or workstation node. */
  target_profiles?: PluginTargetProfile[];
}
