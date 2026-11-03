"use client";

/**
 * @module use-reacquire-mode
 * @description The follow-me `reacquire_mode` (STRICT | SMART) write with its
 * pending rule, shared by the right rail and the follow skill popover. A
 * write goes through the plugin config write path; the new mode shows as
 * pending until `follow.state.reacquire_mode` echoes it. With no echo inside
 * {@link REACQUIRE_ECHO_TIMEOUT_MS} (or a write that fails) it reverts and
 * raises a warning toast.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useEffect } from "react";
import { useTranslations } from "next-intl";
import { create } from "zustand";

import type { ReacquireMode } from "@/lib/agent/nav-types";
import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import { usePluginConfigCache } from "@/lib/plugins/config-cache";
import { writePluginConfigValue } from "@/lib/skills/plugin-config-writer";
import { isDemoMode } from "@/lib/utils";
import { FOLLOW_ME_PLUGIN_ID } from "@/hooks/use-nav-feed";
import { useToast } from "@/components/ui/toast";

export const REACQUIRE_ECHO_TIMEOUT_MS = 3000;
export const REACQUIRE_CONFIG_KEY = "reacquire_mode";

interface Pending {
  mode: ReacquireMode;
  token: number;
}

interface ReacquirePendingState {
  byDrone: Record<string, Pending>;
}

/** Pending writes per drone; shared so every toggle shows the same pending state. */
export const useReacquirePendingStore = create<ReacquirePendingState>()(() => ({
  byDrone: {},
}));

let nextToken = 1;

function beginPending(droneId: string, mode: ReacquireMode): number {
  const token = nextToken++;
  useReacquirePendingStore.setState((s) => ({
    byDrone: { ...s.byDrone, [droneId]: { mode, token } },
  }));
  return token;
}

/** Clear the drone's pending write when it is still `token`; true when it was. */
function endPending(droneId: string, token: number): boolean {
  const cur = useReacquirePendingStore.getState().byDrone[droneId];
  if (!cur || cur.token !== token) return false;
  useReacquirePendingStore.setState((s) => {
    const byDrone = { ...s.byDrone };
    delete byDrone[droneId];
    return { byDrone };
  });
  return true;
}

/**
 * Send `reacquire_mode` to the drone's follow-me config. Demo mode has no
 * agent to reach; it records the value in the plugin config cache, which the
 * demo follow feed echoes.
 */
export async function sendReacquireMode(droneId: string, mode: ReacquireMode): Promise<boolean> {
  if (isDemoMode()) {
    usePluginConfigCache.getState().record(droneId, FOLLOW_ME_PLUGIN_ID, REACQUIRE_CONFIG_KEY, mode);
    return true;
  }
  return writePluginConfigValue({
    droneId: deviceIdFromNodeId(droneId) ?? droneId,
    pluginId: FOLLOW_ME_PLUGIN_ID,
    key: REACQUIRE_CONFIG_KEY,
    value: mode,
  });
}

export interface ReacquireModeControl {
  /** The mode to show: the pending one, else the echoed one. */
  mode: ReacquireMode | null;
  /** The mode awaiting its echo, or null. */
  pending: ReacquireMode | null;
  select: (mode: ReacquireMode) => void;
}

export function useReacquireMode(
  droneId: string,
  echoed: ReacquireMode | null,
): ReacquireModeControl {
  const t = useTranslations("hud.rail");
  const { toast } = useToast();
  const pending = useReacquirePendingStore((s) => s.byDrone[droneId] ?? null);

  // The echo settles the pending write.
  useEffect(() => {
    if (pending && echoed === pending.mode) endPending(droneId, pending.token);
  }, [droneId, pending, echoed]);

  const shown = pending?.mode ?? echoed;
  const select = useCallback(
    (mode: ReacquireMode) => {
      if (mode === shown) return;
      const token = beginPending(droneId, mode);
      const notApplied = () => {
        if (endPending(droneId, token)) toast(t("modeNotApplied"), "warning");
      };
      setTimeout(notApplied, REACQUIRE_ECHO_TIMEOUT_MS);
      sendReacquireMode(droneId, mode).then(
        (ok) => {
          if (!ok) notApplied();
        },
        notApplied,
      );
    },
    [droneId, shown, t, toast],
  );

  return { mode: shown, pending: pending?.mode ?? null, select };
}
