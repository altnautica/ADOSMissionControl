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
import { resolveRelayTarget } from "../transports/resolve-lan-url";
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
import { fetchRegistryArchive, pinArchive } from "@/lib/plugins/archive-pin";
import { usePairingStore } from "@/stores/pairing-store";
import type {
  InstallKickoffResult,
  InstallTransport,
} from "../transports/types";
import type {
  InstallManifestSummary,
  InstallSource,
  InstallTargetDrone,
} from "./types";

type Stage = "pick" | "loading" | "review" | "installing" | "done" | "error";

/** The job the dialog can follow while (and after) the install runs. */
export interface ActiveInstallJob {
  jobId: string;
  transport: InstallTransport;
  /** LAN only: where the agent streams the job's progress. */
  agentLanUrl?: string;
  pairingKey?: string;
}

/** Why a drone reached only through its ground station's radio relay gets
 * no install: the agent refuses plugin installs from relayed requests. */
export const RELAY_INSTALL_REFUSED =
  "This drone is reached only through its ground station's radio relay, and it refuses plugin installs over the relay: a relayed request carries no credential for the drone itself, so accepting one would let anything in radio range install code. Connect to the drone on the LAN, or pair it with your cloud account, to install.";

function isCloudPaired(deviceId: string): boolean {
  return usePairingStore.getState().pairedDrones.some((d) => d.deviceId === deviceId);
}

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
  /** Stores the plugin's GCS iframe bundle server-side; returns its id. */
  storeBundle: (args: { html: string }) => Promise<string>;
  /** Records the GCS-side install row so the plugin's GCS half mounts.
   * Returns the install id. */
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
  /** Called before a request that has a job to follow, so the dialog can
   * show its progress while the request is open. */
  onJobStarted: (job: ActiveInstallJob) => void;
  /** Called with the outcome once the install is over (LAN) or queued
   * (cloud). The dialog shows it, including any notice. */
  onDone: (result: InstallKickoffResult) => void;
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
    storeBundle,
    recordInstall,
    grantPermission,
    setInstallStatus,
    manifestHash,
    onKickedOff,
    onJobStarted,
    onDone,
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
        const result = { ...(await mockPluginInstall(transport, ctx)), jobId };
        onKickedOff?.(result);
        installInflightRef.current = false;
        onDone(result);
        return;
      }

      const hasAgentHalf = manifest.halves.includes("agent");
      const hasGcsHalf = manifest.halves.includes("gcs");

      // The GCS half needs a place to load its bundle from on every mount:
      // the drone's agent (a hybrid installed over the LAN), the published
      // registry archive, or the cloud copy the signed-in finalize stores.
      // A local file with none of those would install nothing the GCS can
      // show, so refuse before touching the drone.
      const localBundleSource =
        (hasAgentHalf && targetDevice !== null && lanTarget !== null) ||
        source.kind === "registry";
      if (hasGcsHalf && !localBundleSource && !convexAuthenticated) {
        throw new Error(
          hasAgentHalf
            ? "This plugin's Mission Control half can only be kept for a drone reached on this network, or with a cloud sign-in. Connect to the drone on the LAN, or sign in, and retry."
            : "Mission Control plugins installed from a file need a cloud sign-in to be kept. Sign in, or install it from the registry.",
        );
      }

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
        const relayOnly = () => resolveRelayTarget(targetDevice.deviceId) !== null;
        const cloudReachable = convexAvailable && isCloudPaired(targetDevice.deviceId);
        if (source.kind === "registry") {
          // The agent fetches the archive itself, so a registry install
          // needs the drone's own LAN reach.
          if (!lanTarget) {
            throw new Error(
              relayOnly()
                ? RELAY_INSTALL_REFUSED
                : "Registry installs need the drone paired on this network. Pair it on the LAN and retry.",
            );
          }
          onJobStarted({ jobId, transport: "lan", agentLanUrl: lanTarget.url, pairingKey: lanTarget.apiKey });
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
          const ctx = {
            file: source.file,
            manifest,
            grantedPermissions: grantedArr,
            deviceId: targetDevice.deviceId,
            deviceName: targetDevice.name,
          };
          const viaCloud = () =>
            installCloudRelay({
              ...ctx,
              generateUploadUrl,
              verifyArchive,
              createJob,
              manifestHash,
            });
          if (lanTarget) {
            onJobStarted({ jobId, transport: "lan", agentLanUrl: lanTarget.url, pairingKey: lanTarget.apiKey });
            try {
              result = await installLanDirect({
                ...ctx,
                agentUrl: lanTarget.url,
                pairingKey: lanTarget.apiKey,
                jobId,
              });
            } catch (err) {
              // Only a failure that proves nothing installed may fall over,
              // and only to a cloud path that can reach this drone.
              if (!(err instanceof LanDirectError && shouldFailover(err) && cloudReachable)) {
                throw err;
              }
              result = await viaCloud();
              result.notice = `The LAN install failed (${err.message}); the install was queued through the cloud instead.`;
            }
          } else if (cloudReachable) {
            result = await viaCloud();
          } else {
            throw new Error(
              relayOnly()
                ? RELAY_INSTALL_REFUSED
                : "This drone is not reachable for an install. Pair it on this network, or pair it with your cloud account.",
            );
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
          enabledOnAgent: false,
        };
      }

      // Local-first record of a GCS-only plugin: no node holds it, so this
      // browser remembers the install and its bundle comes from the
      // published archive, hashed and signature-verified here and pinned so
      // a later mount refuses replaced bytes. A plugin with an agent half is
      // never recorded here: its node's own install list is the source of
      // truth, whoever installed it. A local-file GCS-only install has no
      // offline source and relies on the signed-in Convex finalize below (it
      // was refused above when there is no sign-in).
      if (hasGcsHalf && !hasAgentHalf && source.kind === "registry") {
        const gcsParameters = buildGcsParameters(manifest);
        const pin = await pinArchive(await fetchRegistryArchive(source.url), {
          expectedSha256: source.expectedSha256,
          manifestSignerId: manifest.signerId,
        });
        useLocalPluginInstallsStore.getState().record({
          pluginId: manifest.pluginId,
          deviceId: targetDevice?.deviceId ?? null,
          version: manifest.version,
          name: manifest.name,
          halves: [...manifest.halves],
          gcsContributes: buildGcsContributes(manifest),
          ...(gcsParameters ? { gcsParameters } : {}),
          grantedCaps: [...grantedArr],
          manifestHash,
          bundle: {
            kind: "archive",
            archiveUrl: source.url,
            entrypoint: manifest.gcsEntrypoint ?? "gcs/plugin.bundle.js",
            pin,
          },
          installedAt: Date.now(),
        });
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
            expectedSha256:
              source.kind === "registry" ? source.expectedSha256 : undefined,
            manifest,
            manifestHash,
            grantedPermissions: grantedArr,
            deviceId: targetDevice?.deviceId ?? null,
            source: source.kind === "registry" ? "registry" : "local_file",
            sourceUri: source.kind === "registry" ? source.url : undefined,
            agentEnabled: result.enabledOnAgent,
            callables: {
              storeBundle,
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
      installInflightRef.current = false;
      onDone(result);
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
    storeBundle,
    recordInstall,
    grantPermission,
    setInstallStatus,
    manifestHash,
    onKickedOff,
    onJobStarted,
    onDone,
    setStage,
    setError,
    installInflightRef,
  ]);
}
