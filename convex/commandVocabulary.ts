/**
 * @module commandVocabulary
 * @description Single source of truth for the cloud-relay command names
 * the GCS may queue for an agent.
 *
 * The agent's dispatcher acts on a fixed set of command names. Accepting an
 * arbitrary string at the queue boundary lets a typo or a forged name land a
 * dead row that the agent silently ignores, and removes the one place where
 * the vocabulary can be reviewed. This module pins the permitted names so the
 * queue rejects anything outside the contract at insert time.
 *
 * Keep this list in lockstep with the agent's command handlers and the GCS
 * call sites that queue commands (the plugin lifecycle controls, the radio
 * pairing flow, and the on-demand status fetches).
 *
 * @license GPL-3.0-only
 */

import { v } from "convex/values";

/**
 * Every command name the GCS may enqueue for an agent over the cloud relay.
 *
 *  - `plugin.*`      — per-drone plugin lifecycle.
 *  - `wfb_pair_*`    — the WFB radio pairing handshake.
 *  - `get_*`         — on-demand pulls of a status surface.
 *  - `scan_peripherals` — trigger a peripheral re-scan.
 *  - `restart_service`  — restart one supervised service by name.
 *  - `send_command`     — pass a typed control command through to the agent.
 */
export const RELAY_COMMAND_NAMES = [
  "plugin.install",
  "plugin.enable",
  "plugin.disable",
  "plugin.uninstall",
  "wfb_pair_init_remote",
  "wfb_pair_apply_remote",
  "wfb_pair_unpair",
  "get_peripherals",
  "scan_peripherals",
  "get_enrollment",
  "get_peers",
  "get_services",
  "get_logs",
  "restart_service",
  "send_command",
] as const;

export type RelayCommandName = (typeof RELAY_COMMAND_NAMES)[number];

/**
 * Convex validator for the command-name discriminant. A union of string
 * literals so the queue rejects any name outside the contract before the
 * row is written. Built from the same array so adding a name in one place
 * keeps the validator and the type in sync.
 */
export const relayCommandValidator = v.union(
  ...RELAY_COMMAND_NAMES.map((name) => v.literal(name)),
);

/** The scope classes a credential can hold (matches the MCP server's scope model). */
export type RelayScopeClass = "read" | "safe_write" | "admin" | "flight" | "destructive";

/**
 * The minimum scope class a credential must hold to enqueue each relay command.
 * This is a defense-in-depth backstop for the direct-Convex path: `enqueue` is a
 * public action that takes the credential string, so anyone who copies a
 * credential can call it without the MCP server in the path. The MCP server
 * remains the fine-grained gate; this map ensures a stolen credential is still
 * bounded to its scopes at the queue boundary.
 *
 * Keyed by `RelayCommandName` so a new relay command without a scope class is a
 * compile error — this is the single guard that keeps the map from silently
 * drifting from `RELAY_COMMAND_NAMES`.
 */
export const RELAY_COMMAND_SCOPE: Record<RelayCommandName, RelayScopeClass> = {
  get_peripherals: "read",
  get_enrollment: "read",
  get_peers: "read",
  get_services: "read",
  get_logs: "read",
  scan_peripherals: "safe_write",
  "plugin.enable": "admin",
  "plugin.disable": "admin",
  "plugin.uninstall": "admin",
  "plugin.install": "admin",
  wfb_pair_init_remote: "admin",
  wfb_pair_apply_remote: "admin",
  wfb_pair_unpair: "admin",
  restart_service: "admin",
  send_command: "flight", // base class; the verb in args decides, see requiredScopeForCommand
};

/**
 * `send_command` carries a control command in `args` (`{ cmd, args }`) that the
 * agent posts verbatim to its `POST /api/command` route. That route acts on a
 * closed set of verbs (the `match` in `build_command`,
 * `crates/ados-control/src/routes/command.rs`, which lowercases `cmd` first) and
 * answers anything else with a 400. Every one of those verbs moves the vehicle or
 * changes what it is doing, so each requires the `flight` scope.
 *
 * An explicit allowlist rather than a name pattern: a pattern has to guess what a
 * flight verb looks like and silently under-classifies a verb it did not foresee.
 * Keep this map in lockstep with `build_command`.
 */
export const AGENT_CONTROL_VERB_SCOPE: Readonly<Record<string, RelayScopeClass>> = {
  arm: "flight",
  disarm: "flight",
  takeoff: "flight",
  land: "flight",
  rtl: "flight",
  killswitch: "flight",
  pausemission: "flight",
  resumemission: "flight",
  mode: "flight",
};

/**
 * The required scope class for a relay command given its arguments, or `null`
 * when the command must be refused outright: a `send_command` whose `cmd` is
 * absent, not a string, or not a verb the agent's control route accepts. Such a
 * row could only be rejected by the agent, so no credential may queue it.
 */
export function requiredScopeForCommand(
  command: RelayCommandName,
  args: unknown,
): RelayScopeClass | null {
  if (command === "send_command") {
    const cmd = (args as { cmd?: unknown } | null | undefined)?.cmd;
    if (typeof cmd !== "string") return null;
    const verb = cmd.toLowerCase();
    // Own-key check so an inherited name ("constructor", "toString") is not a verb.
    if (!Object.prototype.hasOwnProperty.call(AGENT_CONTROL_VERB_SCOPE, verb)) return null;
    return AGENT_CONTROL_VERB_SCOPE[verb];
  }
  return RELAY_COMMAND_SCOPE[command];
}
