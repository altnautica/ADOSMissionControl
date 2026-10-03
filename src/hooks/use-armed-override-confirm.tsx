"use client";

/**
 * @module hooks/use-armed-override-confirm
 * @description The one operator confirmation for a flight-affecting agent
 * action the node refused because the vehicle is armed. A wrapped call is
 * sent first without the override; when the agent answers with
 * `AgentArmedRefusal`, the operator is asked whether to continue, and only a
 * confirmed prompt resends the same call with `force`.
 * @license GPL-3.0-only
 */

import { useCallback, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { AgentArmedRefusal } from "@/lib/agent/agent-client/transport";

export interface ArmedOverrideConfirm {
  /** Run `attempt(false)`; on an armed refusal ask the operator and, when
   * confirmed, run `attempt(true)`. A declined prompt rethrows the refusal. */
  withArmedOverride: <T>(attempt: (force: boolean) => Promise<T>) => Promise<T>;
  /** The prompt; render it once in the calling component. */
  armedOverrideDialog: ReactNode;
}

export function useArmedOverrideConfirm(): ArmedOverrideConfirm {
  const t = useTranslations("armedOverride");
  const [open, setOpen] = useState(false);
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);

  const settle = useCallback((confirmed: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setOpen(false);
    resolve?.(confirmed);
  }, []);

  const withArmedOverride = useCallback(
    async <T,>(attempt: (force: boolean) => Promise<T>): Promise<T> => {
      try {
        return await attempt(false);
      } catch (err) {
        if (!(err instanceof AgentArmedRefusal)) throw err;
        // A second refusal while a prompt is already open declines the older one.
        resolverRef.current?.(false);
        const confirmed = await new Promise<boolean>((resolve) => {
          resolverRef.current = resolve;
          setOpen(true);
        });
        if (!confirmed) throw err;
        return attempt(true);
      }
    },
    [],
  );

  const armedOverrideDialog = (
    <ConfirmDialog
      open={open}
      title={t("title")}
      message={t("message")}
      confirmLabel={t("confirm")}
      variant="danger"
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );

  return { withArmedOverride, armedOverrideDialog };
}
