/**
 * @module mock/extension-manifests
 * @description The first-party extension manifests the demo mirrors, copied
 * verbatim from each extension's newest published release tag, with that
 * release's signed asset. The demo catalog shows these manifests, and the demo
 * installs, tabs, parameters, skills, target actions and assistant tools are
 * read from them, so the demo can never advertise something the published
 * extension does not have. Refresh a manifest by copying it from the release
 * tag (`git show <tag>:extensions/<dir>/manifest.yaml`) together with the
 * asset URL, digest and size from that release.
 *
 * The world-engine install mirrors its newest tagged manifest
 * ({@link WORLD_ENGINE_TAGGED_MANIFEST}); its catalog row stays on the newest
 * release that publishes a signed asset.
 *
 * @license GPL-3.0-only
 */

export { demoReleaseManifest, type DemoExtensionRelease } from "./types";
export { FOLLOW_ME } from "./follow-me";
export { GIMBAL } from "./gimbal";
export { SIYI_POD } from "./siyi-pod";
export { THERMAL } from "./thermal";
export { VISION_NAV } from "./vision-nav";
export { WORLD_ENGINE_RELEASE } from "./world-engine";
export { WORLD_ENGINE_TAGGED_MANIFEST } from "./world-engine-tagged";
