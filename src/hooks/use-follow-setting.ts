"use client";

/**
 * @module use-follow-setting
 * @description A follow-me quick setting written from the cockpit
 * (`reacquire_mode` STRICT | SMART, `uncertain_mode` FOLLOW | HOLD,
 * `predictive_search` on | off), with its pending rule. A write goes through
 * the plugin config write path; the new value shows as pending until
 * `follow.state` echoes it. With no echo inside
 * {@link FOLLOW_SETTING_ECHO_TIMEOUT_MS} (or a write that fails) it reverts
 * and raises a warning toast. Every control of one setting reads the same
 * pending state, so a change made in one shows pending in the others.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useEffect } from "react";
import { create } from "zustand";

import { specString } from "@/lib/cockpit/spec-strings";
import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import { usePluginConfigCache } from "@/lib/plugins/config-cache";
import { writePluginConfigValue } from "@/lib/skills/plugin-config-writer";
import { isDemoMode } from "@/lib/utils";
import { FOLLOW_ME_PLUGIN_ID } from "@/hooks/use-nav-feed";
import { useToast } from "@/components/ui/toast";

export const FOLLOW_SETTING_ECHO_TIMEOUT_MS = 3000;

/** The follow-me config keys the cockpit writes as quick settings. */
export type FollowSettingKey = "reacquire_mode" | "uncertain_mode" | "predictive_search";

type SettingValue = string | boolean;

interface Pending {
  value: SettingValue;
  token: number;
}

interface FollowSettingPendingState {
  /** Pending writes by `<droneId>|<key>`. */
  byKey: Record<string, Pending>;
}

/** Pending writes per drone and key; shared so every control shows the same pending state. */
export const useFollowSettingPendingStore = create<FollowSettingPendingState>()(() => ({
  byKey: {},
}));

const slot = (droneId: string, key: FollowSettingKey) => `${droneId}|${key}`;

let nextToken = 1;

function beginPending(id: string, value: SettingValue): number {
  const token = nextToken++;
  useFollowSettingPendingStore.setState((s) => ({ byKey: { ...s.byKey, [id]: { value, token } } }));
  return token;
}

/** Clear the pending write when it is still `token`; true when it was. */
function endPending(id: string, token: number): boolean {
  const cur = useFollowSettingPendingStore.getState().byKey[id];
  if (!cur || cur.token !== token) return false;
  useFollowSettingPendingStore.setState((s) => {
    const byKey = { ...s.byKey };
    delete byKey[id];
    return { byKey };
  });
  return true;
}

/**
 * Send one follow-me setting to the drone's config. Demo mode has no agent
 * to reach; it records the value in the plugin config cache, which the demo
 * follow feed echoes.
 */
export async function sendFollowSetting(droneId: string, key: FollowSettingKey, value: SettingValue): Promise<boolean> {
  if (isDemoMode()) {
    usePluginConfigCache.getState().record(droneId, FOLLOW_ME_PLUGIN_ID, key, value);
    return true;
  }
  return writePluginConfigValue({
    droneId: deviceIdFromNodeId(droneId) ?? droneId,
    pluginId: FOLLOW_ME_PLUGIN_ID,
    key,
    value,
  });
}

/** The warning raised when a write is not echoed. */
function notAppliedText(key: FollowSettingKey): string {
  if (key === "reacquire_mode") return specString("follow.reacquire_not_applied");
  return specString("flow.mode.result.failed", {
    label: specString(`follow.setting.${key}`),
    reason: specString("setup.state.failed"),
  });
}

export interface FollowSettingControl<T extends SettingValue> {
  /** The value to show: the pending one, else the echoed one. */
  value: T | null;
  /** The value awaiting its echo, or null. */
  pending: T | null;
  select: (value: T) => void;
}

export function useFollowSetting<T extends SettingValue>(
  droneId: string,
  key: FollowSettingKey,
  echoed: T | null,
): FollowSettingControl<T> {
  const { toast } = useToast();
  const id = slot(droneId, key);
  const pending = useFollowSettingPendingStore((s) => s.byKey[id] ?? null);

  // The echo settles the pending write.
  useEffect(() => {
    if (pending && echoed === pending.value) endPending(id, pending.token);
  }, [id, pending, echoed]);

  const shown = (pending?.value as T | undefined) ?? echoed;
  const select = useCallback(
    (value: T) => {
      if (value === shown) return;
      const token = beginPending(id, value);
      const notApplied = () => {
        if (endPending(id, token)) toast(notAppliedText(key), "warning");
      };
      setTimeout(notApplied, FOLLOW_SETTING_ECHO_TIMEOUT_MS);
      sendFollowSetting(droneId, key, value).then(
        (ok) => {
          if (!ok) notApplied();
        },
        notApplied,
      );
    },
    [droneId, id, key, shown, toast],
  );

  return { value: shown, pending: (pending?.value as T | undefined) ?? null, select };
}
