"use client";

/**
 * @module PairingPrompt
 * @description Initial setup state. Spinner while the agent generates a
 * pairing code, plus the sign-in required prompt when Convex is available
 * but the user is signed out.
 * @license GPL-3.0-only
 */

import { Loader2, Cpu } from "lucide-react";
import { useTranslations } from "next-intl";

interface SetupProps {
  variant: "setup";
}

interface SignInProps {
  variant: "sign-in";
  onSignIn: () => void;
}

export function PairingPrompt(props: SetupProps | SignInProps) {
  const t = useTranslations("command");

  if (props.variant === "sign-in") {
    return (
      <div className="flex flex-col items-center gap-4 py-4 text-center">
        <div className="w-10 h-10 rounded-full bg-accent-primary/10 flex items-center justify-center">
          <Cpu size={18} className="text-accent-primary" />
        </div>
        <div className="space-y-1 max-w-sm">
          <p className="text-sm font-medium text-text-primary">
            Cloud relay needs an account
          </p>
          <p className="text-xs text-text-tertiary leading-relaxed">
            Generating a cross-network pair code links the node to your
            account so you can reach it from anywhere. If both the GCS
            and the node are on the same LAN, use the Add a node tab —
            it pairs directly without an account.
          </p>
        </div>
        <button
          onClick={props.onSignIn}
          className="px-4 py-1.5 text-xs font-medium bg-accent-primary text-bg-primary rounded hover:bg-accent-primary/90 transition-colors"
        >
          Sign in
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 py-6">
      <Loader2 size={24} className="animate-spin text-accent-primary" />
      <p className="text-xs text-text-secondary">{t("generatingCode")}</p>
    </div>
  );
}
