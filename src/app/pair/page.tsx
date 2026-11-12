"use client";

/**
 * @module pair/page
 * @description Deep-link entry for pairing a new ADOS Drone Agent.
 * The agent's setup wizard generates a 6-character code and links the
 * operator here. The page reads the code (and optional `host`) from the URL,
 * opens the pairing dialog, and lets the existing `claimPairingCode`
 * mutation finish the work. The URL is the only source: sign-in happens
 * inside the dialog, so nothing has to survive a navigation, and a code is
 * used once rather than replayed into a later code-less visit.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { PairingDialog } from "@/components/command/PairingDialog";
import { useConvexAvailable } from "@/hooks/use-convex-available";
import { usePairDialogStore } from "@/stores/pair-dialog-store";

/** Session key an older build stashed the last deep-link code under. */
const LEGACY_STORAGE_KEY = "ados.pair.deep_link";

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
  const effectiveCode = urlCode.length === 6 ? urlCode : null;
  const effectiveHost = searchParams.get("host") || undefined;

  // Drop a code an older build left in this tab so it can never reopen.
  useEffect(() => {
    try {
      window.sessionStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // sessionStorage can be denied in private mode; non-fatal.
    }
  }, []);

  const [open, setOpen] = useState(true);

  // After a successful pair, route the operator to the dashboard so they see
  // the new drone.
  function handlePaired(_deviceId: string, _apiKey: string, _url: string) {
    setOpen(false);
    router.push("/");
  }

  function handleClose() {
    setOpen(false);
    router.push("/");
  }

  // A build without a cloud backend cannot claim a code. Hand the host (or
  // the code) to the shell's own pairing dialog, whose Add-a-drone field
  // takes it and probes the node, instead of opening an empty form over it.
  const convexAvailable = useConvexAvailable();
  const handOff = !convexAvailable ? (effectiveHost ?? effectiveCode) : null;
  const handedOffRef = useRef(false);
  useEffect(() => {
    if (!handOff || handedOffRef.current) return;
    handedOffRef.current = true;
    usePairDialogStore.getState().openDialog("add", handOff);
    router.replace("/");
  }, [handOff, router]);

  if (handOff) return null;

  // No usable code: open the manual pairing body rather than a dead end.
  if (!effectiveCode) {
    return (
      <main className="flex h-full items-center justify-center bg-bg-primary text-text-primary">
        <PairingDialog open={open} onClose={handleClose} onPaired={handlePaired} initialHost={effectiveHost} />
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
        initialHost={effectiveHost}
      />
    </main>
  );
}
