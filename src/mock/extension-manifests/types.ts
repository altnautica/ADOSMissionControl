/**
 * @module mock/extension-manifests/types
 * @description The demo's published-release record and its parsed manifest.
 * @license GPL-3.0-only
 */

import { parseManifestYaml } from "@/components/plugins/transports/manifest-parse";
import type { ParsedManifest } from "@/components/plugins/transports/manifest-types";

/** One published release: its manifest text and signed asset. */
export interface DemoExtensionRelease {
  manifestYaml: string;
  tag: string;
  downloadUrl: string;
  archiveSha256: string;
  archiveSizeBytes: number;
}

const parsedReleases = new Map<DemoExtensionRelease, ParsedManifest>();

/** A release's manifest, parsed once by the same parser the install pop-up
 * uses, so demo installs and contributions read exactly what it declares. */
export function demoReleaseManifest(release: DemoExtensionRelease): ParsedManifest {
  let parsed = parsedReleases.get(release);
  if (!parsed) {
    parsed = parseManifestYaml(release.manifestYaml);
    parsedReleases.set(release, parsed);
  }
  return parsed;
}
