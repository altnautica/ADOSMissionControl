"use client";

/**
 * @module PluginInstallDialog
 * @description Per-drone plugin install dialog. Composes the local-file
 * pick screen, the single-page review surface, and the install
 * kickoff. Two install sources flow through the same orchestrator:
 *
 *   - `kind: "file"` — operator drag-dropped a `.adosplug` archive. The
 *     dialog parses it client-side and the cloud-relay path uploads
 *     it via Convex storage. LAN-direct uses the multipart
 *     `/api/plugins/install` endpoint.
 *   - `kind: "registry"` — operator clicked Install on a registry
 *     card. The parent grid pre-resolves the manifest and hands a URL
 *     + SHA-256 pin to this dialog. Install kickoff calls the agent's
 *     `POST /api/plugins/install_from_url` endpoint over the LAN; no
 *     Convex hop is needed, so the operator does not have to be
 *     signed in to the cloud.
 *
 * Transport policy:
 *   - `resolveLanTarget()` returns the LAN URL + pairing key for the
 *     target drone, or null when HTTPS / unpaired / unreachable.
 *   - For the file path, `installLanDirect()` posts multipart to
 *     `/api/plugins/install`; `installCloudRelay()` walks the
 *     `generateUploadUrl → verifyArchive → createJob` chain on
 *     failover.
 *   - For the registry path, `installLanDirectFromUrl()` posts JSON to
 *     `/api/plugins/install_from_url`. Cloud-relay-from-URL falls back
 *     to a clear "LAN unavailable" error since the URL install does
 *     not need cloud storage.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { useTranslations } from "next-intl";

import { Modal } from "@/components/ui/modal";
import { useConvexAvailable } from "@/app/ConvexClientProvider";
import { communityApi } from "@/lib/community-api";
import { useAgentSystemStore } from "@/stores/agent-system-store";

import {
  inspectArchive,
  parseManifestYaml,
  toInstallSummary,
} from "./transports/manifest-parse";
import { resolveLanTarget } from "./transports/resolve-lan-url";
import type {
  CreateJobMutation,
  GenerateUploadUrlAction,
  VerifyArchiveAction,
} from "./transports/cloud-relay";
import type {
  InstallKickoffResult,
  InstallTransport,
} from "./transports/types";
import { ErrorStage, PickStage, TransportChrome } from "./install-dialog/stages";
import { ReviewStage } from "./install-dialog/sections/ReviewStage";
import { checkCompatibility } from "./install-dialog/check-compatibility";
import { useInstallHandler, type ActiveInstallJob } from "./install-dialog/use-install-handler";
import { PluginInstallProgress } from "./PluginInstallProgress";
import type { RecordInstallArgs } from "./transports/finalize-gcs-install";
import type {
  InstallManifestSummary,
  InstallSource,
  InstallTargetDrone,
} from "./install-dialog/types";

interface PluginInstallDialogProps {
  open: boolean;
  onClose: () => void;
  /** Drone the plugin is being installed on, or null for a GCS-level /
   * fleet install (no drone) from the Settings → Plugins home. A
   * plugin with an agent half requires a drone; a GCS-only plugin
   * installs against the GCS itself. */
  targetDevice: InstallTargetDrone | null;
  /** Pre-populated manifest + source from a registry card or a
   * stored upload. When omitted, the dialog opens on the local-file
   * pick stage. */
  initialManifest?: InstallManifestSummary;
  initialManifestHash?: string;
  /** Source discriminator that drives transport selection. Required
   * alongside `initialManifest`. */
  initialSource?: InstallSource;
  /** Optional: fired with the install outcome. The dialog itself shows
   * the outcome, notices and progress; this is only for a parent that
   * wants to react as well. */
  onKickedOff?: (result: InstallKickoffResult) => void;
}

type Stage = "pick" | "loading" | "review" | "installing" | "done" | "error";

const verifyArchiveRef = makeFunctionReference<
  "action",
  Parameters<VerifyArchiveAction>[0],
  Awaited<ReturnType<VerifyArchiveAction>>
>("cmdPluginArchivesVerify:verifyArchive");

export function PluginInstallDialog({
  open,
  onClose,
  targetDevice,
  initialManifest,
  initialManifestHash,
  initialSource,
  onKickedOff,
}: PluginInstallDialogProps) {
  const t = useTranslations("pluginInstall.dialog");
  const convexAvailable = useConvexAvailable();
  const generateUploadUrl = useAction(
    communityApi.pluginArchives.generateUploadUrl,
  ) as unknown as GenerateUploadUrlAction;
  const verifyArchive = useAction(
    verifyArchiveRef,
  ) as unknown as VerifyArchiveAction;
  const createJob = useMutation(
    communityApi.pluginInstallJobs.createJob,
  ) as unknown as CreateJobMutation;
  // GCS-side install finalizers: record the install row, grant the
  // approved permissions, and enable the plugin so its GCS half mounts.
  const recordInstall = useMutation(
    communityApi.plugins.recordInstall,
  ) as unknown as (args: RecordInstallArgs) => Promise<string>;
  const grantPermission = useMutation(
    communityApi.plugins.grantPermission,
  ) as unknown as (args: {
    installId: string;
    permissionId: string;
  }) => Promise<unknown>;
  const setInstallStatus = useMutation(
    communityApi.plugins.setStatus,
  ) as unknown as (args: {
    installId: string;
    status: string;
  }) => Promise<unknown>;

  // Host board info — drives the compatibility check.
  const boardModel = useAgentSystemStore((s) => s.status?.board.model);
  const boardName = useAgentSystemStore((s) => s.status?.board.name);
  const boardSoc = useAgentSystemStore((s) => s.status?.board.soc);
  const ramTotalMb = useAgentSystemStore((s) => s.status?.board.ram_mb);

  const seedFromInitial = initialManifest !== undefined && initialSource !== undefined;
  const [stage, setStage] = useState<Stage>(seedFromInitial ? "review" : "pick");
  const [error, setError] = useState<string | null>(null);
  const [manifest, setManifest] = useState<InstallManifestSummary | null>(
    seedFromInitial ? initialManifest : null,
  );
  const [source, setSource] = useState<InstallSource | null>(
    seedFromInitial ? initialSource ?? null : null,
  );
  const [manifestHash, setManifestHash] = useState<string>(
    seedFromInitial ? initialManifestHash ?? "" : "",
  );
  const [granted, setGranted] = useState<Set<string>>(() => {
    if (seedFromInitial && initialManifest) {
      return new Set(
        initialManifest.permissions.filter((p) => p.required).map((p) => p.id),
      );
    }
    return new Set();
  });
  const [dragActive, setDragActive] = useState(false);
  const [activeJob, setActiveJob] = useState<ActiveInstallJob | null>(null);
  const [doneResult, setDoneResult] = useState<InstallKickoffResult | null>(null);

  const lanTarget = useMemo(
    () =>
      open && targetDevice ? resolveLanTarget(targetDevice.deviceId) : null,
    [open, targetDevice],
  );
  const transport: InstallTransport = lanTarget ? "lan" : "cloud";

  // Display label for the install target. A no-drone (GCS-level) install
  // reads "Mission Control"; a drone install reads the drone name.
  const targetName = targetDevice?.name ?? "Mission Control";

  const reset = useCallback(() => {
    setStage("pick");
    setError(null);
    setManifest(null);
    setSource(null);
    setManifestHash("");
    setGranted(new Set());
    setDragActive(false);
    setActiveJob(null);
    setDoneResult(null);
  }, []);

  // True from the moment the install kickoff fires until the agent
  // either resolves or rejects it. Tracked on a ref so the close guard
  // sees the live value regardless of React batching, and so the hook
  // can clear it inside the success branch before delegating back to
  // `handleClose` (closing the modal once the kickoff is handed off).
  const installInflightRef = useRef(false);

  const handleClose = useCallback(() => {
    if (installInflightRef.current) {
      // The install kickoff is already on its way to the agent. Closing
      // the dialog mid-flight would drop the operator's only handle on
      // the in-flight job and reset state below it. Refuse silently;
      // the spinner copy tells the operator why the X is inert.
      return;
    }
    reset();
    onClose();
  }, [reset, onClose]);

  useEffect(() => {
    if (!open) {
      reset();
      return;
    }
    if (initialManifest && initialSource) {
      setStage("review");
      setManifest(initialManifest);
      setSource(initialSource);
      setManifestHash(initialManifestHash ?? "");
      setGranted(
        new Set(
          initialManifest.permissions
            .filter((p) => p.required)
            .map((p) => p.id),
        ),
      );
    }
  }, [open, reset, initialManifest, initialSource, initialManifestHash]);

  const parseFile = useCallback(async (file: File) => {
    setError(null);
    try {
      // One archive open yields both the manifest text and the Ed25519
      // verification result, so the badge row the operator consents against is
      // a verification outcome rather than a string from inside the archive.
      const { manifestYaml, signature } = await inspectArchive(file);
      if (signature.state === "invalid") {
        // A declared-but-unbacked signer, an unenrolled signer, or contents
        // that do not match the signature. Refuse before the review stage: the
        // operator must never be asked to consent to an archive whose publisher
        // claim is provably false.
        throw new Error(
          `Refusing to install: the archive's signature did not verify. ${signature.reason ?? ""}`.trim(),
        );
      }
      const parsed = parseManifestYaml(manifestYaml);
      const hashBytes = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(manifestYaml),
      );
      const hash = Array.from(new Uint8Array(hashBytes))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const summary = toInstallSummary(parsed, hash, {
        signatureState: signature.state,
        signerId: signature.verifiedSignerId,
      });
      setManifest(summary);
      setSource({ kind: "file", file, manifestHash: hash });
      setManifestHash(hash);
      setGranted(
        new Set(
          summary.permissions.filter((p) => p.required).map((p) => p.id),
        ),
      );
      setStage("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage("error");
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void parseFile(file);
    },
    [parseFile],
  );

  const onPick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void parseFile(file);
    },
    [parseFile],
  );

  const togglePermission = useCallback((id: string, required: boolean) => {
    if (required) return;
    setGranted((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Compute the compatibility result reactively so the review surface
  // can disable the install button when the host is incompatible.
  const compatibility = useMemo(() => {
    if (!manifest) {
      return {
        boardCompatible: true,
        ramOk: true,
        cpuOk: true,
      };
    }
    return checkCompatibility(manifest, {
      boardModel,
      boardName,
      boardSoc,
      ramTotalMb,
    });
  }, [manifest, boardModel, boardName, boardSoc, ramTotalMb]);

  const boardLabel = boardModel ?? boardName ?? boardSoc ?? "unknown";

  // The agent half (when the manifest has one) lands on a drone; the GCS
  // half lands on this Mission Control. The review surface shows both
  // destinations. A GCS-only plugin, or a hybrid opened from the no-drone
  // Settings home, has no agent destination (agentTargetName === null).
  const agentTargetName =
    manifest?.halves.includes("agent") && targetDevice
      ? targetDevice.name
      : null;

  const handleApprove = useInstallHandler({
    manifest,
    source,
    granted,
    transport,
    lanTarget,
    targetDevice,
    convexAvailable,
    generateUploadUrl,
    verifyArchive,
    createJob,
    recordInstall,
    grantPermission,
    setInstallStatus,
    manifestHash,
    onKickedOff,
    onJobStarted: setActiveJob,
    onDone: (result) => {
      setDoneResult(result);
      setStage("done");
    },
    setStage,
    setError,
    installInflightRef,
  });

  const title =
    stage === "pick"
      ? t("title.pick", { drone: targetName })
      : stage === "loading"
        ? t("title.loading")
        : stage === "review"
          ? t("title.review")
          : stage === "installing"
            ? t("title.installing")
            : stage === "done"
              ? t("title.done")
              : t("title.error");

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={title}
      // Review stage hosts the dense two-column install surface and
      // needs the 1280px × 90vh frame; the other stages stay at the
      // default medium width so pick/loading/error are not lost in a
      // near-fullscreen panel.
      size={stage === "review" ? "xl" : "md"}
      hideTitleBar={stage === "review"}
      disableBackdropClose
      closeBlocked={stage === "installing"}
      noBodyPadding={stage === "review"}
    >
      {stage !== "review" && (
        <TransportChrome
          targetName={targetName}
          transport={transport}
          lanAvailable={!!lanTarget}
        />
      )}

      {stage === "pick" && (
        <PickStage
          dragActive={dragActive}
          setDragActive={setDragActive}
          onDrop={onDrop}
          onPick={onPick}
        />
      )}

      {stage === "loading" && (
        <p className="px-4 py-6 text-center text-sm text-text-secondary">
          {t("loading")}
        </p>
      )}

      {stage === "review" && manifest && (
        <ReviewStage
          manifest={manifest}
          targetName={targetName}
          agentTargetName={agentTargetName}
          boardLabel={boardLabel}
          ramTotalMb={ramTotalMb}
          compatibility={compatibility}
          granted={granted}
          onTogglePermission={togglePermission}
          onCancel={handleClose}
          onInstall={handleApprove}
        />
      )}

      {stage === "installing" && (
        <div className="px-4 py-6 text-center">
          <p className="text-sm text-text-secondary">
            {t("installingVia", {
              drone: targetName,
              transport:
                transport === "lan"
                  ? t("transport.lan")
                  : t("transport.cloud"),
            })}
          </p>
          <p className="mt-2 text-xs text-text-tertiary">
            {t("closingDisabled")}
          </p>
          {activeJob?.transport === "lan" && (
            <div className="mt-4 text-left">
              <PluginInstallProgress
                jobId={activeJob.jobId}
                transport="lan"
                agentLanUrl={activeJob.agentLanUrl}
                pairingKey={activeJob.pairingKey}
                pluginName={manifest?.name}
                pluginVersion={manifest?.version}
                deviceLabel={targetName}
              />
            </div>
          )}
        </div>
      )}

      {stage === "done" && doneResult && (
        <div className="space-y-3 px-4 py-4">
          <p className="text-sm text-text-primary">
            {!manifest?.halves.includes("agent")
              ? t("done.gcsOnly")
              : doneResult.transport === "cloud"
                ? t("done.queued", { drone: targetName })
                : doneResult.enabledOnAgent
                  ? t("done.enabled", { drone: targetName })
                  : t("done.installed", { drone: targetName })}
          </p>
          {doneResult.notice && (
            <div
              role="alert"
              className="border border-status-warning/40 bg-status-warning/5 px-3 py-2 text-xs text-text-secondary"
            >
              {doneResult.notice}
            </div>
          )}
          {doneResult.transport === "cloud" && manifest?.halves.includes("agent") && (
            <PluginInstallProgress
              jobId={doneResult.jobId}
              transport="cloud"
              pluginName={doneResult.pluginName}
              pluginVersion={manifest.version}
              deviceLabel={targetName}
            />
          )}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleClose}
              className="border border-border-default px-3 py-1.5 text-sm hover:bg-bg-tertiary"
            >
              {t("done.close")}
            </button>
          </div>
        </div>
      )}

      {stage === "error" && (
        <ErrorStage
          error={error}
          onClose={handleClose}
          onRetry={() => reset()}
        />
      )}
    </Modal>
  );
}
