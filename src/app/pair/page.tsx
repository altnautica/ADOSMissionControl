"use client";

/**
 * @module pair/page
 * @description Deep-link entry for pairing a new ADOS Drone Agent.
 * The agent's setup wizard generates a 6-character code and links the
 * operator here. The page reads the code from `?code=`, opens the
 * pairing dialog, and lets the existing `claimPairingCode` mutation
 * finish the work. If the operator is not signed in yet, the code is
 * stashed in sessionStorage so it survives the round-trip through
 * sign-in.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { PairingDialog } from "@/components/command/PairingDialog";

const STORAGE_KEY = "ados.pair.deep_link";

interface StoredDeepLink {
  code: string;
  host?: string;
}

function readStored(): StoredDeepLink | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDeepLink;
    if (!parsed.code) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStored(value: StoredDeepLink | null) {
  if (typeof window === "undefined") return;
  try {
    if (value) {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } else {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // sessionStorage can be denied in private mode; non-fatal.
  }
}

function normalizeCode(raw: string | null): string {
  if (!raw) return "";
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

export default function PairDeepLinkPage() {
  const t = useTranslations("command");
  const router = useRouter();
  const searchParams = useSearchParams();

  const urlCode = useMemo(
    () => normalizeCode(searchParams.get("code")),
    [searchParams],
  );
  const urlHost = searchParams.get("host") || undefined;

  // Lazy initializer reads sessionStorage on the client only. URL params
  // win and overwrite the stash; we persist that overwrite as a side
  // effect so a later sign-in round-trip can recover it.
  const [stored] = useState<StoredDeepLink | null>(() => {
    const fromStorage = readStored();
    if (urlCode && urlCode.length === 6) {
      return { code: urlCode, host: urlHost };
    }
    return fromStorage;
  });

  const persistedRef = useRef(false);
  useEffect(() => {
    if (persistedRef.current) return;
    if (urlCode && urlCode.length === 6) {
      writeStored({ code: urlCode, host: urlHost });
      persistedRef.current = true;
    }
  }, [urlCode, urlHost]);

  const effectiveCode = stored?.code || urlCode || null;
  const effectiveHost = stored?.host || urlHost;

  const [open, setOpen] = useState(true);

  // After a successful pair, drop the deep-link record. The dialog calls
  // onPaired with the agent's connection URL; we route the operator to
  // the dashboard so they see the new drone.
  function handlePaired(_deviceId: string, _apiKey: string, _url: string) {
    writeStored(null);
    setOpen(false);
    router.push("/");
  }

  function handleClose() {
    writeStored(null);
    setOpen(false);
    router.push("/");
  }

  if (!effectiveCode) {
    return (
      <main className="flex h-full items-center justify-center bg-bg-primary text-text-primary">
        <div className="max-w-md rounded-md border border-border-default bg-bg-secondary p-6">
          <h1 className="text-base font-semibold">{t("pairNewNode")}</h1>
          <p className="mt-2 text-sm text-text-secondary">{t("pairLink.missingCode")}</p>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="mt-4 rounded-sm border border-border-strong bg-bg-tertiary px-3 py-2 text-sm hover:bg-bg-tertiary"
          >
            {t("pairLink.backToDashboard")}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-full items-center justify-center bg-bg-primary text-text-primary">
      <div className="max-w-md rounded-md border border-border-default bg-bg-secondary p-6">
        <h1 className="text-base font-semibold">{t("pairLink.title")}</h1>
        <p className="mt-2 text-sm text-text-secondary">
          {t("pairLink.codeLabel")}{" "}
          <span className="font-mono text-sm tracking-[0.4em]">
            {effectiveCode}
          </span>
        </p>
        {effectiveHost ? (
          <p className="mt-1 text-xs text-text-tertiary">
            {t("pairLink.deviceLabel")} <span className="font-mono">{effectiveHost}</span>
          </p>
        ) : null}
        <p className="mt-3 text-xs text-text-tertiary">{t("pairLink.signInHint")}</p>
      </div>
      <PairingDialog
        open={open}
        onClose={handleClose}
        onPaired={handlePaired}
        initialCode={effectiveCode}
      />
    </main>
  );
}
