/**
 * @module node-detail/agent/agent-redirect
 * @description Deep-link / persisted-tab migration for the node-detail strip.
 *
 * Two kinds of move have to keep resolving. Some former top-level tabs now
 * live INSIDE the Agent page (the companion-computer surfaces, Perception and
 * the air-side Link), so their ids resolve the top tab to "agent" and open
 * that sub-page. Others were merged with a sibling and still exist at top
 * level under a different id (Distributed RX folded into Mesh & RX, the legacy
 * Flights and Black Box into Logs), so their ids resolve to the survivor.
 *
 * Pure logic so it is unit-testable away from the panel.
 * @license GPL-3.0-only
 */

/** Former top-level tab id -> Agent sub-page id. The retired Settings tab
 * lands on the first configuration page now that the settings pages sit
 * directly in the Agent sidebar and no `settings` host page exists. */
export const AGENT_SUBPAGE_IDS: Record<string, string> = {
  system: "system",
  settings: "profile",
  plugins: "plugins",
  radio: "radio",
  vision: "vision",
};

/**
 * Former top-level tab id -> the top-level surface that absorbed it. Applied
 * BEFORE the Agent redirect, so a retired id lands on its survivor rather
 * than being pushed into the Agent page.
 */
export const TOP_LEVEL_ALIASES: Record<string, string> = {
  // Mesh and Distributed RX are one "Mesh & RX" surface.
  distributedRx: "mesh",
  // Logs is a top-level surface on every profile; Flights and Black Box were
  // always views of it.
  flights: "logs",
  blackbox: "logs",
};

/**
 * The top-level surface a requested id resolves to on this profile.
 *
 * Returns the id unchanged when the profile still offers it (so a profile that
 * kept an id under its own meaning is never rewritten), otherwise the alias if
 * the profile offers that.
 */
export function topLevelAlias(
  activeTab: string,
  surfaceIds: string[],
): string {
  if (surfaceIds.includes(activeTab)) return activeTab;
  const alias = TOP_LEVEL_ALIASES[activeTab];
  return alias && surfaceIds.includes(alias) ? alias : activeTab;
}

/**
 * The Agent sub-page a would-be top tab maps to, or null if it stays top-level.
 * Guarded on the current profile's visible top-level ids so a profile that still
 * owns the id at top level (the ground-station Radio tab) is never captured.
 */
export function agentRedirect(
  activeTab: string,
  surfaceIds: string[],
): string | null {
  if (surfaceIds.includes(activeTab)) return null;
  return AGENT_SUBPAGE_IDS[activeTab] ?? null;
}
