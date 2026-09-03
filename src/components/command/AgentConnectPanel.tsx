"use client";

/**
 * @module AgentConnectPanel
 * @description The ADOS Drone Agent pairing body, without modal chrome, so it
 * can be embedded as the "Companion Computer" column of the unified Connect
 * dialog AND reused inside the standalone PairingDialog. Hosts the
 * Add-a-drone ⇄ Generate-code tabs; the lifecycle state machine lives in
 * `usePairingFlow`, per-stage UI lives in `./pairing/`.
 * @license GPL-3.0-only
 */

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "convex/react";
import { useConvexAvailable } from "@/app/ConvexClientProvider";
import { cmdPairingApi } from "@/lib/community-api-drones";
import { useAuthStore } from "@/stores/auth-store";
import { usePairingStore } from "@/stores/pairing-store";
import { SignInModal } from "@/components/auth/SignInModal";
import { Tabs, tabButtonId } from "@/components/ui/tabs";
import { AddNodeForm } from "./disconnected/AddNodeForm";
import { InstallAgentStrip } from "./disconnected/InstallAgentStrip";
import { PairingPrompt } from "./pairing/PairingPrompt";
import { PairingConfirm } from "./pairing/PairingConfirm";
import { PairingResult } from "./pairing/PairingResult";
import {
  usePairingFlow,
  buildInstallCommand,
  type ClaimCodeMutation,
  type PreGenerateMutation,
} from "./pairing/use-pairing-flow";

type DialogTab = "add" | "generate";

export interface AgentConnectPanelProps {
  /** Whether the host surface is visible (drives flow lifecycle). */
  open: boolean;
  /** Forwarded once a node is paired; apiKey is already persisted in
   *  local-nodes-store for the LAN path. */
  onPaired?: (deviceId: string, apiKey: string, url: string) => void;
  /** Close the host surface (modal) after a successful LAN pair. */
  onClose: () => void;
  /** Which tab to open on. Defaults to the Add-a-drone tab. */
  initialTab?: DialogTab;
}

export function AgentConnectPanel(props: AgentConnectPanelProps) {
  const convexAvailable = useConvexAvailable();
  if (convexAvailable) {
    return <AgentConnectPanelWithConvex {...props} />;
  }
  return (
    <AgentConnectPanelBase
      {...props}
      claimCode={null}
      preGenerate={null}
      requiresSignIn={false}
    />
  );
}

function AgentConnectPanelWithConvex(props: AgentConnectPanelProps) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isAuthLoading = useAuthStore((s) => s.isLoading);
  const claimCode = useMutation(cmdPairingApi.claimPairingCode);
  const preGenerate = useMutation(cmdPairingApi.preGenerateCode);

  return (
    <AgentConnectPanelBase
      {...props}
      claimCode={isAuthenticated ? (claimCode as ClaimCodeMutation) : null}
      preGenerate={isAuthenticated ? (preGenerate as PreGenerateMutation) : null}
      requiresSignIn={!isAuthenticated && !isAuthLoading}
    />
  );
}

interface BaseProps extends AgentConnectPanelProps {
  claimCode: ClaimCodeMutation;
  preGenerate: PreGenerateMutation;
  requiresSignIn: boolean;
}

function AgentConnectPanelBase({
  open,
  onPaired,
  onClose,
  initialTab = "add",
  claimCode,
  preGenerate,
  requiresSignIn,
}: BaseProps) {
  const t = useTranslations("command");
  const tAuth = useTranslations("auth");
  const [signInOpen, setSignInOpen] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedInstall, setCopiedInstall] = useState(false);
  const [activeTab, setActiveTab] = useState<DialogTab>(initialTab);

  const onCodeReset = useCallback(() => {
    setCopiedCode(false);
    setCopiedInstall(false);
  }, []);

  // Reset to the requested tab when the host surface reopens.
  useEffect(() => {
    if (open) setActiveTab(initialTab);
  }, [open, initialTab]);

  // The Add-a-drone tab renders <AddNodeForm/> standalone (it owns its own
  // probe + claim state); the flow state machine is only relevant on the
  // generate-code tab. autoGenerate gates code generation so we don't burn a
  // pre-gen code when the operator is on the Add-a-drone tab.
  const flow = usePairingFlow({
    open,
    requiresSignIn,
    claimCode,
    preGenerate,
    onPaired,
    onCodeReset,
    initialCode: null,
    autoGenerate: activeTab === "generate",
  });

  const discoveredAgents = usePairingStore((s) => s.discoveredAgents);

  // When the operator switches to the generate-code tab and we haven't
  // generated a code yet (state still "setup"), kick off generation.
  useEffect(() => {
    if (!open || requiresSignIn) return;
    if (activeTab === "generate" && flow.state === "setup") {
      flow.generateCode();
    }
  }, [activeTab, open, requiresSignIn, flow]);

  const handleCopyCode = useCallback(() => {
    if (!flow.preGenCode) return;
    navigator.clipboard
      .writeText(flow.preGenCode)
      .then(() => {
        setCopiedCode(true);
        setTimeout(() => setCopiedCode(false), 2000);
      })
      .catch(() => {});
  }, [flow.preGenCode]);

  const handleCopyInstall = useCallback(() => {
    if (!flow.preGenCode) return;
    navigator.clipboard
      .writeText(buildInstallCommand(flow.preGenCode))
      .then(() => {
        setCopiedInstall(true);
        setTimeout(() => setCopiedInstall(false), 2000);
      })
      .catch(() => {});
  }, [flow.preGenCode]);

  return (
    <>
      <Tabs
        activeTab={activeTab}
        onChange={(id) => setActiveTab(id as DialogTab)}
        label={t("pairing.tabsLabel")}
        tabs={[
          { id: "add", label: t("pairing.tab.addDrone"), panelId: "agent-connect-add" },
          { id: "generate", label: t("pairing.tab.generateCode"), panelId: "agent-connect-generate" },
        ]}
      />
      <div className="pt-4 space-y-5">
        {activeTab === "add" && (
          <div
            id="agent-connect-add"
            role="tabpanel"
            aria-labelledby={tabButtonId("add")}
            className="space-y-5"
          >
            <AddNodeForm
              onPaired={(deviceId) => {
                // apiKey is already persisted in the local-nodes-store by
                // ProbeResultCard; forward for caller-side selection, then
                // close the host surface.
                onPaired?.(deviceId, "", "");
                onClose();
              }}
            />
            <InstallAgentStrip />
            {requiresSignIn && (
              // Informational nudge only — LAN pair via the form above works
              // without an account. Sign-in unlocks cross-network reach.
              <div className="flex items-start gap-3 p-3 bg-bg-tertiary border border-border-default rounded text-xs text-text-tertiary leading-relaxed">
                <p className="flex-1">{t("pairing.lanRelayNudge")}</p>
                <button
                  type="button"
                  onClick={() => setSignInOpen(true)}
                  className="shrink-0 px-2.5 py-1 text-[11px] font-medium text-accent-primary border border-accent-primary/30 rounded hover:bg-accent-primary/10 transition-colors focus-ring"
                >
                  {tAuth("signInButton")}
                </button>
              </div>
            )}
          </div>
        )}
        {activeTab === "generate" && (
          <div
            id="agent-connect-generate"
            role="tabpanel"
            aria-labelledby={tabButtonId("generate")}
            className="space-y-5"
          >
            {requiresSignIn ? (
              <PairingPrompt
                variant="sign-in"
                onSignIn={() => setSignInOpen(true)}
              />
            ) : (
              <>
                {flow.state === "setup" && <PairingPrompt variant="setup" />}
                {flow.state === "waiting" && flow.preGenCode && (
                  <PairingConfirm
                    code={flow.preGenCode}
                    secondsLeft={flow.secondsLeft}
                    copiedCode={copiedCode}
                    copiedInstall={copiedInstall}
                    installCommand={buildInstallCommand(flow.preGenCode)}
                    discoveredAgents={discoveredAgents}
                    onCopyCode={handleCopyCode}
                    onCopyInstall={handleCopyInstall}
                    onDiscoveredPair={flow.claimDiscovered}
                  />
                )}
                {flow.state === "success" && flow.pairedInfo && (
                  <PairingResult variant="success" info={flow.pairedInfo} />
                )}
                {flow.state === "error" && (
                  <PairingResult
                    variant="error"
                    message={flow.errorMessage}
                    onRetry={flow.generateCode}
                    canPairLocally={flow.canPairLocally}
                    onPairLocally={() => setActiveTab("add")}
                  />
                )}
                {flow.state === "expired" && (
                  <PairingResult variant="expired" onRetry={flow.generateCode} />
                )}
              </>
            )}
          </div>
        )}
      </div>
      <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
    </>
  );
}
