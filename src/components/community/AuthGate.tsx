"use client";

import { useTranslations } from "next-intl";
import { useAuthStore } from "@/stores/auth-store";

interface AuthGateProps {
  children: React.ReactNode;
  action?: string;
  onSignIn?: () => void;
}

function requestSignIn() {
  window.dispatchEvent(new CustomEvent("open-signin"));
}

export function AuthGate({ children, action = "continue", onSignIn }: AuthGateProps) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const t = useTranslations("auth");

  const actionLabel = action === "comment"
    ? t("actions.comment")
    : action === "continue"
      ? t("actions.continue")
      : action;

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center gap-2 py-4 text-center">
        <p className="text-sm text-text-tertiary">
          <button
            onClick={onSignIn ?? requestSignIn}
            className="text-accent-primary hover:underline"
          >
            {t("signInButton")}
          </button>
          {" "}{t("toAction", { action: actionLabel })}
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
