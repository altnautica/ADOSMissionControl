/**
 * @module api/ground-station/pair-source
 * @description Resolves the client the Pair modal installs a drone's fleet key
 * through.
 *
 * Off demo this is exactly `groundStationApiFromAgent`. In demo that returns
 * null (the demo agent URL has no ground-station REST endpoint), so the demo
 * installs an in-memory pair client here instead; it lives under `src/mock/`
 * and reaches this module only through the demo seed, so no production path
 * imports demo data.
 * @license GPL-3.0-only
 */

import { isDemoMode } from "@/lib/utils";
import { groundStationApiFromAgent, type GroundStationApi } from "../ground-station-api";

let demoPairApi: GroundStationApi | null = null;

/** Install (or clear) the demo pair client. Called only by the demo seed. */
export function setDemoPairApi(api: GroundStationApi | null): void {
  demoPairApi = api;
}

/**
 * @returns The pair client for this agent connection: the demo pair client in
 *   demo mode, else the agent's ground-station REST client. Null with no agent
 *   URL, like `groundStationApiFromAgent`.
 */
export function pairApiFromAgent(
  agentUrl: string | null,
  apiKey: string | null,
): GroundStationApi | null {
  if (!agentUrl) return null;
  // DEMO-MODE BRANCH (gated on isDemoMode, real fleets unaffected).
  if (isDemoMode()) return demoPairApi;
  return groundStationApiFromAgent(agentUrl, apiKey);
}
