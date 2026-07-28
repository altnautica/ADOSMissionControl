/**
 * @module node-detail/agent/agent-redirect
 * @description Deep-link / persisted-tab migration for the Agent page. The
 * companion-computer tabs (plus Perception and Link, and the legacy Flights /
 * Black Box) used to be top-level tabs and now live inside the Agent page, so a
 * persisted or Cmd+K jump to one of those ids resolves the top tab to "agent"
 * and opens that sub-page. Pure logic so it is unit-testable away from the panel.
 * @license GPL-3.0-only
 */

/** Former top-level tab id -> Agent sub-page id. Legacy Flights/Black Box map
 * to the merged Logs sub-page; the retired Settings tab lands on the first
 * configuration page now that the settings pages sit directly in the Agent
 * sidebar and no `settings` host page exists to land on. */
export const AGENT_SUBPAGE_IDS: Record<string, string> = {
  system: "system",
  settings: "profile",
  plugins: "plugins",
  logs: "logs",
  radio: "radio",
  vision: "vision",
  "world-model": "world-model",
  "live-world": "live-world",
  flights: "logs",
  blackbox: "logs",
};

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
