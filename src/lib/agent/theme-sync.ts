/**
 * @module ThemeSync
 * @description Pushes the operator's theme preference to every paired
 * agent. Used at the end of the onboarding flow so the LCD on each
 * companion board matches the desktop choice the user just made.
 *
 * Each push goes to the agent's local IP via a fresh AgentClient (the
 * shared `useAgentConnectionStore` only tracks one live connection at a
 * time). Failures are isolated: one unreachable agent never blocks
 * another from receiving the update.
 *
 * @license GPL-3.0-only
 */

import { AgentClient } from "@/lib/agent/client";
import type { PairedDrone } from "@/stores/pairing-store";
import { isDemoMode } from "@/lib/utils";

export type AgentTheme = "dark" | "light";

export interface ThemeSyncResult {
  /** Number of agents we tried to push to (drones with reachable URLs). */
  attempted: number;
  /** Number of agents that accepted the new theme. */
  succeeded: number;
  /** Per-drone failures: deviceId -> error message. */
  failures: Map<string, string>;
}

/**
 * Build the best-known base URL for a paired drone. mDNS host is
 * preferred (stable across DHCP renewals); falls back to the last-seen
 * IP. Returns null when neither is available.
 */
function resolveBaseUrl(drone: PairedDrone): string | null {
  if (drone.mdnsHost) {
    const host = drone.mdnsHost.endsWith(".local")
      ? drone.mdnsHost
      : `${drone.mdnsHost}.local`;
    return `http://${host}:8080`;
  }
  if (drone.lastIp) {
    return `http://${drone.lastIp}:8080`;
  }
  return null;
}

/**
 * Push `themeMode` to every paired agent. Per-agent failures are
 * captured in the result and don't abort the rest of the broadcast.
 */
export async function pushThemeToAllAgents(
  drones: ReadonlyArray<PairedDrone>,
  theme: AgentTheme,
  options?: {
    /** Inject a client factory in tests so we don't burn real fetches. */
    clientFactory?: (baseUrl: string, apiKey: string | null) => AgentClient;
  },
): Promise<ThemeSyncResult> {
  // Demo nodes are simulated; a real HTTP push to them can only fail and
  // ended onboarding on a "could not reach" warning.
  if (isDemoMode()) return { attempted: 0, succeeded: 0, failures: new Map() };
  const factory = options?.clientFactory
    ?? ((baseUrl, apiKey) => new AgentClient(baseUrl, apiKey));

  const failures = new Map<string, string>();
  let succeeded = 0;
  let attempted = 0;

  await Promise.all(
    drones.map(async (drone) => {
      const baseUrl = resolveBaseUrl(drone);
      if (!baseUrl) return;
      attempted += 1;
      try {
        const client = factory(baseUrl, drone.apiKey ?? null);
        await client.applySetup({ ui: { theme } });
        succeeded += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown error";
        failures.set(drone.deviceId, msg);
      }
    }),
  );

  return { attempted, succeeded, failures };
}
