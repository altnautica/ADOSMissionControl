/**
 * @module PluginInstallTransportTypes
 * @description Shared types for the two install transports (LAN-direct
 * and cloud-relay). The dialog owns the path-selection state; the
 * transports just receive the validated inputs and return a job id the
 * progress toast can subscribe to.
 * @license GPL-3.0-only
 */

import type { InstallManifestSummary } from "../install-dialog/types";

/** Which wire path will carry the archive bytes. `relay` is a drone
 * reached only through a ground station's WFB radio relay — the archive
 * bytes never cross the relay itself (see `relay-url.ts`); the agent
 * fetches them from the URL directly. */
export type InstallTransport = "lan" | "cloud" | "relay";

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
  /** Optional one-line notice surfaced by the failover path. */
  notice?: string;
}

/** Per-transport timeouts. Connect = how long we wait for the first byte
 * of response. Total = end-to-end ceiling for the upload + handshake.
 *
 * The 10s connect / 60s total ceiling matches the spec's auto-failover
 * trigger: a slow LAN path that hasn't started responding within 10s
 * gets demoted, and a full upload that hasn't completed within 60s
 * gives up and tries cloud. */
export const LAN_CONNECT_TIMEOUT_MS = 10_000;
export const LAN_TOTAL_TIMEOUT_MS = 60_000;

/** Common input shape for both transports. */
export interface TransportContext {
  file: File;
  manifest: InstallManifestSummary;
  grantedPermissions: ReadonlyArray<string>;
  deviceId: string;
  deviceName: string;
}
