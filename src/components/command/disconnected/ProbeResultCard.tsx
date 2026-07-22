"use client";

/**
 * @module ProbeResultCard
 * @description Confirmation card shown after a successful agent
 * probe. Renders the agent identity (device id, name, board,
 * profile, role) plus a Pair locally button. On pair, the local
 * nodes store is updated and the parent dismisses the flow.
 * @license GPL-3.0-only
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useConvexAuth } from "convex/react";
import { AlertTriangle, Check, Eraser, Loader2, Radio, X } from "lucide-react";
import {
  pairLocally,
  AgentAlreadyPairedError,
  PairClientError,
  type ProbeResult,
} from "@/lib/agent/local-pair-client";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useConvexAvailable } from "@/app/ConvexClientProvider";
import { cmdPairingApi } from "@/lib/community-api-drones";

interface ProbeResultCardProps {
  probe: ProbeResult;
  onPaired: (deviceId: string) => void;
  onCancel: () => void;
}

function profileLabel(profile: string, t: (k: string) => string): string {
  switch (profile) {
    case "ground-station":
      return t("profileLabel.groundStation");
    case "workstation":
      return t("profileLabel.compute");
    default:
      return t("profileLabel.drone");
  }
}

/** Renders the radio bind state as a small badge: an animated pill
 * while binding, an error pill on failure, a success pill once the
 * radio link is connected, and nothing when the agent has no radio
 * state to show. */
function BindStateBadge({
  probe,
  t,
}: {
  probe: ProbeResult;
  t: (k: string, v?: Record<string, string | number>) => string;
}) {
  const b = probe.bindState;
  if (b?.active)
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-status-warning/15 text-status-warning font-medium animate-pulse">
        {t("bindState.binding")}
      </span>
    );
  if (b?.error)
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-status-error/15 text-status-error font-medium">
        {t("bindState.failed", { error: b.error })}
      </span>
    );
  const connected =
    probe.radio?.state === "connected" || probe.radioPaired === true;
  if (connected)
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-status-success/15 text-status-success font-medium">
        {t("bindState.connected")}
      </span>
    );
  return null;
}

/**
 * Convex-aware wrapper. `useConvexAuth()` hard-throws when no auth provider
 * is mounted (the local-first / "Local only" case, where ConvexClientProvider
 * mounts a bare ConvexProvider with no auth context). So read the auth flag
 * ONLY when Convex is available, and feed `isAuthenticated` down as a prop —
 * the inner body never calls the throwing hook. In local-only mode the
 * operator is anonymous, so `isAuthenticated` is false (cloud wipe skipped).
 */
export function ProbeResultCard(props: ProbeResultCardProps) {
  const convexAvailable = useConvexAvailable();
  return convexAvailable ? (
    <ProbeResultCardWithAuth {...props} />
  ) : (
    <ProbeResultCardInner {...props} isAuthenticated={false} />
  );
}

function ProbeResultCardWithAuth(props: ProbeResultCardProps) {
  const { isAuthenticated } = useConvexAuth();
  return <ProbeResultCardInner {...props} isAuthenticated={isAuthenticated} />;
}

function ProbeResultCardInner({
  probe,
  onPaired,
  onCancel,
  isAuthenticated,
}: ProbeResultCardProps & { isAuthenticated: boolean }) {
  const t = useTranslations("command.addNode");
  const [pairing, setPairing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Surfaces the "Wipe pair state" recovery action when the agent
  // reports it is already claimed by another browser. Tracked
  // separately from `error` so we don't pattern-match on translated
  // strings to decide whether to show the button.
  const [showWipe, setShowWipe] = useState(false);
  const [wiping, setWiping] = useState(false);
  // The cloud wipe is sign-in-gated (it clears the Convex pair rows for a
  // device the authenticated user owns). In local-first mode the operator is
  // anonymous, so calling it throws "Not authenticated"; skip it and do only
  // the local cleanup, which is all a LAN-paired node needs. `isAuthenticated`
  // is threaded in from the wrapper so this body never calls useConvexAuth().
  const wipePairState = useMutation(cmdPairingApi.wipePairStateForOwnedDevice);
  const addNode = useLocalNodesStore((s) => s.addNode);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  async function handleWipePairState() {
    if (wiping) return;
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(t("wipePairStateConfirm"));
      if (!confirmed) return;
    }
    setWiping(true);
    setError(null);
    try {
      // Cloud wipe only when signed in; the anonymous local-first path has no
      // Convex pair state to clear and the mutation would throw.
      if (isAuthenticated) {
        await wipePairState({ deviceId: probe.deviceId });
      }
      // Drop any leftover local entry for this device so the next
      // probe + pair cycle starts from a clean slate.
      useLocalNodesStore.getState().removeNode(probe.deviceId);
      if (!mountedRef.current) return;
      setShowWipe(false);
      setError(t("wipePairStateSuccess"));
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mountedRef.current) setWiping(false);
    }
  }

  async function handlePair() {
    if (pairing) return;
    setPairing(true);
    setError(null);
    setShowWipe(false);
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const claim = await pairLocally(probe.hostname, ctrl.signal);
      if (!mountedRef.current) return;
      // Drop any prior card reachable at the same host under a different
      // device id: this box re-identified (a re-flash mints a new
      // machine-id-derived device id), so the old entry is a dead ghost
      // whose stale key no longer validates. Reconciling here means a
      // re-pair REPLACES it instead of leaving a second offline card.
      useLocalNodesStore.getState().reconcileHost(
        { hostname: probe.hostname, ipv4: probe.ipv4, mdnsHost: claim.mdnsHost },
        claim.deviceId,
      );
      // Persist to local-nodes-store FIRST so the apiKey is durable
      // before we attempt the live link. If the operator navigates
      // away mid-connect the agent stays paired and the entry is
      // still in the sidebar for a retry. If connect itself fails
      // we surface the error but keep the node — operator can click
      // it again from the sidebar to retry.
      addNode({
        deviceId: claim.deviceId,
        name: claim.name,
        hostname: probe.hostname,
        apiKey: claim.apiKey,
        profile: probe.profile,
        role: probe.role ?? null,
        board: probe.board,
        version: probe.version,
        mdnsHost: claim.mdnsHost,
        ipv4: probe.ipv4,
        bindState: probe.bindState,
        radio: probe.radio,
        pairedAt: Date.now(),
        lastSeenAt: Date.now(),
      });
      try {
        const onHttps =
          typeof window !== "undefined" &&
          window.location.protocol === "https:";
        if (onHttps) {
          // Mixed-content guard: HTTPS pages can't fetch http://*.local
          // directly. Route through the cloud relay just like
          // selectNode() does. The agent posts heartbeats to Convex
          // independently so the GCS still gets telemetry.
          useAgentConnectionStore.getState().connectCloud(claim.deviceId);
        } else {
          await useAgentConnectionStore
            .getState()
            .connect(probe.hostname, claim.apiKey, claim.deviceId);
        }
      } catch (connectErr) {
        if (!mountedRef.current) return;
        const msg =
          connectErr instanceof Error ? connectErr.message : String(connectErr);
        setError(t("pairedButConnectFailed", { error: msg }));
        return;
      }
      if (!mountedRef.current) return;
      onPaired(claim.deviceId);
    } catch (e) {
      if (!mountedRef.current) return;
      if (e instanceof AgentAlreadyPairedError) {
        setError(t("alreadyPairedToOtherBrowser"));
        setShowWipe(true);
      } else if (e instanceof DOMException && e.name === "AbortError") {
        // Component unmounted or user navigated away. No-op.
        return;
      } else if (e instanceof PairClientError) {
        try {
          setError(t(e.code, e.details));
        } catch {
          setError(e.message);
        }
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (mountedRef.current) setPairing(false);
    }
  }

  return (
    <div className="p-5 bg-bg-secondary border border-border-default rounded-lg space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-status-success/10 flex items-center justify-center shrink-0">
          <Radio size={18} className="text-status-success" />
        </div>
        <div className="flex-1 space-y-2">
          <div>
            <p className="text-sm font-medium text-text-primary">{probe.name}</p>
            <p className="text-xs text-text-tertiary font-mono">
              {probe.deviceId}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5 text-[10px]">
            <BindStateBadge probe={probe} t={t} />
            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-accent-primary/10 text-accent-primary font-medium">
              {profileLabel(probe.profile, t)}
            </span>
            {probe.role && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-bg-tertiary text-text-secondary font-mono lowercase">
                {probe.role}
              </span>
            )}
            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-bg-tertiary text-text-secondary">
              {probe.board}
            </span>
            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-bg-tertiary text-text-tertiary font-mono">
              v{probe.version}
            </span>
          </div>
          <p className="text-xs text-text-tertiary">
            {probe.hostname}
          </p>
        </div>
      </div>

      {probe.paired && (
        <div className="flex items-start gap-2 p-2 bg-status-warning/10 border border-status-warning/30 rounded text-xs text-status-warning">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{t("alreadyPairedMessage")}</span>
        </div>
      )}

      {error && (
        <div
          role="alert"
          aria-live="polite"
          className="flex items-start gap-2 p-2 bg-status-error/10 border border-status-error/30 rounded text-xs text-status-error"
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {showWipe && (
        <button
          onClick={handleWipePairState}
          disabled={wiping || pairing}
          className="w-full px-3 py-2 text-xs font-medium bg-bg-tertiary border border-border-default text-text-secondary rounded hover:bg-bg-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
        >
          {wiping ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Eraser size={14} />
          )}
          {t("wipePairState")}
        </button>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={handlePair}
          disabled={pairing}
          className="flex-1 px-4 py-2 text-xs font-medium bg-accent-primary text-white rounded hover:bg-accent-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
        >
          {pairing ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              {t("pairingButton")}
            </>
          ) : (
            <>
              <Check size={14} />
              {t("pairLocallyButton")}
            </>
          )}
        </button>
        <button
          onClick={onCancel}
          disabled={pairing}
          className="px-3 py-2 text-xs font-medium bg-bg-tertiary border border-border-default text-text-secondary rounded hover:bg-bg-primary transition-colors disabled:opacity-50 inline-flex items-center gap-1"
        >
          <X size={14} />
          {t("cancelButton")}
        </button>
      </div>
    </div>
  );
}
