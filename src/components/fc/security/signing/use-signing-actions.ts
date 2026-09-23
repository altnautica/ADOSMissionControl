"use client";

/**
 * @module components/fc/security/signing/use-signing-actions
 * @description Extracted state and action handlers for the signing panel.
 *
 * Owns the lifecycle of enrollment, rotation, disable, and the cloud-sync
 * toggle, plus the two settle steps for an unconfirmed state. ArduPilot never
 * acknowledges SETUP_SIGNING, so a key that may be on the FC is never
 * discarded: an interrupted enrollment keeps both keys until the operator says
 * which one the FC holds, and a disable keeps the key until the operator
 * confirms unsigned commands are accepted. Also runs the on-mount effect that
 * pulls capability and key presence.
 */

import { useCallback, useEffect, useState } from "react";
import { useConvex } from "convex/react";
import type { ConvexReactClient } from "convex/react";

import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useSigningStore } from "@/stores/signing-store";
import { useAuthStore } from "@/stores/auth-store";
import {
  clear as clearKeystoreRecord,
  getRecord,
  settleUnconfirmedKey,
  updateEnrollmentState,
} from "@/lib/protocol/signing-keystore";
import { AgentHttpError } from "@/lib/agent/agent-client/transport";
import { allocateLocalLinkId } from "@/lib/protocol/link-id-allocator";
import {
  isCloudSigningKeySyncEnabled,
  removeCloudKey,
  uploadKey,
} from "@/lib/api/signing-cloud-sync";
import { emitSigningEvent } from "@/lib/api/signing-events";
import { setCloudSyncIntent } from "@/lib/protocol/signing-prefs";
import { useCloudRowSync } from "./use-cloud-row-sync";
import { enrollNewKey } from "./enroll-key";

export interface SigningActions {
  // Local UI state
  busy: boolean;
  error: string | null;
  enrollStartedAt: number | null;
  enrollFailed: boolean;
  exportOpen: boolean;
  importOpen: boolean;
  cloudSyncBusy: boolean;
  cloudSyncError: string | null;
  // Cloud sync flags
  cloudRowPresent: boolean;
  cloudSyncIntent: boolean;
  // Auth flags surfaced for the UI
  isAuthenticated: boolean;
  authLoading: boolean;
  // UI setters
  setExportOpen: (open: boolean) => void;
  setImportOpen: (open: boolean) => void;
  setEnrollStartedAt: (at: number | null) => void;
  setEnrollFailed: (failed: boolean) => void;
  setBusy: (busy: boolean) => void;
  // Action handlers
  handleEnable: () => Promise<void>;
  handleDisable: () => Promise<void>;
  handleRotate: () => Promise<void>;
  handleCloudSyncToggle: () => Promise<void>;
  /** Settle an unconfirmed enrollment: the FC took the new key, or kept the old one. */
  handleSettleNewKey: (fcHolds: "new" | "previous") => Promise<void>;
  /** Settle an unconfirmed disable: signing is off on the FC, or it is still on. */
  handleSettleDisable: (signingOff: boolean) => Promise<void>;
}

export function useSigningActions(droneId: string): SigningActions {
  const client = useAgentConnectionStore((s) => s.client);

  const state = useSigningStore((s) => s.drones[droneId]);
  const setCapability = useSigningStore((s) => s.setCapability);
  const setBrowserKey = useSigningStore((s) => s.setBrowserKey);
  const setEnrollmentState = useSigningStore((s) => s.setEnrollmentState);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enrollStartedAt, setEnrollStartedAt] = useState<number | null>(null);
  const [enrollFailed, setEnrollFailed] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [cloudSyncBusy, setCloudSyncBusy] = useState(false);
  const [cloudSyncError, setCloudSyncError] = useState<string | null>(null);

  const convexClient: ConvexReactClient = useConvex();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const authLoading = useAuthStore((s) => s.isLoading);

  // cloudSyncIntent is the persisted "I want cloud sync" preference; it
  // and cloudRowPresent can disagree. Operator flips intent on -> next
  // rotation uploads -> cloudRowPresent becomes true. Flipping intent
  // off deletes the row immediately.
  const {
    cloudRowPresent,
    cloudSyncIntent,
    setCloudRowPresent,
    setCloudSyncIntent: setCloudSyncIntentState,
  } = useCloudRowSync(droneId, convexClient, isAuthenticated);

  // On drone change, refresh capability + local key presence.
  useEffect(() => {
    if (!droneId || !client) return;
    let cancelled = false;
    (async () => {
      try {
        const cap = await client.getSigningCapability();
        if (!cancelled) setCapability(droneId, cap);
      } catch {
        // keep whatever we had
      }
      const rec = await getRecord(droneId);
      if (cancelled) return;
      setBrowserKey(
        droneId,
        rec
          ? {
              keyId: rec.keyId,
              enrolledAt: rec.enrolledAt,
              enrollmentState: rec.enrollmentState,
              previousKeyId: rec.previous?.keyId ?? null,
            }
          : null,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [client, droneId, setCapability, setBrowserKey]);

  const handleCloudSyncToggle = useCallback(async () => {
    if (!droneId) return;
    if (!isAuthenticated) {
      setCloudSyncError("Sign in to manage cloud sync.");
      return;
    }
    setCloudSyncBusy(true);
    setCloudSyncError(null);
    const newIntent = !cloudSyncIntent;
    try {
      if (newIntent && !isCloudSigningKeySyncEnabled()) {
        setCloudSyncError("Cloud signing-key sync is disabled until encrypted storage is available.");
        return;
      }

      // Persist intent first so UI reflects the user's choice
      // immediately, regardless of what happens on the cloud side.
      await setCloudSyncIntent(droneId, newIntent);
      setCloudSyncIntentState(newIntent);

      if (!newIntent) {
        // Opt out: remove the cloud row if present. Local key stays so
        // this browser keeps signing. Other devices that already pulled
        // the key keep working until next rotation on any device.
        if (convexClient && cloudRowPresent) {
          await removeCloudKey(convexClient, droneId);
          setCloudRowPresent(false);
        }
        void emitSigningEvent(convexClient, isAuthenticated, {
          droneId,
          eventType: "cloud_sync_off",
          keyIdOld: state?.keyId ?? undefined,
        });
        return;
      }

      // Opt in: we flip the toggle and emit the event immediately. The
      // actual key upload happens on the next enroll or rotate, since
      // that is the only moment raw key bytes are legible in JS memory.
      // If there is no browser key yet, the upload happens on the first
      // enrollment. If there is one, the panel nudges the user to
      // rotate to push it.
      void emitSigningEvent(convexClient, isAuthenticated, {
        droneId,
        eventType: "cloud_sync_on",
        keyIdOld: state?.keyId ?? undefined,
      });
    } catch (e) {
      setCloudSyncError(e instanceof Error ? e.message : String(e));
      // Roll back the intent flag if anything failed on our side.
      try {
        await setCloudSyncIntent(droneId, cloudSyncIntent);
        setCloudSyncIntentState(cloudSyncIntent);
      } catch {
        // nothing to roll back to
      }
    } finally {
      setCloudSyncBusy(false);
    }
  }, [cloudSyncIntent, cloudRowPresent, convexClient, droneId, isAuthenticated, state?.keyId, setCloudRowPresent, setCloudSyncIntentState]);

  const handleEnable = useCallback(async () => {
    if (!client || !droneId) return;
    setBusy(true);
    setError(null);
    setEnrollFailed(false);

    // Enrollment needs an online FC: SETUP_SIGNING is the only way the key
    // reaches it, and nothing is kept for a later attempt.
    let capability;
    try {
      capability = await client.getSigningCapability();
    } catch {
      capability = null;
    }
    if (capability && capability.reason === "fc_not_connected") {
      setError(
        "Flight controller is not connected. Enrollment needs an online drone. Try again once the drone reconnects.",
      );
      setBusy(false);
      return;
    }

    setEnrollStartedAt(Date.now());
    const userId = isAuthenticated ? (useAuthStore.getState().user?.id ?? null) : null;
    const prevKeyId = state?.keyId ?? undefined;
    const linkId = allocateLocalLinkId();
    try {
      // The outcome is honoured whenever it arrives: a late answer still
      // decides what this browser keeps.
      const outcome = await enrollNewKey({ client, droneId, linkId, userId });

      if (outcome.kind === "failed") {
        setError(outcome.error);
        setEnrollFailed(true);
        return;
      }

      if (outcome.kind === "unconfirmed") {
        setBrowserKey(droneId, {
          keyId: outcome.keyId,
          enrolledAt: outcome.enrolledAt,
          enrollmentState: "unconfirmed",
          previousKeyId: outcome.previousKeyId,
        });
        setError(outcome.reason);
        return;
      }

      // Cloud sync upload happens while the hex string is still in scope; the
      // stored CryptoKey is non-extractable and cannot hand the bytes back.
      if (cloudSyncIntent && convexClient && isAuthenticated) {
        try {
          await uploadKey(convexClient, {
            droneId,
            keyHex: outcome.keyHex,
            keyId: outcome.keyId,
            linkIdOwner: linkId,
            enrolledAt: outcome.enrolledAt,
          });
          setCloudRowPresent(true);
        } catch (e) {
          setCloudSyncError(
            `Cloud sync upload failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      setBrowserKey(droneId, {
        keyId: outcome.keyId,
        enrolledAt: outcome.enrolledAt,
        enrollmentState: "enrolled",
      });
      setEnrollStartedAt(null);
      void emitSigningEvent(convexClient, isAuthenticated, {
        droneId,
        eventType: prevKeyId ? "rotation" : "enrollment",
        keyIdOld: prevKeyId,
        keyIdNew: outcome.keyId,
      });
    } finally {
      setBusy(false);
    }
  }, [client, droneId, setBrowserKey, cloudSyncIntent, convexClient, isAuthenticated, state?.keyId, setCloudRowPresent]);

  const handleDisable = useCallback(async () => {
    if (!client || !droneId) return;
    if (!confirm("Disable MAVLink signing for this drone?\n\nThis sends the flight controller an empty key. The flight controller does not acknowledge it, so this browser keeps its key until you confirm unsigned commands are accepted.")) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await client.disableSigningOnFc();
    } catch (e) {
      if (e instanceof AgentHttpError) {
        // The agent answered and sent nothing: signing is unchanged.
        setError(e.message);
        setBusy(false);
        return;
      }
      // The request may have reached the FC before it failed.
      setError(`The disable request did not complete (${e instanceof Error ? e.message : String(e)}); it may have reached the flight controller.`);
    }
    await updateEnrollmentState(droneId, "disable_unconfirmed");
    setEnrollmentState(droneId, "disable_unconfirmed");
    setBusy(false);
  }, [client, droneId, setEnrollmentState]);

  const handleSettleDisable = useCallback(async (signingOff: boolean) => {
    if (!droneId) return;
    setError(null);
    if (!signingOff) {
      await updateEnrollmentState(droneId, "enrolled");
      setEnrollmentState(droneId, "enrolled");
      return;
    }
    const prevKeyId = state?.keyId ?? undefined;
    await clearKeystoreRecord(droneId);
    setBrowserKey(droneId, null);
    void emitSigningEvent(convexClient, isAuthenticated, {
      droneId,
      eventType: "disable",
      keyIdOld: prevKeyId,
    });
  }, [droneId, setEnrollmentState, setBrowserKey, state?.keyId, convexClient, isAuthenticated]);

  const handleSettleNewKey = useCallback(async (fcHolds: "new" | "previous") => {
    if (!droneId) return;
    setError(null);
    const settled = await settleUnconfirmedKey(droneId, fcHolds === "new" ? "current" : "previous");
    if (!settled) {
      setError("There is no retained key to restore for this drone.");
      return;
    }
    setBrowserKey(droneId, { keyId: settled.keyId, enrolledAt: settled.enrolledAt, enrollmentState: "enrolled" });
  }, [droneId, setBrowserKey]);

  const handleRotate = useCallback(async () => {
    if (!client || !droneId) return;
    if (!confirm("Rotate the signing key?\n\nA new 32-byte key will be generated and enrolled with the flight controller. The old key is replaced once the agent reports the new one sent.")) {
      return;
    }
    await handleEnable();
  }, [client, droneId, handleEnable]);

  return {
    busy,
    error,
    enrollStartedAt,
    enrollFailed,
    exportOpen,
    importOpen,
    cloudSyncBusy,
    cloudSyncError,
    cloudRowPresent,
    cloudSyncIntent,
    isAuthenticated,
    authLoading,
    setExportOpen,
    setImportOpen,
    setEnrollStartedAt,
    setEnrollFailed,
    setBusy,
    handleEnable,
    handleDisable,
    handleRotate,
    handleCloudSyncToggle,
    handleSettleNewKey,
    handleSettleDisable,
  };
}
