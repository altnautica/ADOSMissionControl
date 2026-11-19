/**
 * @module mock/mock-extension-pages
 * @description The demo install rows and page bodies of the Capture,
 * Reconstruct and Navigation extensions, read from their manifests
 * (`extension-manifests`): every Agent page and node surface each declares,
 * on the profiles it declares them for, so each demo node shows the same
 * pages a real one with the extensions installed does. The bodies are
 * in-memory stand-ins: the Capture surface's demo monitor, the Navigation
 * page's demo panel (`mock-navigation`), and a card naming itself a stand-in
 * for every other page. No extension bundle is loaded and no agent route is
 * called.
 * @license GPL-3.0-only
 */

import YAML from "yaml";

import type { InstallDetailRow } from "@/hooks/use-drone-plugin-contributions";
import type { PluginSlotContribution } from "@/components/plugins/PluginHostProvider";
import type { InlinePluginModule } from "@/lib/plugins/inline-host-types";
import { parseNodePageContributions } from "@/lib/plugins/contributions/node-pages";
import { slotToCapability, type GcsContributeRow } from "@/lib/plugins/types";
import {
  CAPTURE,
  NAVIGATION,
  RECONSTRUCT,
  demoReleaseManifest,
  type DemoExtensionManifest,
} from "./extension-manifests";
import { DEMO_NAVIGATION_MODULE } from "./mock-navigation";

/** The two node page slots the manifests' `agent_pages` / `node_surfaces` map to. */
type NodePageSlot = "node.agent.page" | "node.surface";

/** A card that names the page it stands in for. */
const STAND_IN_MODULE: InlinePluginModule = {
  mount(root, host) {
    const card = document.createElement("div");
    card.className =
      "m-3 rounded border border-border-default bg-bg-secondary p-3 text-xs text-text-secondary";
    card.textContent = `Demo stand-in: the ${host.plugin.id} "${host.plugin.panelId}" page renders here on a node with the extension installed. Demo mode loads no extension bundle.`;
    root.append(card);
    return () => card.remove();
  },
};

/** The Capture surface's demo monitor; every other Capture page stands in. */
const CAPTURE_MODULE: InlinePluginModule = {
  async mount(root, host) {
    if (host.plugin.panelId !== "capture") return STAND_IN_MODULE.mount(root, host);
    // Lazy: the contribution producer imports this file on every route; the
    // panel belongs only in a demo session's chunk.
    const { mountCaptureDemoPanel } = await import("./capture-demo-panel");
    return mountCaptureDemoPanel(root, host);
  },
};

/** One extension's demo pages: its install row and the page bodies, built
 * once so a re-render hands the host the same bundle and a mounted page is
 * not rebuilt. */
interface DemoExtensionPages {
  installRow: InstallDetailRow;
  contributions: ReadonlyArray<{
    entry: GcsContributeRow;
    contribution: PluginSlotContribution & { slot: NodePageSlot };
  }>;
}

function demoPages(source: DemoExtensionManifest, module: InlinePluginModule): DemoExtensionPages {
  const manifest = demoReleaseManifest(source);
  const pluginId = manifest.pluginId;
  // The page blocks are read raw: the install parser keeps no node pages.
  const raw = YAML.parse(source.manifestYaml) as { gcs?: { contributes?: unknown } };
  const pages = parseNodePageContributions(raw.gcs?.contributes).map((row) => ({
    ...row,
    // The parser emits only these two slots for this block.
    slot: row.slot as NodePageSlot,
    title: row.title ?? row.panelId,
  }));
  return {
    installRow: {
      installId: pluginId,
      pluginId,
      version: manifest.version,
      name: manifest.name,
      gcsContributes: pages.map((p) => ({ ...p })),
    },
    contributions: pages.map((entry) => ({
      entry,
      contribution: {
        slot: entry.slot,
        pluginId,
        panelId: entry.panelId,
        title: entry.title,
        bundleUrl: "",
        isolation: "inline",
        inline: {
          status: "ready",
          bundle: {
            kind: "inline",
            module,
            trust: {
              pluginId,
              version: manifest.version,
              signerId: "demo",
              entrypoint: manifest.gcsEntrypoint ?? "gcs/plugin.bundle.js",
              paths: [],
            },
            readAsset: () => Promise.reject(new Error("the demo page ships no assets")),
          },
        },
        grantedCapabilities: new Set([slotToCapability(entry.slot)]),
        handlers: {},
        pluginInstallId: pluginId,
      },
    })),
  };
}

/** The three extensions' demo pages, in sidebar order. */
export const DEMO_EXTENSION_PAGES: ReadonlyArray<DemoExtensionPages> = [
  demoPages(CAPTURE, CAPTURE_MODULE),
  demoPages(RECONSTRUCT, STAND_IN_MODULE),
  demoPages(NAVIGATION, DEMO_NAVIGATION_MODULE),
];

/** Every demo page body, across the three extensions. */
export const DEMO_EXTENSION_PAGE_CONTRIBUTIONS = DEMO_EXTENSION_PAGES.flatMap((p) => p.contributions);
