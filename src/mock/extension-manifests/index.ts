/**
 * @module mock/extension-manifests
 * @description The first-party extension manifests the demo mirrors. A
 * published extension is copied verbatim from its newest release tag, with
 * that release's signed asset; the demo catalog shows it, and the demo
 * installs, tabs, parameters, skills, target actions and assistant tools are
 * read from it, so the demo can never advertise something the published
 * extension does not have. `node scripts/sync-demo-extensions.mjs` rewrites
 * the `*.generated.ts` mirrors from the newest releases (`--check` reports a
 * mirror that lags).
 *
 * @license GPL-3.0-only
 */

export {
  demoReleaseManifest,
  type DemoExtensionManifest,
  type DemoExtensionRelease,
} from "./types";
export { CAPTURE } from "./capture.generated";
export { FOLLOW_ME } from "./follow-me.generated";
export { GIMBAL } from "./gimbal.generated";
export { NAVIGATION } from "./navigation.generated";
export { RECONSTRUCT } from "./reconstruct.generated";
export { SIYI_POD } from "./siyi-pod.generated";
export { THERMAL } from "./thermal.generated";
