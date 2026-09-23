/**
 * @module useRegistryCompatibility
 * @description Compares a registry plugin version's compatibility
 * envelope (agent version range, supported board list) against the
 * install target's own reported version and board (see
 * `useInstallTargetHost`). The card uses the result to gate its Install
 * button: a non-compatible card surfaces a one-liner reason instead of
 * letting the operator push an archive the agent will refuse.
 *
 * `semver` is not a project dependency so the version comparator
 * here is a hand-rolled numeric major/minor/patch check. The
 * registry only stores `MAJOR.MINOR.PATCH` strings; pre-release and
 * build metadata are intentionally ignored.
 *
 * @license GPL-3.0-only
 */

"use client";

import { useInstallTargetHost } from "./use-install-target-host";

export interface RegistryPluginVersion {
  agent_min_version: string;
  agent_max_version?: string;
  supported_boards?: readonly string[];
}

export interface CompatResult {
  /** True when the drone meets every gate. */
  compatible: boolean;
  /** Why the install would be blocked, when `compatible` is false. */
  reason?: "version" | "board" | "no_agent";
  /** Operator-facing detail for the failure case. */
  detail?: string;
}

/**
 * Parse a numeric semver triple into `[major, minor, patch]`. Returns
 * null for input that does not match the registry's
 * MAJOR.MINOR.PATCH constraint.
 */
function parseTriple(version: string): [number, number, number] | null {
  // Strip any pre-release / build suffix; the registry's loose semver
  // regex permits them but the comparator only cares about the
  // numeric prefix.
  const trimmed = version.split(/[-+]/)[0]?.trim() ?? "";
  const parts = trimmed.split(".");
  if (parts.length !== 3) return null;
  const triple: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    triple.push(Number(part));
  }
  return [triple[0], triple[1], triple[2]];
}

/**
 * Compare two MAJOR.MINOR.PATCH versions. Returns negative when `a`
 * is older, positive when `a` is newer, zero when equal. Throws when
 * either input fails to parse so the caller treats it as a hard
 * compatibility error instead of silently passing the gate.
 */
function compareVersions(a: string, b: string): number {
  const ta = parseTriple(a);
  const tb = parseTriple(b);
  if (!ta || !tb) {
    throw new Error(`Unparseable version: "${ta ? b : a}"`);
  }
  for (let i = 0; i < 3; i += 1) {
    if (ta[i] !== tb[i]) return ta[i] - tb[i];
  }
  return 0;
}

export function useRegistryCompatibility(
  version: RegistryPluginVersion,
  options?: {
    /** Rendering context the copy should address. `"node"` (default): a
     * single connected drone — "Connect to a drone...". `"settings"`: the
     * fleet-wide overview with no single node context — "Select a node
     * to install on." instead. */
    surface?: "node" | "settings";
    /** Device id of the node the install would land on. */
    deviceId?: string | null;
  },
): CompatResult {
  const host = useInstallTargetHost(options?.deviceId);
  const agentVersion = host?.agentVersion;
  const boardName = host?.boardName;
  // SoC is the second identifier a plugin author can target. A
  // manifest that declares `supported_boards: ["rk3582"]` should
  // match every board running that chip, regardless of the
  // marketing-name slug.
  const boardSoc = host?.boardSoc;

  // The target has not reported its version yet. The card stays
  // interactable from a browsing perspective, but Install is gated.
  if (!agentVersion) {
    return {
      compatible: false,
      reason: "no_agent",
      detail:
        options?.surface === "settings"
          ? "Select a node to install on."
          : "Connect to a drone to install plugins.",
    };
  }

  // (1) Version gate. The registry guarantees agent_min_version is
  // MAJOR.MINOR.PATCH; we still defend against malformed strings by
  // catching the comparator throw and surfacing it as a version
  // mismatch.
  try {
    if (compareVersions(agentVersion, version.agent_min_version) < 0) {
      return {
        compatible: false,
        reason: "version",
        detail: version.agent_min_version,
      };
    }
    if (
      version.agent_max_version &&
      compareVersions(agentVersion, version.agent_max_version) > 0
    ) {
      return {
        compatible: false,
        reason: "version",
        detail: version.agent_max_version,
      };
    }
  } catch (err) {
    return {
      compatible: false,
      reason: "version",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  // (2) Board gate. `supported_boards` is optional; when omitted the
  // plugin claims universal board support. When set, we check the board
  // name and SoC the target reports (name `"Radxa ROCK 5C Lite"`, SoC
  // `"rk3582"`). Matching on SoC also means a SoC-portable plugin works
  // on every board sharing that chip without listing each board.
  if (version.supported_boards && version.supported_boards.length > 0) {
    const supported = new Set(
      version.supported_boards.map((b) => b.toLowerCase()),
    );
    const candidates = [boardName, boardSoc]
      .filter((s): s is string => !!s)
      .map((s) => s.toLowerCase());
    const matched = candidates.some((c) => supported.has(c));
    if (!matched) {
      return {
        compatible: false,
        reason: "board",
        detail: boardName ?? boardSoc ?? "unknown board",
      };
    }
  }

  return { compatible: true };
}
