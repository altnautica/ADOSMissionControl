/**
 * @module SignInModal
 * @description Modal dialog for optional sign-in. Appears as an overlay,
 * not a page redirect. Supports sign-in and account creation.
 * Uses useAuthActions from @convex-dev/auth when Convex is available.
 * @license GPL-3.0-only
 */
"use client";

import { useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/auth-store";
import { useConvexAvailable } from "@/app/ConvexClientProvider";

function sanitizeAuthError(msg: string, t: (key: string) => string): string {
  if (msg.includes("InvalidSecret") || msg.includes("password")) return t("errors.incorrectPassword");
  if (msg.includes("InvalidAccountId") || msg.includes("Could not find")) return t("errors.noAccountFound");
  if (msg.includes("TooManyFailedAttempts")) return t("errors.tooManyAttempts");
  if (msg.includes("already exists") || msg.includes("UNIQUE")) return t("errors.accountExists");
  return t("errors.generic");
}

interface SignInModalProps {
  open: boolean;
  onClose: () => void;
}

export function SignInModal({ open, onClose }: SignInModalProps) {
  const convexAvailable = useConvexAvailable();
  const t = useTranslations("auth");

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-bg-secondary border border-border-default w-full max-w-sm mx-4 p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-text-tertiary hover:text-text-primary transition-colors"
        >
          <X size={16} />
        </button>

        {convexAvailable ? (
          <ConvexSignInForm onClose={onClose} />
        ) : (
          <div className="text-center py-4">
            <h2 className="text-lg font-display font-semibold text-text-primary mb-2">
              {t("cloudNotAvailable")}
            </h2>
            <p className="text-xs text-text-secondary mb-4">
              {t("cloudRequiresConvex")}
            </p>
            <button
              onClick={onClose}
              className="text-xs text-text-tertiary hover:text-text-secondary"
            >
              {t("continueLocalMode")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Inner form component that uses useAuthActions (must be inside ConvexAuthNextjsProvider).
 */
function ConvexSignInForm({ onClose }: { onClose: () => void }) {
  const { signIn } = useAuthActions();
  const setAuth = useAuthStore((s) => s.setAuth);
  const t = useTranslations("auth");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await signIn("password", {
        email,
        password,
        flow: mode,
        ...(mode === "signUp" ? { fullName } : {}),
      });

      // Set Zustand auth immediately for snappy UI feedback.
      // AuthBridge will update with full profile data once the query resolves.
      setAuth({
        id: email,
        name: fullName || email.split("@")[0],
        email,
      });
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      setError(sanitizeAuthError(msg, t));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <h2 className="text-lg font-display font-semibold text-text-primary mb-1">
        {mode === "signIn" ? t("signIn") : t("createAccount")}
      </h2>
      <p className="text-xs text-text-secondary mb-4">
        {mode === "signIn"
          ? t("signInSyncDescription")
          : t("createAccountBackupDescription")}
      </p>

      <form onSubmit={handleSubmit} className="space-y-3">
        {mode === "signUp" && (
          <div>
            <label className="text-[10px] text-text-secondary uppercase tracking-wider block mb-1">
              {t("name")}
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full bg-bg-primary border border-border-default px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary"
              placeholder={t("namePlaceholder")}
            />
          </div>
        )}

        <div>
          <label className="text-[10px] text-text-secondary uppercase tracking-wider block mb-1">
            {t("email")}
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full bg-bg-primary border border-border-default px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary"
            placeholder={t("emailPlaceholder")}
          />
        </div>

        <div>
          <label className="text-[10px] text-text-secondary uppercase tracking-wider block mb-1">
            {t("password")}
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            className="w-full bg-bg-primary border border-border-default px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary"
            placeholder={t("passwordPlaceholder")}
          />
        </div>

        {error && (
          <p className="text-xs text-status-error">{error}</p>
        )}

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full"
          loading={loading}
        >
          {mode === "signIn" ? t("signIn") : t("createAccount")}
        </Button>
      </form>

      <div className="mt-3 text-center">
        <button
          type="button"
          onClick={() => {
            setMode(mode === "signIn" ? "signUp" : "signIn");
            setError(null);
          }}
          className="text-xs text-accent-primary hover:underline"
        >
          {mode === "signIn" ? t("createAccount") : t("alreadyHaveAccountSignIn")}
        </button>
      </div>

      <div className="mt-3 pt-3 border-t border-border-default text-center">
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-text-tertiary hover:text-text-secondary"
        >
          {t("continueWithoutAccount")}
        </button>
      </div>
    </>
  );
}
