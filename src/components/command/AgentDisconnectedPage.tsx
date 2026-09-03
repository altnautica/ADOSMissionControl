"use client";

/**
 * @module AgentDisconnectedPage
 * @description Pairing-first page shown when no agent is selected.
 * Local-first by design: the Add-a-Node card lets the operator
 * pair any agent on the LAN without signing in. The cloud
 * pairing-code card is available behind the "Sign in for remote
 * access" branch but is never a gate.
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { useConvexAvailable } from "@/app/ConvexClientProvider";
import { SignInModal } from "@/components/auth/SignInModal";
import { AddNodeForm } from "./disconnected/AddNodeForm";
import { InstallAgentStrip } from "./disconnected/InstallAgentStrip";
import { RemoteAccessStrip } from "./disconnected/RemoteAccessStrip";
import { FeatureGrid } from "./disconnected/FeatureGrid";
import { RequirementsFooter } from "./disconnected/RequirementsFooter";

interface AgentDisconnectedPageProps {
  onOpenPairing?: () => void;
  /** Connect + focus the freshly-paired node. The local-nodes-store already
   * holds its credentials, so only the deviceId is forwarded. */
  onPaired?: (deviceId: string) => void;
}

export function AgentDisconnectedPage({
  onOpenPairing,
  onPaired,
}: AgentDisconnectedPageProps) {
  const t = useTranslations("disconnectedPage");
  const convexAvailable = useConvexAvailable();
  const [signInOpen, setSignInOpen] = useState(false);

  function handlePaired(deviceId: string) {
    // The local-nodes-store has the new entry (host + apiKey). Hand the
    // deviceId to the parent so it connects + focuses the node; fall back to
    // opening the pairing surface if no connect handler is wired.
    if (onPaired) onPaired(deviceId);
    else onOpenPairing?.();
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-10 space-y-10">
        {/* Hero */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 text-sm font-medium bg-status-warning/10 text-status-warning border border-status-warning/20 rounded-full">
            <AlertTriangle size={12} />
            {t("alpha")}
          </div>
          <h1 className="text-3xl font-display font-bold text-text-primary">
            {t("pairANode")}
          </h1>
          <p className="text-text-secondary text-base max-w-lg mx-auto">
            {t("installAndConnect")}
          </p>
        </div>

        {/* Primary entry: one smart input that accepts either a
            hostname or a 6-character pair code. Both flows converge
            on ProbeResultCard + pairLocally below the surface. */}
        <div className="max-w-md mx-auto">
          <AddNodeForm onPaired={handlePaired} />
        </div>

        {/* Secondary affordances — both collapsed by default so the
            pair input stays the dominant surface. */}
        <div className="max-w-md mx-auto space-y-3">
          <InstallAgentStrip />
          {convexAvailable && (
            <RemoteAccessStrip onSignIn={() => setSignInOpen(true)} />
          )}
        </div>

        <FeatureGrid />

        <RequirementsFooter />
      </div>
      <SignInModal
        open={signInOpen}
        onClose={() => setSignInOpen(false)}
      />
    </div>
  );
}
