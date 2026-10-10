"use client";

/**
 * @module hooks/use-panel-commit
 * @description The save / flash / revert actions every parameter panel offers,
 * with their localized result toasts, over the panel's `usePanelParams`.
 *
 *   const { saving, save, flash, revert } = usePanelCommit(panelParams);
 *   <PanelFooter onSave={save} onFlash={flash} onRevert={revert} saving={saving} … />
 *
 * `save` writes every dirty value to the FC's RAM and reports full or partial
 * success; `flash` commits RAM to persistent storage and reports the three
 * flash outcomes (written, unacknowledged, failed); `revert` restores the
 * values last read from the FC.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/toast";
import { useFlashCommitToast, type FlashResultOptions } from "@/hooks/use-flash-commit-toast";
import type { PanelParamActions } from "@/hooks/use-panel-params";

export type PanelCommitSource = Pick<PanelParamActions, "saveAllToRam" | "commitToFlash" | "revertAll">;

export interface PanelCommitMessages {
  /** Override the full-success save toast (already localized). */
  saved?: string;
  /** Overrides for the flash outcome toasts (already localized). */
  flash?: FlashResultOptions;
}

export interface PanelCommit {
  /** True while a save is in flight. */
  saving: boolean;
  /** Write every dirty value to RAM; resolves to whether all writes landed. */
  save: () => Promise<boolean>;
  /** Commit RAM to flash and report the outcome. */
  flash: () => Promise<void>;
  /** Restore the values last read from the FC. */
  revert: () => void;
}

export function usePanelCommit(
  { saveAllToRam, commitToFlash, revertAll }: PanelCommitSource,
  messages?: PanelCommitMessages,
): PanelCommit {
  const t = useTranslations("panelCommit");
  const { toast } = useToast();
  const { showFlashResult } = useFlashCommitToast();
  const [saving, setSaving] = useState(false);
  const savedMessage = messages?.saved;
  const flashOptions = messages?.flash;

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const ok = await saveAllToRam();
      if (ok) toast(savedMessage ?? t("saved"), "success");
      else toast(t("partialSave"), "warning");
      return ok;
    } finally {
      setSaving(false);
    }
  }, [saveAllToRam, savedMessage, t, toast]);

  const flash = useCallback(async () => {
    showFlashResult(await commitToFlash(), flashOptions);
  }, [commitToFlash, flashOptions, showFlashResult]);

  const revert = useCallback(() => {
    revertAll();
    toast(t("reverted"), "info");
  }, [revertAll, t, toast]);

  return { saving, save, flash, revert };
}
