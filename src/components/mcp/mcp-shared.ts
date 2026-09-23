/**
 * @module components/mcp/mcp-shared
 * @description Scope presets and the connect recipe for the MCP credential
 * console. A preset maps to the scope set minted into the credential; the gate
 * on the server (and the backend) still governs every call the AI client makes.
 * @license GPL-3.0-only
 */

/**
 * The scope / safety-class vocabulary the whole MCP tab shares. `read`,
 * `safe_write`, and `admin` are the default (unelevated) classes; `flight`,
 * `destructive`, and `secret_read` are elevated (default-off, warned).
 */
export const SAFETY_CLASSES = [
  "read",
  "safe_write",
  "admin",
  "flight",
  "destructive",
  "secret_read",
] as const;

export type SafetyClass = (typeof SAFETY_CLASSES)[number];

/** The elevated classes — always default-off at mint, color-warned in the UI. */
export const ELEVATED_SCOPES: readonly SafetyClass[] = ["flight", "destructive", "secret_read"];

/**
 * Tailwind badge classes per safety class. Single source of truth reused by the
 * tools catalog, plugin detail, and credential surfaces (extracted so a class's
 * colour is defined once). Fall back to {@link SAFETY_CLASS_BADGE_FALLBACK}.
 */
export const SAFETY_CLASS_BADGE: Record<string, string> = {
  read: "bg-status-success/15 text-status-success",
  safe_write: "bg-accent-primary/15 text-accent-primary",
  admin: "bg-status-warning/15 text-status-warning",
  flight: "bg-status-error/15 text-status-error",
  destructive: "bg-status-error/20 text-status-error",
  secret_read: "bg-bg-tertiary text-text-secondary",
};

export const SAFETY_CLASS_BADGE_FALLBACK = "bg-bg-tertiary text-text-secondary";

/** The badge classes for a safety class, falling back for an unknown class. */
export function safetyClassBadge(safetyClass: string): string {
  return SAFETY_CLASS_BADGE[safetyClass] ?? SAFETY_CLASS_BADGE_FALLBACK;
}

/**
 * The badge classes for a plugin-tool safety class. The agent spells the
 * flight class `flight_action`; both the MCP plugin detail and the install
 * pop-up's tools section badge it as `flight`. An absent class falls back to
 * the neutral badge.
 */
export function toolSafetyClassBadge(safetyClass: string | undefined): string {
  return safetyClassBadge(
    safetyClass === "flight_action" ? "flight" : (safetyClass ?? ""),
  );
}

/** Lifecycle state of a minted MCP credential. Only `active` can call a tool. */
export type McpCredentialStatus = "active" | "revoked" | "expired";

/**
 * The one status check every MCP surface uses (list, overview, sidebar badge,
 * catalog picker, detail drawer): revoked wins, then an expiry at or before
 * `now`, else active.
 */
export function credentialStatus(
  row: { revokedAt: number | null; expiresAt: number | null },
  now: number,
): McpCredentialStatus {
  if (row.revokedAt != null) return "revoked";
  if (row.expiresAt != null && row.expiresAt <= now) return "expired";
  return "active";
}

/** The scope set each preset mints. Read-only, Operate (the default), Full. */
export const SCOPE_PRESETS: Record<string, string[]> = {
  read: ["read"],
  operate: ["read", "safe_write", "admin"],
  full: ["read", "safe_write", "admin", "flight", "destructive"],
};

/**
 * The presets offered in the picker. `full` (flight + destructive) is held back
 * until the flight plane lands, so the console never mints a flight-scoped
 * credential the server cannot yet honor. Re-add "full" here once flight tools
 * are registered and gated by their confirm flow.
 */
export const SCOPE_PRESET_ORDER = ["read", "operate"] as const;

/** The public repo the operator clones to run the server (clone-and-run, no npm). */
export const ADOS_MCP_REPO = "https://github.com/altnautica/ADOS-MCP.git";

/** Stands in for the operator's local clone path; the setup script prints the real one. */
export const CLONE_PATH_PLACEHOLDER = "<path-to>/ADOS-MCP";

/** The clone + build block a user runs once to get the server locally. */
export function cloneAndBuildRecipe(): string {
  return `git clone ${ADOS_MCP_REPO}\ncd ADOS-MCP\n./scripts/setup.sh`;
}

/**
 * The `claude mcp add` command that registers the locally-built server with the
 * credential in the client environment (`-e`, so it is not left in the shell).
 * `clonePath` is the operator's local clone (the setup script prints the real one).
 */
export function connectRecipe(credential: string, clonePath = CLONE_PATH_PLACEHOLDER): string {
  return `claude mcp add ados -e ADOS_MCP_TOKEN=${credential} -- node ${clonePath}/dist/index.js --target fleet --gcs prod`;
}

/**
 * A project-scoped `.mcp.json` entry an operator commits to a project so Claude
 * Code (and other MCP clients that read `.mcp.json`) launch the locally-built
 * server with the credential set. An alternative to the `claude mcp add` command.
 */
export function mcpJsonSnippet(credential: string, clonePath = CLONE_PATH_PLACEHOLDER): string {
  return JSON.stringify(
    {
      mcpServers: {
        ados: {
          command: "node",
          args: [`${clonePath}/dist/index.js`, "--target", "fleet", "--gcs", "prod"],
          env: { ADOS_MCP_TOKEN: credential },
        },
      },
    },
    null,
    2,
  );
}

/** The one-line check that confirms a credential connects, without an MCP client. */
export function verifyRecipe(credential: string, clonePath = CLONE_PATH_PLACEHOLDER): string {
  return `ADOS_MCP_TOKEN=${credential} node ${clonePath}/dist/index.js --target fleet --gcs prod --verify`;
}

// --- LOCAL-FIRST (agent-mode) recipes (local-first) -----------------------------
//
// The LAN-direct path is the primary, default way to connect: the server runs on
// the operator's own machine and reaches ONE drone directly over the LAN with the
// drone's own pairing key — no Mission Control sign-in, no cloud, no minted
// credential. `host` is the agent's reachable address (the LocalNode.hostname,
// e.g. `http://drone.local:8080`); `apiKey` is that node's pairing key. The cloud
// (`--target fleet`) recipes above are the opt-in "manage from anywhere" path.

/** The LAN-direct `claude mcp add` command for one drone (no login, no cloud). */
export function localConnectRecipe(host: string, apiKey: string, clonePath = CLONE_PATH_PLACEHOLDER): string {
  return `claude mcp add ados -e ADOS_MCP_AGENT_KEY=${apiKey} -- node ${clonePath}/dist/index.js --target agent ${host}`;
}

/** The shell line that sets a secret the `.mcp.json` snippets read by reference. */
export function envExportLine(name: string, value: string): string {
  return `export ${name}=${value}`;
}

/**
 * A project-scoped `.mcp.json` for the LAN-direct (agent-mode) single-drone
 * path. The pairing key is referenced as `${ADOS_MCP_AGENT_KEY}` and expanded
 * from the environment by the client, so the file itself holds no secret and
 * is safe to commit.
 */
export function localMcpJsonSnippet(host: string, clonePath = CLONE_PATH_PLACEHOLDER): string {
  return JSON.stringify(
    {
      mcpServers: {
        ados: {
          command: "node",
          args: [`${clonePath}/dist/index.js`, "--target", "agent", host],
          env: { ADOS_MCP_AGENT_KEY: "${ADOS_MCP_AGENT_KEY}" },
        },
      },
    },
    null,
    2,
  );
}

/** The one-line LAN-direct check that confirms the drone answers, no MCP client. */
export function localVerifyRecipe(host: string, apiKey: string, clonePath = CLONE_PATH_PLACEHOLDER): string {
  return `ADOS_MCP_AGENT_KEY=${apiKey} node ${clonePath}/dist/index.js --target agent ${host} --verify`;
}

// --- LOCAL-FIRST multi-drone fleet (local-first) --------------------------------
//
// For a whole LAN fleet the operator exports an `ados-fleet.json` (every paired
// drone's host + its own pairing key) from the wizard and points the server at it
// with `--target local-fleet <path>`. No cloud, no login; the keys live in the
// operator's own file. The default save location is under ~/.ados/mcp/.

/** The default local-fleet file path shown in the recipe. */
export const DEFAULT_FLEET_PATH = "~/.ados/mcp/fleet.json";
/** The filename the download uses (the operator saves it to DEFAULT_FLEET_PATH). */
export const LOCAL_FLEET_FILENAME = "ados-fleet.json";

/** One drone as written into the exported fleet file. */
export interface FleetFileNode {
  deviceId: string;
  name?: string;
  host: string;
  apiKey: string;
  profile?: string;
}

/** Serialize the `ados-fleet.json` the operator downloads and saves locally. */
export function fleetFileContents(nodes: FleetFileNode[]): string {
  const doc = {
    version: 1,
    nodes: nodes.map((n) => ({
      deviceId: n.deviceId,
      ...(n.name ? { name: n.name } : {}),
      host: n.host,
      apiKey: n.apiKey,
      ...(n.profile ? { profile: n.profile } : {}),
    })),
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/** Options shared by the fleet recipes. `discover` = the connector also browses the
 * LAN and auto-adopts new UNPAIRED drones (the `--discover` opt-in). */
export interface FleetRecipeOpts {
  discover?: boolean;
}

const discoverFlag = (o: FleetRecipeOpts): string => (o.discover ? " --discover" : "");

/**
 * The whole fleet as a base64 blob for the `ADOS_MCP_FLEET` env — the "control all
 * my drones in ONE command, no file" hand-off (each drone's host + pairing key,
 * exactly as the single-drone recipe carries one key in `ADOS_MCP_AGENT_KEY`).
 * Unicode-safe base64 (btoa is Latin1-only), chunked so a large fleet never
 * overflows the call stack; the connector decodes it with Buffer.from(…,"base64").
 */
export function fleetEnvValue(nodes: FleetFileNode[]): string {
  const bytes = new TextEncoder().encode(fleetFileContents(nodes));
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** The ONE `claude mcp add` command that controls the whole fleet — no file: every
 * drone's host + key rides in `ADOS_MCP_FLEET`. */
export function localFleetEnvRecipe(
  fleetB64: string,
  opts: FleetRecipeOpts = {},
  clonePath = CLONE_PATH_PLACEHOLDER,
): string {
  return `claude mcp add ados -e ADOS_MCP_FLEET=${fleetB64} -- node ${clonePath}/dist/index.js --target local-fleet${discoverFlag(opts)}`;
}

/** The `.mcp.json` equivalent of the no-file, whole-fleet command. The fleet
 * blob carries every drone's pairing key, so it is referenced as
 * `${ADOS_MCP_FLEET}` and expanded from the environment, never embedded. */
export function localFleetEnvJsonSnippet(
  opts: FleetRecipeOpts = {},
  clonePath = CLONE_PATH_PLACEHOLDER,
): string {
  const args = [`${clonePath}/dist/index.js`, "--target", "local-fleet"];
  if (opts.discover) args.push("--discover");
  return JSON.stringify(
    { mcpServers: { ados: { command: "node", args, env: { ADOS_MCP_FLEET: "${ADOS_MCP_FLEET}" } } } },
    null,
    2,
  );
}

/** The `claude mcp add` command for a whole LAN fleet from a FILE (keys in the file). */
export function localFleetConnectRecipe(
  fleetPath = DEFAULT_FLEET_PATH,
  opts: FleetRecipeOpts = {},
  clonePath = CLONE_PATH_PLACEHOLDER,
): string {
  return `claude mcp add ados -- node ${clonePath}/dist/index.js --target local-fleet ${fleetPath}${discoverFlag(opts)}`;
}

/** A project-scoped `.mcp.json` for the local-fleet FILE path. */
export function localFleetMcpJsonSnippet(
  fleetPath = DEFAULT_FLEET_PATH,
  opts: FleetRecipeOpts = {},
  clonePath = CLONE_PATH_PLACEHOLDER,
): string {
  const args = [`${clonePath}/dist/index.js`, "--target", "local-fleet", fleetPath];
  if (opts.discover) args.push("--discover");
  return JSON.stringify({ mcpServers: { ados: { command: "node", args } } }, null, 2);
}

/** The one-line check that confirms the fleet answers (per-node ✓/✗), no client. */
export function localFleetVerifyRecipe(
  fleetPath = DEFAULT_FLEET_PATH,
  clonePath = CLONE_PATH_PLACEHOLDER,
): string {
  return `node ${clonePath}/dist/index.js --target local-fleet ${fleetPath} --verify`;
}
