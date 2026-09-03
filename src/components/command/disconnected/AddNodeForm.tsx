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

  async function handleSubmit() {
    const trimmed = input.trim();
    if (!trimmed || probing) return;

    setProbeError(null);
    setCodeFailed(false);
    setProbe(null);
    setProbing(true);
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      let result: ProbeResult;
      if (looksLikePairCode(trimmed)) {
        // Local-first: the LAN mDNS scan inside probeByCode needs no Convex.
        // Pass the anon claim mutation only when the relay is actually
        // available so a fully-offline GCS still resolves a code over the LAN;
        // probeByCode skips the cross-network fallback when it is omitted.
        result = await probeByCode(
          trimmed,
          convexAvailable ? claimAnonWithSession : undefined,
          ctrl.signal,
        );
      } else {
        result = await probeAgent(trimmed, ctrl.signal);
      }
      if (!ctrl.signal.aborted) setProbe(result);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      let msg: string;
      if (e instanceof PairClientError) {
        try {
          msg = t(e.code, e.details);
        } catch {
          msg = e.message;
        }
      } else if (e instanceof Error) {
        msg = e.message;
      } else {
        msg = t("probeFailedError");
      }
      setProbeError(msg);
      if (looksLikePairCode(trimmed)) setCodeFailed(true);
    } finally {
      if (!ctrl.signal.aborted) setProbing(false);
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleSubmit();
    }
  }

  function handleDiscoveredSelect(agent: {
    mdnsHost?: string;
    localIp?: string;
    name: string;
  }) {
    const target = agent.mdnsHost || agent.localIp;
    if (!target) return;
    setInput(target);
    // Defer through the regular path so the typed-error mapping fires.
    void (async () => {
      setProbeError(null);
      setProbe(null);
      setProbing(true);
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const result = await probeAgent(target, ctrl.signal);
        if (!ctrl.signal.aborted) setProbe(result);
      } catch (e) {
        if (ctrl.signal.aborted) return;
        if (e instanceof PairClientError) {
          try {
            setProbeError(t(e.code, e.details));
          } catch {
            setProbeError(e.message);
          }
        } else if (e instanceof Error) {
          setProbeError(e.message);
        } else {
          setProbeError(t("probeFailedError"));
        }
      } finally {
        if (!ctrl.signal.aborted) setProbing(false);
      }
    })();
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
        onPaired={(deviceId) => {
          // Plain-words confirmation that outlives this page: the pair
          // succeeded (ProbeResultCard only calls onPaired once the node
          // is claimed and connected), and the app navigates straight to
          // the node, so a global toast is the honest place to say so.
          // A drone is named a drone; any other profile is named by name.
          toast(
            probe.profile === "drone"
              ? t("pairSuccess")
              : t("pairSuccessNode", { name: probe.name }),
            "success",
          );
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
            onClick={() => void handleSubmit()}
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
