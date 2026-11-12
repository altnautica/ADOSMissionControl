/**
 * @module mock/mock-visor-surfaces
 * @description The world-engine extension's demo install row and page bodies,
 * read from its manifest (`extension-manifests`): every Agent page and node
 * surface it declares, on the profiles it declares them for, so each demo
 * node shows the same pages a real one with the extension installed does.
 * The bodies are in-memory stand-ins (`mock-live-world`); no extension bundle
 * is loaded and no agent route is called.
 * @license GPL-3.0-only
 */

import YAML from "yaml";

import type { InstallDetailRow } from "@/hooks/use-drone-plugin-contributions";
import type { PluginSlotContribution } from "@/components/plugins/PluginHostProvider";
import { parseNodePageContributions } from "@/lib/plugins/contributions/node-pages";
import { slotToCapability, type GcsContributeRow } from "@/lib/plugins/types";
import { WORLD_ENGINE_TAGGED_MANIFEST } from "./extension-manifests";
import { DEMO_LIVE_WORLD_MODULE } from "./mock-live-world";

interface WorldEngineManifest {
  id: string;
  name: string;
  version: string;
  gcs: { entrypoint: string; contributes: unknown };
}

const MANIFEST = YAML.parse(WORLD_ENGINE_TAGGED_MANIFEST) as WorldEngineManifest;

export const DEMO_CAPTURE_PLUGIN_ID = MANIFEST.id;

/** The two node page slots the manifest's `agent_pages` / `node_surfaces` map to. */
type NodePageSlot = "node.agent.page" | "node.surface";

/** Every Agent page and node surface the manifest declares. */
export const DEMO_WORLD_ENGINE_PAGES: ReadonlyArray<
  GcsContributeRow & { slot: NodePageSlot; title: string }
> = parseNodePageContributions(MANIFEST.gcs.contributes).map((row) => ({
  ...row,
  // The parser emits only these two slots for this block.
  slot: row.slot as NodePageSlot,
  title: row.title ?? row.panelId,
}));

/** The demo install row carrying the extension's pages. */
export const DEMO_CAPTURE_INSTALL_ROW: InstallDetailRow = {
  installId: DEMO_CAPTURE_PLUGIN_ID,
  pluginId: DEMO_CAPTURE_PLUGIN_ID,
  version: MANIFEST.version,
  name: MANIFEST.name,
  gcsContributes: DEMO_WORLD_ENGINE_PAGES.map((p) => ({ ...p })),
};

/** The page bodies, built once so a re-render hands the host the same bundle
 * and a mounted page is not rebuilt. */
export const DEMO_WORLD_ENGINE_CONTRIBUTIONS: ReadonlyArray<{
  entry: GcsContributeRow;
  contribution: PluginSlotContribution & { slot: NodePageSlot };
}> = DEMO_WORLD_ENGINE_PAGES.map((entry) => ({
  entry,
  contribution: {
    slot: entry.slot,
    pluginId: DEMO_CAPTURE_PLUGIN_ID,
    panelId: entry.panelId,
    title: entry.title,
    bundleUrl: "",
    isolation: "inline",
    inline: {
      status: "ready",
      bundle: {
        kind: "inline",
        module: DEMO_LIVE_WORLD_MODULE,
        trust: {
          pluginId: DEMO_CAPTURE_PLUGIN_ID,
          version: MANIFEST.version,
          signerId: "demo",
          entrypoint: MANIFEST.gcs.entrypoint,
          paths: [],
        },
        readAsset: () => Promise.reject(new Error("the demo page ships no assets")),
      },
    },
    grantedCapabilities: new Set([slotToCapability(entry.slot)]),
    handlers: {},
    pluginInstallId: DEMO_CAPTURE_PLUGIN_ID,
  },
}));
