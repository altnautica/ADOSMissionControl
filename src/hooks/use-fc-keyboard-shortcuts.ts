"use client";

import { useEffect, useCallback } from "react";
import { useDroneManager } from "@/stores/drone-manager";
import { useParamSafetyStore } from "@/stores/param-safety-store";
import type { PanelSaveOutcome } from "@/stores/fc-panel-actions-store";
import { useToast } from "@/components/ui/toast";

/**
 * Global keyboard shortcuts for FC configuration panels.
 *
 * - Ctrl+S: Save all dirty params to RAM
 * - Ctrl+Shift+S: Commit all RAM writes to flash
 * - Ctrl+R: Refresh current panel params
 *
 * @param onSaveToRam - Called when Ctrl+S is pressed. Reports how many dirty
 *   parameters it tried to write and whether every write landed, so the toast
 *   states what happened instead of asserting a save unconditionally.
 * @param onRefresh - Called when Ctrl+R is pressed
 */
export function useFcKeyboardShortcuts(
  onSaveToRam?: () => Promise<PanelSaveOutcome>,
  onRefresh?: () => Promise<void>,
) {
  const { toast } = useToast();

  const handleKeyDown = useCallback(
    async (e: KeyboardEvent) => {
      const isCtrl = e.ctrlKey || e.metaKey;

      // Ctrl+S — Save to RAM
      if (isCtrl && !e.shiftKey && e.key === "s") {
        e.preventDefault();
        if (onSaveToRam) {
          const { attempted, ok } = await onSaveToRam();
          if (attempted === 0) toast("No unsaved parameter changes", "info");
          else if (ok) toast(`${attempted} parameter${attempted === 1 ? "" : "s"} saved to RAM`, "success");
          else toast("Some parameters failed to save", "error");
        }
        return;
      }

      // Ctrl+Shift+S — Flash commit
      if (isCtrl && e.shiftKey && e.key === "S") {
        e.preventDefault();
        const protocol = useDroneManager.getState().getSelectedProtocol();
        const store = useParamSafetyStore.getState();
        if (protocol && store.getPendingCount() > 0) {
          const result = await protocol.commitParamsToFlash();
          if (result.success) {
            store.commitFlash();
            // PREFLIGHT_STORAGE is fire-and-forget; `acknowledged === false`
            // means the command reached the wire and nothing confirmed the
            // write. Never render that as "committed to flash".
            if (result.acknowledged === false) {
              toast("Flash commit sent — vehicle did not acknowledge it", "warning");
            } else {
              toast("Parameters committed to flash", "success");
            }
          } else {
            toast(`Flash commit failed: ${result.message}`, "error");
          }
        } else if (store.getPendingCount() === 0) {
          toast("No pending changes to commit");
        }
        return;
      }

      // Ctrl+R — Refresh
      if (isCtrl && e.key === "r") {
        e.preventDefault();
        if (onRefresh) {
          await onRefresh();
          toast("Parameters refreshed");
        }
        return;
      }
    },
    [onSaveToRam, onRefresh, toast],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}
