/**
 * @module hooks/use-param-panel-actions
 * @description Shared save / flash / revert lifecycle for FC parameter panels.
 *
 * Most parameter panels repeat the same boilerplate around `usePanelParams`:
 * a `saving` state flag, a `handleSave` that calls `saveAllToRam` and toasts
 * success or warning, a `handleFlash` that calls `commitToFlash` and forwards
 * the result to `useFlashCommitToast`, and a `handleRevert` that calls
 * `revertAll` and toasts an info message. This hook collapses the triad into
 * one call.
 *
 * Usage:
 *
 *   const params = usePanelParams({ paramNames, panelId: "my-panel" });
 *   const actions = useParamPanelActions(params);
 *   // actions.saving, actions.save(), actions.flash(), actions.revert()
 *
 * Override toast copy when defaults are misleading for a specific panel:
 *
 *   const actions = useParamPanelActions(params, {
 *     successMessage: "Failsafe saved",
 *     flashSuccessMessage: "Failsafe written to flash",
 *   });
 *
 * @license GPL-3.0-only
 */

import { useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/toast";
import { useFlashCommitToast, type FlashCommitOutcome } from "@/hooks/use-flash-commit-toast";
import type { PanelParamActions } from "@/hooks/use-panel-params-types";

export interface ParamPanelActionsOptions {
  /** Override the toast copy for a successful save-all-to-RAM. */
  successMessage?: string;
  /** Override the toast copy for a partial save-all-to-RAM failure. */
  warningMessage?: string;
  /** Override the toast copy for a successful flash commit. */
  flashSuccessMessage?: string;
  /** Override the toast copy for a failed flash commit. */
  flashErrorMessage?: string;
  /** Override the toast copy for a manual revert. */
  revertMessage?: string;
}

export interface ParamPanelActions {
  /** True while the save-all-to-RAM round-trip is in flight. */
  saving: boolean;
  /** True while a flash commit is in flight; another `flash()` meanwhile joins it. */
  flashing: boolean;
  /**
   * Save every dirty parameter to RAM and surface a toast for the result.
   * Returns true when every param wrote successfully.
   */
  save: () => Promise<boolean>;
  /**
   * Commit the current RAM state to flash and surface the standard
   * flash-commit toast. Returns the success flag from `commitToFlash`.
   */
  flash: () => Promise<FlashCommitOutcome>;
  /**
   * Revert every parameter back to the value last loaded from the FC and
   * surface an info toast.
   */
  revert: () => void;
}

type ActionSource = Pick<PanelParamActions, "saveAllToRam" | "commitToFlash" | "revertAll">;

export function useParamPanelActions(
  params: ActionSource,
  options: ParamPanelActionsOptions = {},
): ParamPanelActions {
  const { saveAllToRam, commitToFlash, revertAll } = params;
  const { toast } = useToast();
  const { showFlashResult } = useFlashCommitToast();
  const t = useTranslations("panelCommit");
  const [saving, setSaving] = useState(false);
  const [flashing, setFlashing] = useState(false);
  const inFlightFlash = useRef<Promise<FlashCommitOutcome> | null>(null);

  const save = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    try {
      const ok = await saveAllToRam();
      if (ok) {
        toast(options.successMessage ?? t("saved"), "success");
      } else {
        toast(options.warningMessage ?? t("partialSave"), "warning");
      }
      return ok;
    } finally {
      setSaving(false);
    }
  }, [saveAllToRam, toast, t, options.successMessage, options.warningMessage]);

  const flash = useCallback((): Promise<FlashCommitOutcome> => {
    // A press while a commit is in flight joins it instead of sending a second one.
    if (inFlightFlash.current) return inFlightFlash.current;
    setFlashing(true);
    const run = (async () => {
      try {
        const outcome = await commitToFlash();
        showFlashResult(outcome, {
          successMessage: options.flashSuccessMessage,
          errorMessage: options.flashErrorMessage,
        });
        return outcome;
      } finally {
        inFlightFlash.current = null;
        setFlashing(false);
      }
    })();
    inFlightFlash.current = run;
    return run;
  }, [commitToFlash, showFlashResult, options.flashSuccessMessage, options.flashErrorMessage]);

  const revert = useCallback(() => {
    revertAll();
    toast(options.revertMessage ?? t("reverted"), "info");
  }, [revertAll, toast, t, options.revertMessage]);

  return { saving, flashing, save, flash, revert };
}
