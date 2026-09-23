/**
 * @module PluginInstallTransportTypes
 * @description Shared types for the two install transports (LAN-direct
 * and cloud-relay). The dialog owns the path-selection state; the
 * transports just receive the validated inputs and return a job id the
 * progress toast can subscribe to.
 * @license GPL-3.0-only
 */

import type { InstallManifestSummary } from "../install-dialog/types";

/** Which path carries the install. A drone reached only through a ground
 * station's radio relay has neither: the drone refuses plugin installs over
 * the relay, because a relayed request carries no per-drone credential. */
export type InstallTransport = "lan" | "cloud";

/** Result of a successful install kickoff. The dialog hands this back to
 * the caller so the progress toast can subscribe by job id and the
 * caller can route the operator to the right place. */
export interface InstallKickoffResult {
  /** Path actually used (may differ from the requested path after a
   * failover). */
  transport: InstallTransport;
  /** Server-issued job id. For LAN this is the agent's job id (returned
   * in the install response). For cloud this is the Convex
   * `plugin_install_jobs._id`. */
  jobId: string;
  /** Plugin id from the manifest. The progress toast renders this. */
  pluginId: string;
  /** Display name from the manifest. */
  pluginName: string;
  /** Device the install was queued against. */
  deviceId: string;
  /** True once the drone's agent confirmed the plugin is enabled. The LAN
   * path enables it right after the install; the cloud path only queues
   * the install, so it is never enabled here. */
  enabledOnAgent: boolean;
  /** Anything the operator must know about an install that did happen:
   * a cloud failover, permissions the drone did not grant, an enable that
   * failed, a GCS half that could not be prepared. */
  notice?: string;
}

/** The LAN install routes answer only when the install is over: the agent
 * installs vendored wheels (bounded at 300 s) before it replies, and the
 * install-from-URL route first downloads the archive (also bounded at
 * 300 s). The browser waits past those bounds so the agent's own verdict
 * arrives; aborting sooner would not stop the install on the drone. */
export const LAN_FILE_INSTALL_TIMEOUT_MS = 360_000;
export const LAN_URL_INSTALL_TIMEOUT_MS = 660_000;

/** Common input shape for both transports. */
export interface TransportContext {
  file: File;
  manifest: InstallManifestSummary;
  grantedPermissions: ReadonlyArray<string>;
  deviceId: string;
  deviceName: string;
}
