/**
 * @module mock/mock-mcp-plugins
 * @description Demo-mode MCP plugin views for the console's Plugins segment, so
 * `npm run demo` renders the segment without a real agent or manifest fetch.
 * Every installed first-party extension that declares tools is listed as its
 * published release declares it (as the live view lists only plugins with an
 * MCP contribution); an untrusted orbit behavior stays synthetic. Never
 * imported in a production path.
 * @license GPL-3.0-only
 */

import type { McpPluginView } from "@/lib/plugins/mcp-plugin-tools";
import { demoReleaseManifest, type DemoExtensionRelease } from "./extension-manifests";
import { DEMO_RELEASES, getDemoDronePluginInstalls } from "./mock-plugins";

/** Demo drones with extension installs. */
const DEMO_NODES = ["alpha-1", "charlie-3", "delta-4"];

/** A first-party extension as its published release declares it: tools,
 * agent-half permissions and version from the manifest, installed on the demo
 * drones that carry it. The releases declare tools only (no resources or
 * prompts). */
function releaseView(release: DemoExtensionRelease): McpPluginView {
  const m = demoReleaseManifest(release);
  const grantedCaps = m.permissions.filter((p) => p.half === "agent").map((p) => p.id);
  return {
    pluginId: m.pluginId,
    name: m.name,
    version: m.version,
    firstParty: true,
    mcpExposed: grantedCaps.includes("mcp.expose"),
    grantedCaps,
    installedOn: DEMO_NODES.filter((node) =>
      getDemoDronePluginInstalls(node).some((i) => i.pluginId === m.pluginId),
    ),
    tools: [...(m.contributesTools ?? [])],
    resources: [],
    prompts: [],
  };
}

const DEMO_MCP_PLUGINS: McpPluginView[] = [
  ...[...DEMO_RELEASES.values()]
    .filter((r) => (demoReleaseManifest(r).contributesTools ?? []).length > 0)
    .map(releaseView),
  {
    pluginId: "com.example.orbit",
    name: "Orbit",
    version: "0.3.0",
    firstParty: false,
    mcpExposed: true,
    grantedCaps: ["flight.guided_setpoint", "mcp.expose"],
    installedOn: ["alpha-1"],
    tools: [
      {
        name: "start_orbit",
        title: "Start orbit",
        description: "Fly a circular orbit around the locked target.",
        safetyClass: "flight_action",
        half: "agent",
      },
      {
        name: "orbit_status",
        title: "Orbit status",
        description: "Report the current orbit radius and phase.",
        safetyClass: "read",
        half: "agent",
      },
    ],
    resources: [],
    prompts: [],
  },
];

/** The demo MCP plugin views (a stable copy per call). */
export function getDemoMcpPlugins(): McpPluginView[] {
  return DEMO_MCP_PLUGINS.map((p) => ({ ...p }));
}
