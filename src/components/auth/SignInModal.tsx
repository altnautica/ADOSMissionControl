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
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
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

/**
 * The overlay was hand-rolled and had none of the modal affordances: no
 * Escape handling, no `role`, no `aria-modal`, no accessible name, no focus
 * trap and no focus restore, and its close X carried no accessible name.
 * Focus escaping a dialog that hosts a password field is a real trap for a
 * keyboard user, so this now renders through the shared `Modal`.
 *
 * `SignInModal` stays a thin gate with no hooks of its own so the dialog
 * mounts fresh on every open, which is what resets the form mode and fields.
 */
export function SignInModal({ open, onClose }: SignInModalProps) {
  if (!open) return null;
  return <SignInDialog onClose={onClose} />;
}

function SignInDialog({ onClose }: { onClose: () => void }) {
  const convexAvailable = useConvexAvailable();
  const t = useTranslations("auth");
  // The heading doubles as the dialog's accessible name, so the sign-in /
  // sign-up mode lives here rather than inside the form.
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");

  const title = !convexAvailable
    ? t("cloudNotAvailable")
    : mode === "signIn"
      ? t("signIn")
      : t("createAccount");

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      size="sm"
      // A backdrop click would discard half-typed credentials, and the
      // hand-rolled overlay never dismissed on one. Escape and the X close.
      disableBackdropClose
    >
      {convexAvailable ? (
        <ConvexSignInForm onClose={onClose} mode={mode} onModeChange={setMode} />
      ) : (
        <div className="text-center py-4">
          <p className="text-xs text-text-secondary mb-4">
            {t("cloudRequiresConvex")}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-text-tertiary hover:text-text-secondary focus-ring"
          >
            {t("continueLocalMode")}
          </button>
        </div>
      )}
    </Modal>
  );
}

/**
 * Inner form component that uses useAuthActions (must be inside ConvexAuthNextjsProvider).
 */
function ConvexSignInForm({
  onClose,
  mode,
  onModeChange,
}: {
  onClose: () => void;
  mode: "signIn" | "signUp";
  onModeChange: (mode: "signIn" | "signUp") => void;
}) {
  const { signIn } = useAuthActions();
  const setAuth = useAuthStore((s) => s.setAuth);
  const t = useTranslations("auth");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
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
            onModeChange(mode === "signIn" ? "signUp" : "signIn");
            setError(null);
          }}
          className="text-xs text-accent-primary hover:underline focus-ring"
        >
          {mode === "signIn" ? t("createAccount") : t("alreadyHaveAccountSignIn")}
        </button>
      </div>

      <div className="mt-3 pt-3 border-t border-border-default text-center">
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-text-tertiary hover:text-text-secondary focus-ring"
        >
          {t("continueWithoutAccount")}
        </button>
      </div>
    </>
  );
}
