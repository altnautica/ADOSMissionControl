/**
 * @module mock/mock-visor-surfaces
 * @description Demo-mode stand-ins for the capture extension's Visor node
 * surfaces (Capture, Sessions, Calibration), so a demo Visor shows the same
 * tab set a real one with the extension installed does. Each tab body is an
 * in-memory card that names itself as a demo stand-in; no extension bundle
 * is loaded and no agent route is called.
 * @license GPL-3.0-only
 */

import type { InstallDetailRow } from "@/hooks/use-drone-plugin-contributions";
import type { PluginSlotContribution } from "@/components/plugins/PluginHostProvider";
import type { InlinePluginModule } from "@/lib/plugins/inline-host-types";
import { slotToCapability, type GcsContributeRow } from "@/lib/plugins/types";

export const DEMO_CAPTURE_PLUGIN_ID = "com.altnautica.world-engine";
const VERSION = "2.0.0";

/** The extension manifest's Visor `node_surfaces`, in its band and order. */
const SURFACES: ReadonlyArray<
  GcsContributeRow & { slot: "node.surface"; title: string }
> = [
  {
    slot: "node.surface",
    panelId: "capture",
    title: "Capture",
    profile: ["visor"],
    group: "status",
    order: 20,
  },
  {
    slot: "node.surface",
    panelId: "sessions",
    title: "Sessions",
    profile: ["visor"],
    group: "status",
    order: 30,
  },
  {
    slot: "node.surface",
    panelId: "calibration",
    title: "Calibration",
    profile: ["visor"],
    group: "device",
    order: 20,
  },
];

/** The extension manifest's drone Agent page that hosts the live 3D viewer. */
export const LIVE_WORLD_PAGE: GcsContributeRow & { slot: "node.agent.page" } = {
  slot: "node.agent.page",
  panelId: "live-world",
  title: "Live World",
  section: "videoVision",
  profile: ["drone"],
};

/** The demo install row carrying the Visor surfaces and the drone viewer page. */
export const DEMO_CAPTURE_INSTALL_ROW: InstallDetailRow = {
  installId: DEMO_CAPTURE_PLUGIN_ID,
  pluginId: DEMO_CAPTURE_PLUGIN_ID,
  version: VERSION,
  name: "World Engine",
  gcsContributes: [...SURFACES.map((s) => ({ ...s })), { ...LIVE_WORLD_PAGE }],
};

const MODULE: InlinePluginModule = {
  mount(root, host) {
    const card = document.createElement("div");
    card.className =
      "m-3 rounded border border-border-default bg-bg-secondary p-3 text-xs text-text-secondary";
    card.textContent = `Demo: the capture extension's ${host.plugin.panelId} tab renders here on a Visor with the extension installed.`;
    root.append(card);
    return () => card.remove();
  },
};

/** The tab bodies, built once so a re-render hands the host the same bundle. */
export const DEMO_CAPTURE_SURFACES: ReadonlyArray<{
  entry: GcsContributeRow;
  contribution: PluginSlotContribution & { slot: "node.surface" };
}> = SURFACES.map((entry) => ({
  entry,
  contribution: {
    slot: "node.surface",
    pluginId: DEMO_CAPTURE_PLUGIN_ID,
    panelId: entry.panelId,
    title: entry.title,
    bundleUrl: "",
    isolation: "inline",
    inline: {
      status: "ready",
      bundle: {
        kind: "inline",
        module: MODULE,
        trust: {
          pluginId: DEMO_CAPTURE_PLUGIN_ID,
          version: VERSION,
          signerId: "demo",
          entrypoint: "gcs/plugin.bundle.js",
          paths: [],
        },
        readAsset: () =>
          Promise.reject(new Error("the demo panel ships no assets")),
      },
    },
    grantedCapabilities: new Set([slotToCapability("node.surface")]),
    handlers: {},
    pluginInstallId: DEMO_CAPTURE_PLUGIN_ID,
  },
}));
