"use client";

/**
 * @module AddNodeForm
 * @description Single-input entry point for adding any ADOS node
 * (drone, ground station, future compute) to the GCS. Replaces the
 * four stacked cards on the disconnected page with one smart field
 * that accepts EITHER a hostname / URL OR a 6-character pair code.
 *
 * Detection rule lives in `local-pair-client.looksLikePairCode`: the
 * agent's pair-code charset (uppercase letters + 2-9, no 0/O/1/I/L)
 * is disjoint from typical hostnames, so a 6-char value matching the
 * regex is unambiguously a code; anything else is treated as a host.
 *
 * The code path chains through Convex (`claimPairingCodeAnon` — no
 * auth required) to resolve the agent's mDNS host, then runs the
 * same probe flow as a hostname-typed entry. After a successful
 * probe the downstream `ProbeResultCard` writes the durable apiKey
 * via `pairLocally`. No code-vs-hostname branching past the probe.
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Loader2, Plus, Search, X } from "lucide-react";
import { useMutation } from "convex/react";
import {
  probeAgent,
  probeByCode,
  looksLikePairCode,
  PairClientError,
  type ProbeResult,
} from "@/lib/agent/local-pair-client";
import {
  getCloudSessionSecret,
  useBrowserIdentityStore,
} from "@/stores/browser-identity-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { usePairingStore } from "@/stores/pairing-store";
import { usePairDialogStore } from "@/stores/pair-dialog-store";
import { useDiscoveredAgents } from "@/hooks/use-discovered-agents";
import { useToast } from "@/components/ui/toast";
import { useConvexAvailable } from "@/app/ConvexClientProvider";
import { cmdPairingApi } from "@/lib/community-api-drones";
import { DiscoveredAgentsList } from "./DiscoveredAgentsList";
import { ProbeResultCard } from "./ProbeResultCard";

interface AddNodeFormProps {
  /** Called after a successful local pair. Parent may navigate. */
  onPaired?: (deviceId: string) => void;
}

export function AddNodeForm({ onPaired }: AddNodeFormProps) {
  const t = useTranslations("command.addNode");
  const { toast } = useToast();
  const [input, setInput] = useState("");
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  // True when the failed entry was a pair code (not a hostname). A code that
  // does not resolve usually means the agent is in local mode; pairing by
  // hostname is the reliable path, so we surface that tip.
  const [codeFailed, setCodeFailed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const convexAvailable = useConvexAvailable();
  // useMutation must be called unconditionally; the call site below
  // gates the actual invocation on convexAvailable.
  const claimAnon = useMutation(cmdPairingApi.claimPairingCodeAnon);
  const issueBrowserSession = useMutation(cmdPairingApi.issueBrowserSession);
  const setCloudSessionSecret = useBrowserIdentityStore(
    (s) => s.setCloudSessionSecret,
  );

  // The relay derives the anonymous owner from a secret IT minted, so this
  // browser has to hold one before it can claim. Minted lazily on the first
  // code pair and reused thereafter; the previous design sent the browser's
  // own UUID as an owner argument, which any caller could simply assert.
  const claimAnonWithSession = useCallback(
    async (args: { code: string }) => {
      let secret = getCloudSessionSecret();
      if (!secret) {
        secret = (await issueBrowserSession({})).browserSessionSecret;
        setCloudSessionSecret(secret);
      }
      const result = await claimAnon({
        code: args.code,
        browserSessionSecret: secret,
      });
      // A secret the relay no longer recognises (swept, or a wiped backend)
      // is recoverable in one step: mint a fresh session and retry once.
      if (result.error === "invalid_browser_session") {
        const fresh = (await issueBrowserSession({})).browserSessionSecret;
        setCloudSessionSecret(fresh);
        return await claimAnon({
          code: args.code,
          browserSessionSecret: fresh,
        });
      }
      return result;
    },
    [claimAnon, issueBrowserSession, setCloudSessionSecret],
  );

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useDiscoveredAgents();
  const discoveredAgents = usePairingStore((s) => s.discoveredAgents);

  /** Translate a thrown pair-flow failure into operator-facing copy. Every
   * `PairClientError` code resolves to a message under `command.addNode.*`
   * that names a next action; the fallbacks are for a non-pair-flow throw. */
  const describeFailure = useCallback(
    (e: unknown): string => {
      if (e instanceof PairClientError) {
        try {
          return t(e.code, e.details);
        } catch {
          return e.message;
        }
      }
      if (e instanceof Error) return e.message;
      return t("probeFailedError");
    },
    [t],
  );

  /** The one probe path. A 6-character value is a pair code, anything else is
   * a host — the charsets are disjoint (see `looksLikePairCode`). Shared by
   * the text field, the discovered-agent list and the pre-filled open, so all
   * three get identical error mapping. */
  const probeTarget = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed || probing) return;

      setProbeError(null);
      setCodeFailed(false);
      setProbe(null);
      setProbing(true);
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      try {
        const result = looksLikePairCode(trimmed)
          ? // Local-first: the LAN mDNS scan inside probeByCode needs no
            // Convex. Pass the anon claim mutation only when the relay is
            // actually available so a fully-offline GCS still resolves a code
            // over the LAN; probeByCode skips the cross-network fallback when
            // it is omitted.
            await probeByCode(
              trimmed,
              convexAvailable ? claimAnonWithSession : undefined,
              ctrl.signal,
            )
          : await probeAgent(trimmed, ctrl.signal);
        if (!ctrl.signal.aborted) setProbe(result);
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setProbeError(describeFailure(e));
        if (looksLikePairCode(trimmed)) setCodeFailed(true);
      } finally {
        if (!ctrl.signal.aborted) setProbing(false);
      }
    },
    [claimAnonWithSession, convexAvailable, describeFailure, probing],
  );

  // An agent the operator picked from a discovery list (here or on the
  // first-run screen) arrives pre-loaded, and is probed straight away —
  // probing is read-only, and it is exactly what the click asked for.
  const prefillHost = usePairDialogStore((s) => s.prefillHost);
  const consumePrefillHost = usePairDialogStore((s) => s.consumePrefillHost);
  useEffect(() => {
    if (!prefillHost) return;
    consumePrefillHost();
    setInput(prefillHost);
    void probeTarget(prefillHost);
  }, [prefillHost, consumePrefillHost, probeTarget]);

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void probeTarget(input);
    }
  }

  function handleDiscoveredSelect(agent: {
    mdnsHost?: string;
    localIp?: string;
    name: string;
  }) {
    // Aim at the address that PROVED reachable. `localIp` is set by the
    // discovery proxy only after a successful server-side resolve, so it is
    // evidence; `mdnsHost` is whatever the agent says its own name is, which
    // the browser may not be able to resolve at all. Preferring the name here
    // produced "Couldn't reach …" immediately after the GCS had displayed the
    // agent as found — on the only zero-typing path in the product.
    const target = agent.localIp || agent.mdnsHost;
    if (!target) return;
    setInput(target);
    void probeTarget(target);
  }

  const localNodeCount = useLocalNodesStore((s) => s.nodes.length);
  const warningDismissedAt = useBrowserIdentityStore(
    (s) => s.localPairWarningDismissedAt,
  );
  const dismissWarning = useBrowserIdentityStore(
    (s) => s.dismissLocalPairWarning,
  );
  const showFirstPairWarning =
    localNodeCount === 0 && warningDismissedAt === 0;

  if (probe) {
    return (
      <ProbeResultCard
        probe={probe}
        onPaired={(deviceId, reach) => {
          // Plain-words confirmation that outlives this page. "Live" only
          // when the agent answered; a relay-bound pair says it is waiting.
          // A drone is named a drone; any other profile is named by name.
          if (reach === "connected") {
            toast(
              probe.profile === "drone"
                ? t("pairSuccess")
                : t("pairSuccessNode", { name: probe.name }),
              "success",
            );
          } else {
            toast(t("pairedWaitingRelay"), "info");
          }
          setProbe(null);
          setInput("");
          onPaired?.(deviceId);
        }}
        onCancel={() => {
          setProbe(null);
        }}
      />
    );
  }

  const isCodeInput = looksLikePairCode(input);

  return (
    <div className="space-y-4">
      {showFirstPairWarning && (
        <div className="flex items-start gap-3 p-3 bg-status-warning/10 border border-status-warning/30 rounded-lg text-xs text-text-secondary">
          <AlertTriangle
            size={14}
            className="mt-0.5 shrink-0 text-status-warning"
          />
          <div className="flex-1 space-y-1">
            <p className="font-medium text-text-primary">
              {t("firstPairWarning.title")}
            </p>
            <p className="text-text-tertiary leading-relaxed">
              {t("firstPairWarning.body")}
            </p>
          </div>
          <button
            onClick={dismissWarning}
            className="shrink-0 inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-text-secondary hover:text-text-primary transition-colors"
          >
            {t("firstPairWarning.dismiss")}
            <X size={10} />
          </button>
        </div>
      )}

      {discoveredAgents.length > 0 && (
        <DiscoveredAgentsList
          agents={discoveredAgents}
          onSelect={handleDiscoveredSelect}
        />
      )}

      <div className="p-5 bg-bg-secondary border border-border-default rounded-lg space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-accent-primary/10 flex items-center justify-center">
            <Plus size={14} className="text-accent-primary" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-text-primary">
              {t("addNodeTitle")}
            </p>
            <p className="text-[10px] text-text-tertiary">
              {t("addNodeSubtitle")}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setProbeError(null);
            }}
            onKeyDown={handleKey}
            placeholder={t("addNodePlaceholder")}
            disabled={probing}
            autoCapitalize={isCodeInput ? "characters" : "off"}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            className="flex-1 px-3 py-2 bg-bg-primary border border-border-default rounded text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary disabled:opacity-50"
          />
          <button
            onClick={() => void probeTarget(input)}
            disabled={probing || !input.trim()}
            className="px-3 py-2 text-xs font-medium bg-accent-primary text-white rounded hover:bg-accent-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
          >
            {probing ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                {t("probingButton")}
              </>
            ) : (
              <>
                <Search size={12} />
                {t("pairButton")}
              </>
            )}
          </button>
        </div>

        <p className="text-[10px] text-text-tertiary leading-relaxed">
          {t("addNodeHint")}
        </p>

        {probeError && (
          <p
            role="alert"
            aria-live="polite"
            className="text-xs text-status-error"
          >
            {probeError}
          </p>
        )}
        {codeFailed && (
          <p className="text-[11px] text-text-tertiary leading-relaxed">
            {t("codeTryHostnameTip")}
          </p>
        )}
      </div>
    </div>
  );
}
