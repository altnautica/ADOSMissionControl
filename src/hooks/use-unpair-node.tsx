"use client";

/**
 * @module hooks/use-unpair-node
 * @description Unpair with the fallback every unpair surface shares. When the
 * node cannot release its pairing (offline, unreachable), nothing is removed
 * and the operator chooses: forget it on this GCS only, or cancel.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useForgetNode, type UseForgetNodeOptions } from "@/hooks/use-forget-node";
import type { ForgetNodeResult } from "@/lib/agent/forget-node";

interface PendingUnpair {
  nodeId: string;
  name: string;
  convexId: string | null;
  onDone?: () => void;
}

export interface UnpairRequest extends Omit<UseForgetNodeOptions, "localOnly"> {
  /** Node name for the fallback prompt. */
  name: string;
  /** Runs once the node is gone, through either path. */
  onDone?: () => void;
}

export function useUnpairNode(): {
  unpair: (nodeId: string, request: UnpairRequest) => Promise<ForgetNodeResult>;
  fallbackDialog: ReactNode;
} {
  const t = useTranslations("nodesView.unpairUnreachable");
  const forget = useForgetNode();
  const [pending, setPending] = useState<PendingUnpair | null>(null);

  const unpair = useCallback(
    async (nodeId: string, request: UnpairRequest) => {
      const convexId = request.convexId ?? null;
      const result = await forget(nodeId, { convexId });
      if (result.ok) request.onDone?.();
      else if (result.reason === "agentUnreachable") {
        setPending({ nodeId, name: request.name, convexId, onDone: request.onDone });
      }
      return result;
    },
    [forget],
  );

  const forgetHere = async () => {
    if (!pending) return;
    setPending(null);
    const result = await forget(pending.nodeId, {
      convexId: pending.convexId,
      localOnly: true,
    });
    if (result.ok) pending.onDone?.();
  };

  const fallbackDialog = (
    <ConfirmDialog
      open={pending !== null}
      title={t("title")}
      message={t("message", { name: pending?.name ?? "" })}
      confirmLabel={t("forgetHere")}
      variant="danger"
      onConfirm={() => void forgetHere()}
      onCancel={() => setPending(null)}
    />
  );

  return { unpair, fallbackDialog };
}
