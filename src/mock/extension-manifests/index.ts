/**
 * @module mock/extension-manifests
 * @description The first-party extension manifests the demo mirrors. A
 * published extension is copied verbatim from its newest release tag, with
 * that release's signed asset; the demo catalog shows it, and the demo
 * installs, tabs, parameters, skills, target actions and assistant tools are
 * read from it, so the demo can never advertise something the published
 * extension does not have. Refresh one by copying it from the release tag
 * (`git show <tag>:extensions/<dir>/manifest.yaml`) together with the asset
 * URL, digest and size from that release.
 *
 * Capture, Reconstruct and Navigation have no published release yet: the
 * demo installs mirror the manifest at the head of the extensions repository,
 * and the catalog carries no row for them.
 *
 * @license GPL-3.0-only
 */

export {
  demoReleaseManifest,
  type DemoExtensionManifest,
  type DemoExtensionRelease,
} from "./types";
export { CAPTURE } from "./capture";
export { FOLLOW_ME } from "./follow-me";
export { GIMBAL } from "./gimbal";
export { NAVIGATION } from "./navigation";
export { RECONSTRUCT } from "./reconstruct";
export { SIYI_POD } from "./siyi-pod";
export { THERMAL } from "./thermal";
