/**
 * @module CloudRelayTransport
 * @description Cloud-relay install path. Uploads the archive to Convex
 * `_storage`, registers the archive row (deduped by `(userId, sha256)`),
 * and creates a `plugin_install_jobs` row. The agent's existing 5s
 * command poll picks up the matching `cmd_droneCommands` row, downloads
 * the archive from a signed URL, and acks progress via heartbeat
 * extras.
 *
 * The Convex callables live in
 * `cmdPluginArchives.generateUploadUrl`,
 * `cmdPluginArchives.verifyArchive` (action, server-side integrity
 * check + insert), and `cmdPluginInstallJobs.createJob`. The dialog
 * resolves each handle and passes it in so this helper stays
 * unit-testable without a Convex client.
 *
 * @license GPL-3.0-only
 */

import { computeSha256 } from "./manifest-parse";
import type { InstallKickoffResult, TransportContext } from "./types";

/** Convex action / mutation signatures used by the cloud-relay path.
 * Typed loosely so the dialog can hand in the result of
 * `useAction(...)` / `useMutation(...)` directly. The Convex
 * validators on the server own the authoritative shape; the wire
 * arguments below match the fields they accept. */
export type GenerateUploadUrlAction = () => Promise<string>;
/** Server-side verifier + inserter. Replaces the old client-trusting
 * `recordArchive` mutation. The action revalidates SHA-256 against
 * storage metadata, extracts `manifest.yaml` from the archive, hashes
 * its bytes, and only inserts the row when both digests match. The
 * client's claims still appear in the call so the operator sees a
 * single "Archive integrity check failed" line when they diverge. */
export type VerifyArchiveAction = (args: {
  storageId: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  pluginId: string;
  version: string;
  manifestHash: string;
  declaredPermissions: ReadonlyArray<{ id: string; required: boolean }>;
  signerId?: string;
  signatureB64?: string;
}) => Promise<string>;
export type CreateJobMutation = (args: {
  deviceId: string;
  archiveId: string;
  requestedPermissions: ReadonlyArray<string>;
}) => Promise<string>;

export interface CloudRelayInputs extends TransportContext {
  generateUploadUrl: GenerateUploadUrlAction;
  verifyArchive: VerifyArchiveAction;
  createJob: CreateJobMutation;
  /** Manifest hash from the client-side parse. Used as the archive
   * row's manifest identity. */
  manifestHash: string;
}

export class CloudRelayError extends Error {
  readonly stage: CloudRelayStage;
  constructor(stage: CloudRelayStage, message: string) {
    super(message);
    this.stage = stage;
  }
}

export type CloudRelayStage =
  | "upload-url"
  | "upload"
  | "verify"
  | "create-job";

/**
 * Run the cloud-relay install flow end-to-end. The progress toast then
 * subscribes via a reactive `useQuery` on the returned job id; this
 * helper returns as soon as the job row is enqueued.
 */
export async function installCloudRelay(
  inputs: CloudRelayInputs,
): Promise<InstallKickoffResult> {
  let uploadUrl: string;
  try {
    uploadUrl = await inputs.generateUploadUrl();
  } catch (err) {
    throw new CloudRelayError(
      "upload-url",
      err instanceof Error ? err.message : String(err),
    );
  }

  const sha256 = await computeSha256(inputs.file);

  let storageId: string;
  try {
    const resp = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: inputs.file,
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    // Convex storage returns `{ storageId: "kg..." }`. Older versions
    // wrap the response differently, so we resolve defensively.
    const body = (await resp.json()) as { storageId?: string };
    if (!body.storageId) {
      throw new Error("Storage upload did not return a storageId");
    }
    storageId = body.storageId;
  } catch (err) {
    throw new CloudRelayError(
      "upload",
      err instanceof Error ? err.message : String(err),
    );
  }

  let archiveId: string;
  try {
    archiveId = await inputs.verifyArchive({
      storageId,
      fileName: inputs.file.name,
      sizeBytes: inputs.file.size,
      sha256,
      pluginId: inputs.manifest.pluginId,
      version: inputs.manifest.version,
      manifestHash: inputs.manifestHash,
      declaredPermissions: inputs.manifest.permissions.map((p) => ({
        id: p.id,
        required: p.required,
      })),
      signerId: inputs.manifest.signerId,
    });
  } catch (err) {
    // Surface the verifier's rejection as a single, operator-friendly
    // line on the install dialog. The server's error text already
    // names the specific gate that failed (sha256, manifest hash,
    // ownership) — the dialog renders it under a fixed prefix.
    const detail = err instanceof Error ? err.message : String(err);
    throw new CloudRelayError(
      "verify",
      `Archive integrity check failed — re-upload or contact the plugin author. ${detail}`,
    );
  }

  let jobId: string;
  try {
    jobId = await inputs.createJob({
      deviceId: inputs.deviceId,
      archiveId,
      requestedPermissions: inputs.grantedPermissions,
    });
  } catch (err) {
    throw new CloudRelayError(
      "create-job",
      err instanceof Error ? err.message : String(err),
    );
  }

  return {
    transport: "cloud",
    jobId,
    pluginId: inputs.manifest.pluginId,
    pluginName: inputs.manifest.name,
    deviceId: inputs.deviceId,
    enabledOnAgent: false,
  };
}
