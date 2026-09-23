"use client";

/**
 * @module PairingDialog
 * @description Standalone modal wrapper around <AgentConnectPanel/>, kept for
 * the `/pair?code=` deep-link page. Hosts the modal chrome and the deep-link
 * claim branch (which runs the claim state machine with no tabs); the normal
 * tabbed Add-a-drone ⇄ Generate-code body is delegated to AgentConnectPanel.
 * @license GPL-3.0-only
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { useMutation } from "convex/react";
import { cn } from "@/lib/utils";
import { useConvexAvailable } from "@/app/ConvexClientProvider";
import { cmdPairingApi } from "@/lib/community-api-drones";
import { useAuthStore } from "@/stores/auth-store";
import { AgentConnectPanel } from "./AgentConnectPanel";
import { PairingResult } from "./pairing/PairingResult";
import { PairingPrompt } from "./pairing/PairingPrompt";
import { SignInModal } from "@/components/auth/SignInModal";
import {
  usePairingFlow,
  type ClaimCodeMutation,
  type PreGenerateMutation,
} from "./pairing/use-pairing-flow";

interface PairingDialogProps {
  open: boolean;
  onClose: () => void;
  onPaired?: (deviceId: string, apiKey: string, url: string) => void;
  /** Deep-link supplied code. When set, the dialog claims this code
   *  instead of showing the tabbed Add-a-drone form. */
  initialCode?: string | null;
}

export function PairingDialog(props: PairingDialogProps) {
  if (!props.open) return null;
  // No deep-link code → the tabbed body has no need for the claim/generate
  // mutations at this level (AgentConnectPanel wires its own). Render a thin
  // shell straight to the panel.
  if (!props.initialCode) {
    return <PairingDialogTabbed {...props} />;
  }
  return <PairingDialogDeepLink {...props} />;
}

/** Modal chrome shared by both branches. */
function PairingShell({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  const t = useTranslations("command");
  const tCommon = useTranslations("common");

  // Close on ESC
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-bg-secondary border border-border-default rounded-lg shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-default">
          <h2 className="text-sm font-semibold text-text-primary">
            {t("pairNewNode")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-text-tertiary hover:text-text-primary transition-colors"
            title={tCommon("close")}
            aria-label={tCommon("close")}
          >
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

/** No-deep-link path: the unified tabbed pairing body. */
function PairingDialogTabbed({ open, onClose, onPaired }: PairingDialogProps) {
  return (
    <PairingShell onClose={onClose}>
      <AgentConnectPanel open={open} onClose={onClose} onPaired={onPaired} />
    </PairingShell>
  );
}

/** Deep-link path: claim the supplied code via the cloud flow, with a
 *  "Pair on this network" fallback that reveals the tabbed body. A build
 *  with no cloud backend cannot claim a code at all, so it opens the LAN
 *  pairing body directly. */
function PairingDialogDeepLink(props: PairingDialogProps) {
  const convexAvailable = useConvexAvailable();
  if (convexAvailable) {
    return <PairingDialogDeepLinkWithConvex {...props} />;
  }
  return <PairingDialogTabbed {...props} />;
}

function PairingDialogDeepLinkWithConvex(props: PairingDialogProps) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isAuthLoading = useAuthStore((s) => s.isLoading);
  const claimCode = useMutation(cmdPairingApi.claimPairingCode);
  const preGenerate = useMutation(cmdPairingApi.preGenerateCode);

  return (
    <PairingDialogDeepLinkBase
      {...props}
      claimCode={isAuthenticated ? (claimCode as ClaimCodeMutation) : null}
      preGenerate={isAuthenticated ? (preGenerate as PreGenerateMutation) : null}
      requiresSignIn={!isAuthenticated && !isAuthLoading}
    />
  );
}

function PairingDialogDeepLinkBase({
  open,
  onClose,
  onPaired,
  initialCode,
  claimCode,
  preGenerate,
  requiresSignIn,
}: PairingDialogProps & {
  claimCode: ClaimCodeMutation;
  preGenerate: PreGenerateMutation;
  requiresSignIn: boolean;
}) {
  // When the cloud claim fails for a local-mode agent, flip to the tabbed
  // Add-a-Node body (LAN pairing).
  const [revealTabs, setRevealTabs] = useState(false);
  const pairLocally = useCallback(() => setRevealTabs(true), []);
  const [signInOpen, setSignInOpen] = useState(false);

  const flow = usePairingFlow({
    open,
    requiresSignIn,
    claimCode,
    preGenerate,
    onPaired,
    onCodeReset: () => {},
    initialCode,
    autoGenerate: false,
  });

  if (revealTabs) {
    return (
      <PairingShell onClose={onClose}>
        <AgentConnectPanel open={open} onClose={onClose} onPaired={onPaired} />
      </PairingShell>
    );
  }

  return (
    <PairingShell onClose={onClose}>
      <div className="space-y-5">
        {requiresSignIn && (
          <PairingPrompt variant="sign-in" onSignIn={() => setSignInOpen(true)} />
        )}
        {flow.state === "success" && flow.pairedInfo && (
          <PairingResult variant="success" info={flow.pairedInfo} />
        )}
        {flow.state === "error" && (
          <PairingResult
            variant="error"
            message={flow.errorMessage}
            onRetry={flow.retryDeepLinkClaim}
            canPairLocally={flow.canPairLocally}
            onPairLocally={pairLocally}
          />
        )}
      </div>
      <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
    </PairingShell>
  );
}

/**
 * Inline pairing code input for embedding in other pages. Same 6-char input
 * logic without the modal wrapper.
 */
export function PairingCodeInput({
  onSubmit,
  disabled,
}: {
  onSubmit: (code: string) => void;
  disabled?: boolean;
}) {
  const [code, setCode] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function handleChange(value: string) {
    const cleaned = value
      .replace(/[^A-Za-z0-9]/g, "")
      .toUpperCase()
      .slice(0, 6);
    setCode(cleaned);
    if (cleaned.length === 6) {
      onSubmit(cleaned);
    }
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={code}
      onChange={(e) => handleChange(e.target.value)}
      maxLength={6}
      disabled={disabled}
      placeholder="------"
      className={cn(
        "w-52 text-center text-xl font-mono font-bold tracking-[0.4em] bg-bg-primary border border-border-default rounded-lg px-3 py-2 text-text-primary placeholder:text-text-tertiary/40 outline-none focus:border-accent-primary transition-colors uppercase",
        disabled && "opacity-50 cursor-not-allowed"
      )}
      autoComplete="off"
      spellCheck={false}
    />
  );
}
