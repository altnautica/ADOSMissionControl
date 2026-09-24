/**
 * @module AgentConnectionLink
 * @description The slice of the agent connection that the per-domain agent
 * stores (system, peripherals, fleet network) need for their fetches: the
 * current client, whether the session is cloud-relayed, the fetch verdicts and
 * the cloud command queue. A leaf module: the connection store binds itself
 * here when it is created, and the domain stores read it from here, so those
 * stores never import the connection store that writes them.
 * @license GPL-3.0-only
 */

import type { AgentConnectionStore } from "./types";

export type AgentConnectionLink = Pick<
  AgentConnectionStore,
  "client" | "cloudMode" | "noteFetchSuccess" | "noteFetchFailure" | "sendCloudCommand"
>;

let readLink: (() => AgentConnectionLink) | null = null;

/** Called once by the connection store at creation. */
export function bindAgentConnectionLink(read: () => AgentConnectionLink): void {
  readLink = read;
}

/** The connection as it is now, or null before the connection store exists
 * (no store means no client, so every fetch is a no-op). */
export function agentConnectionLink(): AgentConnectionLink | null {
  return readLink ? readLink() : null;
}

/**
 * True when `client` is still the connection's client. A fetch that settles
 * after a node switch or a disconnect answered for a node the operator left,
 * so neither its payload nor its success/failure verdict may land.
 */
export function isCurrentAgentClient(client: unknown): boolean {
  return agentConnectionLink()?.client === client;
}
