"use client";

/**
 * @module use-pairing-flow
 * @description State machine + countdown + Convex mutation orchestration
 * for the pairing dialog. Returns flat state plus action handlers ready
 * for the per-stage UI components in `./pairing/*`.
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { usePairingStore, type DiscoveredAgent } from "@/stores/pairing-store";
import type { Id } from "../../../../convex/_generated/dataModel";

export type PairingState = "setup" | "waiting" | "success" | "error" | "expired";

export interface PairedInfo {
  deviceId: string;
  name: string;
  apiKey: string;
  /** The network address the agent reported (mDNS name, else LAN IP), or
   *  null when it reported neither. Never synthesised. */
  host: string | null;
}

export type ClaimCodeMutation = ((args: { code: string }) => Promise<
  | { error: "invalid_pairing_code" | "pairing_code_expired" | "code_already_claimed" | "device_owned_by_other" }
  | { error: "rate_limited"; retryAfterMs: number }
  | {
      error?: null;
      deviceId: string;
      name?: string;
      apiKey?: string;
      mdnsHost?: string;
      localIp?: string;
    }
>) | null;

export type PairingRequestId = Id<"cmd_pairingRequests">;

export type PreGenerateMutation = ((args: Record<string, never>) => Promise<{
  requestId: PairingRequestId;
  code: string;
}>) | null;

/**
 * Subscribes to one pre-generated pairing request and calls `onClaimed` with
 * the device id once an agent registers against that exact code. Returns the
 * unsubscribe function.
 */
export type ClaimWatch = (
  requestId: PairingRequestId,
  onClaimed: (deviceId: string) => void,
) => () => void;

export const INSTALL_URL =
  "https://raw.githubusercontent.com/altnautica/ADOSDroneAgent/main/scripts/install.sh";
const CODE_TTL_MS = 15 * 60 * 1000;

export function buildInstallCommand(code: string) {
  return `curl -sSL ${INSTALL_URL} | sudo bash -s -- --pair ${code}`;
}

interface FlowOptions {
  open: boolean;
  requiresSignIn: boolean;
  claimCode: ClaimCodeMutation;
  preGenerate: PreGenerateMutation;
  onPaired?: (deviceId: string, apiKey: string, url: string) => void;
  /** Watches the generated code's own pairing request. Null without a
   *  signed-in cloud backend, in which case no generated code can pair. */
  watchClaim: ClaimWatch | null;
  /** Called by `generateCode` so the parent can reset its own UI flags. */
  onCodeReset?: () => void;
  /** Pre-filled code from a deep-link entry. Skips the auto-generate path
   *  and immediately tries to claim the supplied code. */
  initialCode?: string | null;
  /** When true (default), the flow auto-generates a fresh pair code on
   *  dialog open. Pass false when the dialog opens on a tab whose body
   *  expects the operator to type the drone's own code instead — the
   *  generate step then runs only when the operator manually switches
   *  to the "Generate a code" tab. */
  autoGenerate?: boolean;
}

export function usePairingFlow({
  open,
  requiresSignIn,
  claimCode,
  preGenerate,
  onPaired,
  watchClaim,
  onCodeReset,
  initialCode,
  autoGenerate = true,
}: FlowOptions) {
  const [state, setState] = useState<PairingState>("setup");
  const [preGenCode, setPreGenCode] = useState<string | null>(null);
  // The pairing request behind `preGenCode` and the device that registered
  // against it. Success is tied to this request, never to "some drone
  // appeared in the fleet".
  const [requestId, setRequestId] = useState<PairingRequestId | null>(null);
  const [claimedDeviceId, setClaimedDeviceId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(CODE_TTL_MS / 1000);
  const [pairedInfo, setPairedInfo] = useState<PairedInfo | null>(null);
  // True when the failure is "code not in the cloud". The agent is almost
  // certainly in local mode, so the UI should offer pairing by hostname on the
  // LAN instead of pushing the cloud path again.
  const [canPairLocally, setCanPairLocally] = useState(false);

  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const codeGeneratedAt = useRef<number>(0);
  const generatingRef = useRef(false);
  // Deferred `onPaired` handles, tracked so cleanup can clear them and a
  // claim that resolves after the dialog closes never fires onPaired for a
  // dismissed node. Two distinct sources schedule one: the deep-link claim
  // and the watch-for-new-drone effect.
  const deferredClaimPairedRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const deferredWatchPairedRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const pairedDrones = usePairingStore((s) => s.pairedDrones);
  const setPairingInProgress = usePairingStore((s) => s.setPairingInProgress);
  const setPairingError = usePairingStore((s) => s.setPairingError);

  const stopCountdown = useCallback(() => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }, []);

  const startCountdown = useCallback(() => {
    stopCountdown();
    codeGeneratedAt.current = Date.now();
    setSecondsLeft(CODE_TTL_MS / 1000);

    countdownRef.current = setInterval(() => {
      const elapsed = Date.now() - codeGeneratedAt.current;
      const remaining = Math.max(
        0,
        Math.ceil((CODE_TTL_MS - elapsed) / 1000)
      );
      setSecondsLeft(remaining);
      if (remaining <= 0) {
        setState((prev) => (prev === "waiting" ? "expired" : prev));
        if (countdownRef.current) clearInterval(countdownRef.current);
      }
    }, 1000);
  }, [stopCountdown]);

  // No mutation means no backend that could ever know a code: either this
  // build has no cloud backend, or auth is still settling. Produce nothing;
  // the open effect regenerates once the mutation arrives.
  const generateCode = useCallback(async () => {
    if (!preGenerate) return;
    // One code per request: a second call while a mint is in flight would
    // insert another pairing request and swap the displayed code.
    if (generatingRef.current) return;
    generatingRef.current = true;
    setState("setup");
    setPreGenCode(null);
    setRequestId(null);
    setClaimedDeviceId(null);
    setErrorMessage("");
    setPairedInfo(null);
    onCodeReset?.();

    let generated: { requestId: PairingRequestId; code: string };
    try {
      generated = await preGenerate({});
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Could not generate a pairing code";
      setErrorMessage(raw);
      setState("error");
      return;
    } finally {
      generatingRef.current = false;
    }

    setPreGenCode(generated.code);
    setRequestId(generated.requestId);
    setState("waiting");
    startCountdown();
  }, [preGenerate, startCountdown, onCodeReset]);

  // The deep-link code claimed in this open dialog. A code is claimed once;
  // a retry clears this and claims it again.
  const claimedCodeRef = useRef<string | null>(null);
  const [claimAttempt, setClaimAttempt] = useState(0);
  const retryDeepLinkClaim = useCallback(() => {
    claimedCodeRef.current = null;
    setClaimAttempt((n) => n + 1);
  }, []);

  // Auto-generate code when dialog opens, unless the user still needs to sign in.
  // When an initialCode is supplied (deep-link entry), skip the auto-generate
  // path entirely and try to claim the supplied code.
  useEffect(() => {
    if (!open) {
      claimedCodeRef.current = null;
      return;
    }
    if (requiresSignIn) return;
    if (initialCode && initialCode.length === 6) {
      // The claim needs a settled, signed-in session: until auth resolves
      // there is no claim mutation, and claiming then fails for nothing.
      if (!claimCode || claimedCodeRef.current === initialCode) return;
      claimedCodeRef.current = initialCode;
      // Treat the URL-supplied code as a synthetic discovered agent so the
      // existing claim path runs, including all the error mapping. The
      // claim runs against the controller's signal so closing the dialog
      // (or changing the code) mid-claim cancels its effect on this flow.
      const controller = new AbortController();
      claimDiscovered(
        { pairingCode: initialCode } as DiscoveredAgent,
        controller.signal,
      );
      return () => {
        controller.abort();
        if (deferredClaimPairedRef.current) {
          clearTimeout(deferredClaimPairedRef.current);
          deferredClaimPairedRef.current = null;
        }
        stopCountdown();
      };
    }
    if (autoGenerate) {
      generateCode();
    }
    return () => stopCountdown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, requiresSignIn, initialCode, autoGenerate, claimCode, preGenerate, claimAttempt]);

  // Watch the generated code's own pairing request (zero-touch flow).
  useEffect(() => {
    if (state !== "waiting" || !requestId || !watchClaim) return;
    return watchClaim(requestId, setClaimedDeviceId);
  }, [state, requestId, watchClaim]);

  // The claimed device lands in the fleet mirror a moment after the claim;
  // its row carries the name, key and address the success card needs.
  useEffect(() => {
    if (state !== "waiting" || !claimedDeviceId) return;
    const newDrone = pairedDrones.find((d) => d.deviceId === claimedDeviceId);
    if (!newDrone) return;

    const host = newDrone.mdnsHost || newDrone.lastIp || null;
    setPairedInfo({
      deviceId: newDrone.deviceId,
      name: newDrone.name,
      apiKey: newDrone.apiKey,
      host,
    });
    setState("success");
    setPairingInProgress(false);
    stopCountdown();

    clearTimeout(deferredWatchPairedRef.current ?? undefined);
    deferredWatchPairedRef.current = setTimeout(() => {
      deferredWatchPairedRef.current = null;
      onPaired?.(newDrone.deviceId, newDrone.apiKey, host ? `http://${host}:8080` : "");
    }, 1500);
  }, [
    pairedDrones,
    claimedDeviceId,
    state,
    onPaired,
    setPairingInProgress,
    stopCountdown,
  ]);

  // Cancel any deferred onPaired when the dialog closes or the flow
  // unmounts, so a 1.5 s-deferred callback can never fire onto a dismissed
  // dialog. Keyed on `open` (not on every render) so the transition into
  // the success state does not clear the in-flight handle prematurely.
  useEffect(() => {
    if (open) return;
    if (deferredClaimPairedRef.current) {
      clearTimeout(deferredClaimPairedRef.current);
      deferredClaimPairedRef.current = null;
    }
    if (deferredWatchPairedRef.current) {
      clearTimeout(deferredWatchPairedRef.current);
      deferredWatchPairedRef.current = null;
    }
  }, [open]);

  // Final safety net: clear both deferred handles on unmount regardless of
  // the `open` value at teardown.
  useEffect(() => {
    return () => {
      if (deferredClaimPairedRef.current) {
        clearTimeout(deferredClaimPairedRef.current);
        deferredClaimPairedRef.current = null;
      }
      if (deferredWatchPairedRef.current) {
        clearTimeout(deferredWatchPairedRef.current);
        deferredWatchPairedRef.current = null;
      }
    };
  }, []);

  // Only `pairingCode` is read here. Declare that narrow contract so
  // callers that don't have a full DiscoveredAgent (e.g. the modal's
  // EnterPairCodeTab where the operator typed a code into an input
  // field) can pass `{ pairingCode }` without the strict-function
  // check rejecting a wider-input function.
  const claimDiscovered = useCallback(async (
    agent: Pick<DiscoveredAgent, "pairingCode">,
    signal?: AbortSignal,
  ) => {
    setPairingInProgress(true);
    setPairingError(null);
    setCanPairLocally(false);

    try {
      if (!claimCode) {
        throw new Error(
          "Convex not available. Cannot pair in local-only mode."
        );
      }

      const result = await claimCode({ code: agent.pairingCode });

      // The Convex mutation has no abort hook, so the request still
      // resolves after the dialog closes / the code changes. Bail before
      // any state mutation so a stale claim can't run setState on a closed
      // flow or fire onPaired for a node the operator dismissed.
      if (signal?.aborted) return;

      if (result.error) {
        // Expected outcomes come back as a result, not a throw, so the browser
        // console stays clean. A code the relay does not know almost always
        // means the agent is in local mode, so point at LAN pairing.
        const local = result.error === "invalid_pairing_code";
        const msg = local
          ? "That code isn't registered with the cloud relay. If this drone is on your network, pair it by hostname instead."
          : result.error === "rate_limited"
            ? `Too many pair-code attempts. Try again in ${Math.ceil(result.retryAfterMs / 1000)} s.`
          : result.error === "pairing_code_expired"
            ? "Pairing code expired. Ask the agent to generate a new one."
            : "This code was already used by another account.";
        setCanPairLocally(local);
        setErrorMessage(msg);
        setState("error");
        setPairingInProgress(false);
        setPairingError(msg);
        return;
      }

      const host = result.mdnsHost || result.localIp || null;
      const info: PairedInfo = {
        deviceId: result.deviceId,
        name: result.name || "ADOS Agent",
        apiKey: result.apiKey || "",
        host,
      };
      setPairedInfo(info);
      setState("success");
      setPairingInProgress(false);
      stopCountdown();

      clearTimeout(deferredClaimPairedRef.current ?? undefined);
      deferredClaimPairedRef.current = setTimeout(() => {
        deferredClaimPairedRef.current = null;
        if (signal?.aborted) return;
        onPaired?.(info.deviceId, info.apiKey, host ? `http://${host}:8080` : "");
      }, 1500);
    } catch (err) {
      // Reaching here means a genuinely unexpected throw (Convex unreachable,
      // or the gated not-authenticated precondition). Expected pairing
      // failures are handled above as returned results, not exceptions.
      if (signal?.aborted) return;
      const msg = err instanceof Error ? err.message : "Pairing failed";
      setErrorMessage(msg);
      setState("error");
      setPairingInProgress(false);
      setPairingError(msg);
    }
  }, [claimCode, onPaired, setPairingError, setPairingInProgress, stopCountdown]);

  return {
    state,
    preGenCode,
    errorMessage,
    secondsLeft,
    pairedInfo,
    canPairLocally,
    generateCode,
    claimDiscovered,
    retryDeepLinkClaim,
  };
}
