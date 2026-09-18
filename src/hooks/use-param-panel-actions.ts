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

import { useCallback, useState } from "react";
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

const DEFAULT_SUCCESS = "Saved to flight controller";
const DEFAULT_WARNING = "Some parameters failed to save";
const DEFAULT_REVERT = "Reverted to FC values";

export function useParamPanelActions(
  params: ActionSource,
  options: ParamPanelActionsOptions = {},
): ParamPanelActions {
  const { saveAllToRam, commitToFlash, revertAll } = params;
  const { toast } = useToast();
  const { showFlashResult } = useFlashCommitToast();
  const [saving, setSaving] = useState(false);

  const save = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    try {
      const ok = await saveAllToRam();
      if (ok) {
        toast(options.successMessage ?? DEFAULT_SUCCESS, "success");
      } else {
        toast(options.warningMessage ?? DEFAULT_WARNING, "warning");
      }
      return ok;
    } finally {
      setSaving(false);
    }
  }, [saveAllToRam, toast, options.successMessage, options.warningMessage]);

  const flash = useCallback(async (): Promise<FlashCommitOutcome> => {
    const outcome = await commitToFlash();
    showFlashResult(outcome, {
      successMessage: options.flashSuccessMessage,
      errorMessage: options.flashErrorMessage,
    });
    return outcome;
  }, [commitToFlash, showFlashResult, options.flashSuccessMessage, options.flashErrorMessage]);

  const revert = useCallback(() => {
    revertAll();
    toast(options.revertMessage ?? DEFAULT_REVERT, "info");
  }, [revertAll, toast, options.revertMessage]);

  return { saving, save, flash, revert };
}
