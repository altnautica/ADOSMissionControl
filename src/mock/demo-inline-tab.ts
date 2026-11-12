/**
 * @module mock/demo-inline-tab
 * @description The `node.detail.tab` contribution the demo hands the plugin
 * slot host for an extension whose signed iframe bundle demo mode cannot
 * load: an in-memory inline module, keyed to the running install row the tab
 * header reads, so the body mounts under the header the operator clicked.
 * @license GPL-3.0-only
 */

import type { PluginSlotContribution } from "@/components/plugins/PluginHostProvider";
import type { InlinePluginModule } from "@/lib/plugins/inline-host-types";
import type { GcsContributeRow } from "@/lib/plugins/types";
import { demoReleaseManifest, type DemoExtensionRelease } from "./extension-manifests";
import { getDemoDronePluginInstalls } from "./mock-plugins";

export interface DemoInlineTabContribution {
  entry: GcsContributeRow;
  contribution: PluginSlotContribution & { slot: "node.detail.tab" };
}

/**
 * A per-drone cache of one extension's demo tab body. Each drone gets one
 * contribution object, so a re-render hands the host the same bundle and the
 * mounted panel is not torn down and rebuilt. Null on a drone that does not
 * run the extension.
 */
export function demoInlineTab(
  release: DemoExtensionRelease,
  panelId: string,
  module: InlinePluginModule,
): (deviceId: string) => DemoInlineTabContribution | null {
  const manifest = demoReleaseManifest(release);
  const pluginId = manifest.pluginId;
  // Capabilities the extension's GCS half requests in its manifest.
  const capabilities = manifest.permissions.filter((p) => p.half === "gcs").map((p) => p.id);
  const cache = new Map<string, DemoInlineTabContribution | null>();

  const build = (deviceId: string): DemoInlineTabContribution | null => {
    const install = getDemoDronePluginInstalls(deviceId).find(
      (p) => p.pluginId === pluginId && p.status === "running",
    );
    if (!install) return null;
    const title = install.droneDetailTabTitle ?? install.name;
    return {
      entry: { slot: "node.detail.tab", panelId, title, profile: ["drone"] },
      contribution: {
        slot: "node.detail.tab",
        pluginId,
        panelId,
        title,
        bundleUrl: "",
        isolation: "inline",
        inline: {
          status: "ready",
          bundle: {
            kind: "inline",
            module,
            trust: {
              pluginId,
              version: install.version,
              signerId: "demo",
              entrypoint: manifest.gcsEntrypoint ?? "gcs/plugin.bundle.js",
              paths: [],
            },
            readAsset: () => Promise.reject(new Error("the demo panel ships no assets")),
          },
        },
        grantedCapabilities: new Set(capabilities),
        handlers: {},
        pluginInstallId: install.installId,
      },
    };
  };

  return (deviceId) => {
    const cached = cache.get(deviceId);
    if (cached !== undefined) return cached;
    const built = build(deviceId);
    cache.set(deviceId, built);
    return built;
  };
}
