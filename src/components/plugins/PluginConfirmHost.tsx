/**
 * The single confirm host for safety-critical plugin RPCs.
 *
 * Wires the live operator-confirm callback into the `requestPluginConfirm`
 * seam (`src/lib/plugins/confirm.ts`) at mount and renders the shared
 * ConfirmDialog for a pending request, resolving the awaiting handler's promise
 * on approve/deny. One pending request at a time — a new request resolves any
 * prior one as denied so dialogs never stack. Mounts once, alongside the other
 * shell-wide bridges (mirrors SkillConfirmHost).
 *
 * While this host is NOT mounted, `requestPluginConfirm` resolves `false`, so
 * command.send / mission.write are denied — the safe default.
 *
 * @module plugins/PluginConfirmHost
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  setPluginConfirmHandler,
  type PluginConfirmRequest,
} from "@/lib/plugins/confirm";

interface Pending {
  req: PluginConfirmRequest;
  resolve: (confirmed: boolean) => void;
}

export function PluginConfirmHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  // Mirror the latest pending into a ref so the mount-once effect's closure
  // (and the unmount cleanup) can resolve a prior/in-flight request without
  // re-subscribing on every state change.
  const pendingRef = useRef<Pending | null>(null);
  pendingRef.current = pending;

  useEffect(() => {
    setPluginConfirmHandler(
      (req: PluginConfirmRequest, signal: AbortSignal) =>
        new Promise<boolean>((resolve) => {
          // Re-entrancy guard: a new request denies any prior pending one so
          // two dialogs never render at once.
          const prior = pendingRef.current;
          if (prior) prior.resolve(false);
          const entry: Pending = { req, resolve };
          // The confirm window lapsed: drop this dialog (only if it is still
          // the one showing) so a late click can never approve it.
          signal.addEventListener("abort", () => {
            resolve(false);
            setPending((cur) => (cur === entry ? null : cur));
          });
          setPending(entry);
        }),
    );
    return () => {
      setPluginConfirmHandler(null);
      // Deny any in-flight request on unmount so an awaiting handler never hangs.
      const prior = pendingRef.current;
      if (prior) prior.resolve(false);
    };
  }, []);

  if (!pending) return null;

  const severity = pending.req.severity ?? "warning";
  const settle = (confirmed: boolean) => {
    const current = pending;
    setPending(null);
    current.resolve(confirmed);
  };

  return (
    <ConfirmDialog
      open
      onCancel={() => settle(false)}
      onConfirm={() => settle(true)}
      title={`${pending.req.title} — ${pending.req.targetName}`}
      message={pending.req.body}
      variant={severity === "critical" ? "danger" : "primary"}
    />
  );
}
