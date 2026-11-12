/**
 * @module mock/first-party-registry
 * @description Demo-mode-only fixture for the first-party plugin catalog.
 * `RegistryPluginGrid` renders this (via `DemoRegistryGrid`) only when
 * `isDemoMode()` is true; a live Convex outage outside demo mode falls
 * through to an explicit error state instead (see `RegistryPluginGrid.tsx`'s
 * `!convexAvailable` branch). So this file is **not** an offline/first-party
 * fallback for a missing live registry read — it exists purely so an
 * operator can open the install / detail pop-up against real manifests with
 * no backend and no auth.
 *
 * Each entry is the newest published release of a first-party extension
 * (`extension-manifests.ts`): its manifest verbatim, and the signed asset's
 * URL, digest and size from that release, so the catalog never advertises
 * something the published extension does not have and the demo install
 * downloads and verifies a real archive. Nothing here reaches an agent.
 *
 * @license GPL-3.0-only
 */

import YAML from "yaml";

import type { RegistryCategory, RegistryPluginRow } from "@/lib/plugins/registry-row";
import {
  FOLLOW_ME,
  GIMBAL,
  SIYI_POD,
  THERMAL,
  VISION_NAV,
  WORLD_ENGINE_RELEASE,
  demoReleaseManifest,
  type DemoExtensionRelease,
} from "./extension-manifests";

/** A demo registry entry: the catalog row plus the manifest text and the
 * signing/download fields the install pop-up reads. */
export interface DemoRegistryEntry {
  row: RegistryPluginRow;
  manifestYaml: string;
  downloadUrl: string;
  archiveSha256: string;
  /** Published archive size in bytes, cross-checked against the GitHub
   * release asset's Content-Length. */
  archiveSizeBytes: number;
  signerKeyId: string;
  /** Boards the extension's own `manifest.yaml` declares under
   * `compatibility.supported_boards`, so the demo catalog exercises the same
   * board gate a live registry row would. `["*"]` means every board. */
  supportedBoards: readonly string[];
}

/** The first-party signing key every release is signed with. */
const SIGNER_KEY_ID = "altnautica-2026-A";

function releaseEntry(
  release: DemoExtensionRelease,
  category: RegistryCategory,
): DemoRegistryEntry {
  const manifest = demoReleaseManifest(release);
  const raw: unknown = YAML.parse(release.manifestYaml);
  const compatibility: unknown =
    raw && typeof raw === "object" && "compatibility" in raw ? raw.compatibility : undefined;
  const boards: unknown =
    compatibility && typeof compatibility === "object" && "supported_boards" in compatibility
      ? compatibility.supported_boards
      : undefined;
  return {
    row: {
      _id: `demo-${manifest.pluginId}`,
      plugin_id: manifest.pluginId,
      name: manifest.name,
      description: manifest.description ?? "",
      category,
      license: manifest.license ?? "GPL-3.0-or-later",
      author_id: "altnautica",
      verified_publisher: true,
      latest_version: manifest.version,
      tier: "first_party",
      ...(manifest.icon ? { icon: manifest.icon } : {}),
    },
    manifestYaml: release.manifestYaml,
    downloadUrl: release.downloadUrl,
    archiveSha256: release.archiveSha256,
    archiveSizeBytes: release.archiveSizeBytes,
    signerKeyId: SIGNER_KEY_ID,
    supportedBoards: Array.isArray(boards) ? boards.map(String) : ["*"],
  };
}

/** The demo registry entries, in display order. */
export const DEMO_REGISTRY_ENTRIES: ReadonlyArray<DemoRegistryEntry> = [
  releaseEntry(SIYI_POD, "drivers"),
  releaseEntry(FOLLOW_ME, "ai"),
  releaseEntry(GIMBAL, "drivers"),
  releaseEntry(THERMAL, "drivers"),
  releaseEntry(VISION_NAV, "ai"),
  releaseEntry(WORLD_ENGINE_RELEASE, "ai"),
];
