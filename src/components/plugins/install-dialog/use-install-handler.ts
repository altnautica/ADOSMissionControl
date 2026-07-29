/**
 * @module use-install-handler
 * @description Extracted install-orchestration callback for the plugin
 * install dialog. The orchestrator (`PluginInstallDialog`) owns the
 * stage + error state and the resolved transport/lanTarget; this hook
 * builds the actual install kickoff, demo-mode short-circuit, and
 * registry-vs-file branching that used to live inline in
 * `handleApprove`.
 *
 * Splitting this out keeps the orchestrator under the LOC ceiling
 * without changing behaviour. The hook returns a stable callback that
 * the orchestrator wires to the Install button.
 *
 * @license GPL-3.0-only
 */

import { useCallback, type MutableRefObject } from "react";

import { isDemoMode } from "@/lib/utils";

import {
  installLanDirect,
  shouldFailover,
  LanDirectError,
} from "../transports/lan-direct";
import { installLanDirectFromUrl } from "../transports/lan-direct-url";
import {
  installRelayFromUrl,
  pollRelayInstallProgress,
} from "../transports/relay-url";
import { resolveRelayTarget } from "../transports/resolve-lan-url";
import { useInstallProgressStore } from "../install-progress-store";
import {
  installCloudRelay,
  type CreateJobMutation,
  type GenerateUploadUrlAction,
  type VerifyArchiveAction,
} from "../transports/cloud-relay";
import {
  finalizeGcsInstall,
  type RecordInstallArgs,
} from "../transports/finalize-gcs-install";
import {
  buildGcsContributes,
  buildGcsParameters,
} from "../transports/build-install-contributions";
import { useAuthStore } from "@/stores/auth-store";
import { useLocalPluginInstallsStore } from "@/stores/local-plugin-installs-store";
import type {
  InstallKickoffResult,
  InstallTransport,
} from "../transports/types";
import type {
  InstallManifestSummary,
  InstallSource,
  InstallTargetDrone,
} from "./types";

type Stage = "pick" | "loading" | "review" | "installing" | "error";

export interface UseInstallHandlerArgs {
  manifest: InstallManifestSummary | null;
  source: InstallSource | null;
  granted: Set<string>;
  transport: InstallTransport;
  lanTarget: { url: string; apiKey: string } | null;
  /** Drone the agent half installs on, or null for a GCS-level / fleet
   * install (no drone) from the Settings → Plugins home. */
  targetDevice: InstallTargetDrone | null;
  convexAvailable: boolean;
  generateUploadUrl: GenerateUploadUrlAction;
  verifyArchive: VerifyArchiveAction;
  createJob: CreateJobMutation;
  /** Records the GCS-side install row + uploads the iframe bundle so the
   * plugin's GCS half mounts. Returns the install id. */
  recordInstall: (args: RecordInstallArgs) => Promise<string>;
  grantPermission: (args: {
    installId: string;
    permissionId: string;
  }) => Promise<unknown>;
  setInstallStatus: (args: {
    installId: string;
    status: string;
  }) => Promise<unknown>;
  manifestHash: string;
  onKickedOff?: (result: InstallKickoffResult) => void;
  /** Close path used on a successful kickoff. The orchestrator passes
   * a variant that bypasses the in-flight close guard so the dialog
   * actually closes once the install has been handed off. */
  onClose: () => void;
  setStage: (stage: Stage) => void;
  setError: (error: string | null) => void;
  /** Flipped to `true` for the lifetime of the install kickoff so the
   * orchestrator's close guard can refuse Esc and the X button while
   * the request is in flight. Cleared in both success and failure
   * branches. */
  installInflightRef: MutableRefObject<boolean>;
}

/**
 * Mint a job id for the install kickoff. The progress toast and the
 * agent both echo this id so the GCS can subscribe to job progress
 * before the upload completes.
 */
function newJobId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Build the install-kickoff callback. Returns a stable `useCallback` so
 * the orchestrator can hand it straight to the Install button without
 * triggering ReviewStage re-renders on every parent render.
 */
export function useInstallHandler(args: UseInstallHandlerArgs) {
  const {
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
    onClose,
    setStage,
    setError,
    installInflightRef,
  } = args;

  // The GCS-side finalize records the install + uploads the iframe bundle
  // through Convex (per-user storage + install rows), which needs a
  // signed-in cloud session. A LAN-only operator (local-first, not signed
  // in) still installs on the agent; the Convex finalize is skipped so it
  // never throws "Not authenticated".
  const convexAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return useCallback(async () => {
    if (!manifest || !source) return;
    setStage("installing");
    setError(null);
    installInflightRef.current = true;
    try {
      const jobId = newJobId();
      const grantedArr = [...granted] as ReadonlyArray<string>;

      // Demo-mode short-circuit. Avoid any real wire traffic.
      if (isDemoMode()) {
        const { mockPluginInstall } = await import(
          "@/mock/mock-plugin-install"
        );
        const demoDeviceId = targetDevice?.deviceId ?? "";
        const demoDeviceName = targetDevice?.name ?? "Mission Control";
        const ctx =
          source.kind === "file"
            ? {
                file: source.file,
                manifest,
                grantedPermissions: grantedArr,
                deviceId: demoDeviceId,
                deviceName: demoDeviceName,
              }
            : {
                // The mock helper takes a File; for registry sources we
                // fake a small placeholder so the demo flow stays
                // realistic without an actual archive on hand.
                file: new File([new Uint8Array()], "registry.adosplug"),
                manifest,
                grantedPermissions: grantedArr,
                deviceId: demoDeviceId,
                deviceName: demoDeviceName,
              };
        const result = await mockPluginInstall(transport, ctx);
        onKickedOff?.({ ...result, jobId });
        // Clear the in-flight flag before delegating to onClose so the
        // orchestrator's close guard lets the modal actually close.
        installInflightRef.current = false;
        onClose();
        return;
      }

      const hasAgentHalf = manifest.halves.includes("agent");
      const hasGcsHalf = manifest.halves.includes("gcs");

      let result: InstallKickoffResult;

      if (hasAgentHalf) {
        // The agent half installs software ON a drone, so a target is
        // required. The Settings → Plugins home (no drone) routes only
        // GCS-only plugins; a hybrid is installed from a drone's tab.
        if (!targetDevice) {
          throw new Error(
            "This plugin installs software on a drone. Open it from a drone's Plugins tab to choose where it runs.",
          );
        }
        if (source.kind === "registry") {
          // The agent fetches the archive itself, so registry installs
          // never touch the file-upload transports. Resolution order:
          // a LAN-paired drone installs directly; a relay-only drone
          // (no LAN reach of its own) installs through its ground
          // station's relay proxy — the only lane that fits the archive
          // pointer through the radio link's per-request size cap.
          if (lanTarget) {
            result = await installLanDirectFromUrl({
              agentUrl: lanTarget.url,
              pairingKey: lanTarget.apiKey,
              url: source.url,
              expectedSha256: source.expectedSha256,
              grantedPermissions: grantedArr,
              jobId,
              pluginId: manifest.pluginId,
              pluginName: manifest.name,
              deviceId: targetDevice.deviceId,
              fromCatalog: true,
            });
          } else {
            const relayTarget = resolveRelayTarget(targetDevice.deviceId);
            if (!relayTarget) {
              throw new Error(
                "Registry installs require a paired drone on the LAN, or a ground station relaying it over its radio link. Pair the drone, or pair its ground station, and retry.",
              );
            }
            // No LAN job-ticket WebSocket exists over the relay yet, so a
            // fixed-interval poll stands in for live progress while the
            // kickoff request is in flight. Stopped in both branches
            // below so a fast agent reply never races a stale tick.
            const stopRelayPoll = pollRelayInstallProgress({
              relayBaseUrl: relayTarget.url,
              apiKey: relayTarget.apiKey,
              jobId,
              pluginName: manifest.name,
              pluginVersion: manifest.version,
              deviceId: targetDevice.deviceId,
            });
            try {
              result = await installRelayFromUrl({
                relayBaseUrl: relayTarget.url,
                apiKey: relayTarget.apiKey,
                url: source.url,
                sha256: source.expectedSha256,
                jobId,
                pluginId: manifest.pluginId,
                pluginName: manifest.name,
                deviceId: targetDevice.deviceId,
              });
              useInstallProgressStore.getState().upsert({
                jobId,
                stage: "completed",
                transport: "relay",
                updatedAt: Date.now(),
                pluginName: manifest.name,
                pluginVersion: manifest.version,
                deviceId: targetDevice.deviceId,
              });
            } catch (err) {
              // Never fall through to cloud-relay here: a relay install
              // that fails must surface that failure so the operator
              // sees it, not silently retry over a transport that is
              // unavailable in local-only mode anyway.
              useInstallProgressStore.getState().upsert({
                jobId,
                stage: "failed",
                transport: "relay",
                updatedAt: Date.now(),
                error: {
                  code:
                    err instanceof LanDirectError ? err.cause : "unknown",
                  message: err instanceof Error ? err.message : String(err),
                },
                pluginName: manifest.name,
                pluginVersion: manifest.version,
                deviceId: targetDevice.deviceId,
              });
              throw err;
            } finally {
              stopRelayPoll();
            }
          }
        } else {
          const ctx = {
            file: source.file,
            manifest,
            grantedPermissions: grantedArr,
            deviceId: targetDevice.deviceId,
            deviceName: targetDevice.name,
          };
          if (transport === "lan" && lanTarget) {
            try {
              result = await installLanDirect({
                ...ctx,
                agentUrl: lanTarget.url,
                pairingKey: lanTarget.apiKey,
                jobId,
              });
            } catch (err) {
              if (err instanceof LanDirectError && shouldFailover(err)) {
                if (!convexAvailable) {
                  throw new Error(
                    `${err.message}. Cloud relay unavailable, please retry on the LAN.`,
                  );
                }
                result = await installCloudRelay({
                  ...ctx,
                  generateUploadUrl,
                  verifyArchive,
                  createJob,
                  manifestHash,
                });
                result.notice =
                  "LAN upload failed, falling back to cloud relay";
              } else {
                throw err;
              }
            }
          } else {
            if (!convexAvailable) {
              throw new Error(
                "Cloud relay requires the Convex backend. Connect to the agent on the LAN to install a plugin.",
              );
            }
            result = await installCloudRelay({
              ...ctx,
              generateUploadUrl,
              verifyArchive,
              createJob,
              manifestHash,
            });
          }
        }
      } else {
        // GCS-only plugin: nothing installs on a drone, so there is no
        // agent transport. The GCS half is recorded / uploaded below.
        result = {
          transport: lanTarget ? "lan" : "cloud",
          jobId,
          pluginId: manifest.pluginId,
          pluginName: manifest.name,
          deviceId: targetDevice?.deviceId ?? "",
        };
      }

      // Local-first GCS-half record (Rule 39): remember the install so the
      // contribution producers mount the iframe with no cloud. The bundle
      // source depends on the install shape:
      //   - hybrid on a drone  → the drone's agent serves gcs/plugin.bundle.js
      //   - GCS-only from the registry → the published archive serves it
      // A GCS-only local-file install with no drone has no offline source
      // (no agent, no url), so it relies on the Convex finalize below.
      // Independent of sign-in; the Convex finalize is the optional cloud
      // mirror for fleet view / cross-device.
      if (hasGcsHalf) {
        const recordDeviceId = targetDevice?.deviceId ?? null;
        const gcsContributes = buildGcsContributes(manifest);
        const gcsParameters = buildGcsParameters(manifest);
        let bundle: Parameters<
          ReturnType<typeof useLocalPluginInstallsStore.getState>["record"]
        >[0]["bundle"] | null = null;
        if (hasAgentHalf && targetDevice && lanTarget) {
          bundle = {
            kind: "agent",
            deviceId: targetDevice.deviceId,
            entrypoint: "gcs/plugin.bundle.js",
          };
        } else if (source.kind === "registry") {
          bundle = {
            kind: "archive",
            archiveUrl: source.url,
            sha256: source.expectedSha256,
            entrypoint: "gcs/plugin.bundle.js",
          };
        }
        if (bundle) {
          useLocalPluginInstallsStore.getState().record({
            pluginId: manifest.pluginId,
            deviceId: recordDeviceId,
            version: manifest.version,
            name: manifest.name,
            halves: [...manifest.halves],
            gcsContributes,
            ...(gcsParameters ? { gcsParameters } : {}),
            grantedCaps: [...grantedArr],
            manifestHash,
            bundle,
            installedAt: Date.now(),
          });
        }
      }

      // Record the install on the GCS side and, for a plugin with a GCS
      // half, upload its iframe bundle so the contribution producer mounts
      // it. This uses Convex storage + per-user install rows, so it runs
      // only when signed in to the cloud; a LAN-only operator already got
      // the local record above. Non-fatal: a failure leaves the agent
      // install intact and only means the cloud mirror is skipped.
      if (convexAuthenticated) {
        try {
          await finalizeGcsInstall({
            archive: source.kind === "file" ? source.file : undefined,
            archiveUrl: source.kind === "registry" ? source.url : undefined,
            manifest,
            manifestHash,
            grantedPermissions: grantedArr,
            deviceId: targetDevice?.deviceId ?? null,
            source: source.kind === "registry" ? "registry" : "local_file",
            sourceUri: source.kind === "registry" ? source.url : undefined,
            callables: {
              generateUploadUrl,
              recordInstall,
              grantPermission,
              setStatus: setInstallStatus,
            },
          });
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          const note = `Installed on the drone, but the GCS panel could not be prepared: ${detail}`;
          result.notice = result.notice ? `${result.notice}. ${note}` : note;
        }
      }

      onKickedOff?.(result);
      // Clear the in-flight flag before delegating to onClose so the
      // orchestrator's close guard lets the modal actually close.
      installInflightRef.current = false;
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage("error");
    } finally {
      installInflightRef.current = false;
    }
  }, [
    manifest,
    source,
    granted,
    transport,
    lanTarget,
    // The whole (possibly null) target — callers memoize it (or pass a
    // stable null for a GCS-level install), so the identity is stable.
    targetDevice,
    convexAvailable,
    convexAuthenticated,
    generateUploadUrl,
    verifyArchive,
    createJob,
    recordInstall,
    grantPermission,
    setInstallStatus,
    manifestHash,
    onKickedOff,
    onClose,
    setStage,
    setError,
    installInflightRef,
  ]);
}
