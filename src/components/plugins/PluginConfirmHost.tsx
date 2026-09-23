/**
 * The single confirm host for safety-critical plugin RPCs.
 *
 * Wires the live operator-confirm callback into the `requestPluginConfirm`
 * seam (`src/lib/plugins/confirm.ts`) at mount and renders the shared
 * ConfirmDialog for the presented request, resolving the awaiting handler's
 * promise on approve/deny. The seam presents one request at a time in arrival
 * order, so this host only ever shows one dialog. The Confirm button stays
 * disabled for a short arming delay after each dialog appears so a click aimed
 * at the previous dialog cannot approve the next one. Mounts once, alongside
 * the other shell-wide bridges (mirrors SkillConfirmHost).
 *
 * While this host is NOT mounted, `requestPluginConfirm` resolves `denied`, so
 * command.send / mission.write are denied — the safe default.
 *
 * @module plugins/PluginConfirmHost
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  PLUGIN_CONFIRM_ARM_DELAY_MS,
  setPluginConfirmHandler,
  type PluginConfirmRequest,
} from "@/lib/plugins/confirm";

interface Pending {
  req: PluginConfirmRequest;
  resolve: (confirmed: boolean) => void;
  /** Confirm is clickable once the arming delay has passed. */
  armed: boolean;
}

/** `Drone 1 (dev-123)`, or just the id when the drone has no other name. */
function targetLabel(req: PluginConfirmRequest): string {
  return req.targetName === req.targetId
    ? req.targetId
    : `${req.targetName} (${req.targetId})`;
}

export function PluginConfirmHost() {
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    setPluginConfirmHandler(
      (req: PluginConfirmRequest, signal: AbortSignal) => {
        const { promise, resolve } = Promise.withResolvers<boolean>();
        const entry: Pending = { req, resolve, armed: false };
        const armTimer = setTimeout(() => {
          setPending((cur) =>
            cur?.resolve === resolve ? { ...cur, armed: true } : cur,
          );
        }, PLUGIN_CONFIRM_ARM_DELAY_MS);
        // The confirm window lapsed: drop this dialog (only if it is still
        // the one showing) so a late click can never approve it.
        signal.addEventListener("abort", () => {
          clearTimeout(armTimer);
          resolve(false);
          setPending((cur) => (cur?.resolve === resolve ? null : cur));
        });
        setPending(entry);
        return promise;
      },
    );
    // Unwiring aborts the presented request, which denies it through the
    // abort listener above, so an awaiting handler never hangs.
    return () => setPluginConfirmHandler(null);
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
      confirmDisabled={!pending.armed}
      title={`${pending.req.title} — ${targetLabel(pending.req)}`}
      message={pending.req.body}
      variant={severity === "critical" ? "danger" : "primary"}
    />
  );
}
