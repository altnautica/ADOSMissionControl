/**
 * Ephemeral per-user UI preferences that are not part of the settings store:
 * the last node-detail tab visited per node, so re-opening a node returns you
 * to where you left off (first open falls back to the per-profile default).
 * Keyed by the stable node deviceId. Local-first, per browser.
 *
 * @module ui-prefs-store
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface UiPrefsState {
  /** Last node-detail tab id, keyed by node deviceId. */
  lastTabByNode: Record<string, string>;
  setLastTab: (deviceId: string, tabId: string) => void;
  getLastTab: (deviceId: string) => string | undefined;
  /** Last Agent-page sub-page id, keyed by node deviceId, so re-opening the
   * Agent tab returns to where you left off (independent of the top-level tab). */
  lastAgentPanelByNode: Record<string, string>;
  setLastAgentPanel: (deviceId: string, panelId: string) => void;
  getLastAgentPanel: (deviceId: string) => string | undefined;
}

export const useUiPrefsStore = create<UiPrefsState>()(
  persist(
    (set, get) => ({
      lastTabByNode: {},
      setLastTab: (deviceId, tabId) =>
        set((s) => ({
          lastTabByNode: { ...s.lastTabByNode, [deviceId]: tabId },
        })),
      getLastTab: (deviceId) => get().lastTabByNode[deviceId],
      lastAgentPanelByNode: {},
      setLastAgentPanel: (deviceId, panelId) =>
        set((s) => ({
          lastAgentPanelByNode: {
            ...s.lastAgentPanelByNode,
            [deviceId]: panelId,
          },
        })),
      getLastAgentPanel: (deviceId) => get().lastAgentPanelByNode[deviceId],
    }),
    {
      name: "altcmd:ui-prefs",
      storage: createJSONStorage(() =>
        typeof window !== "undefined"
          ? window.localStorage
          : {
              getItem: () => null,
              setItem: () => {},
              removeItem: () => {},
            },
      ),
      version: 1,
      // Identity at v1, but the two maps are coerced rather than cast straight
      // through. Both are read by index the moment a node detail panel opens
      // (`getLastTab`, `getLastAgentPanel`), so a persisted value that is not an
      // object -- a hand-edited key, a half-written record, or a payload from
      // before `lastAgentPanelByNode` existed -- would throw during the first
      // render rather than degrade to "no remembered tab". Non-string entries
      // are dropped for the same reason: a tab id is looked up in a registry.
      //
      // Bump `version` and add a branch here the moment the persisted shape
      // changes.
      migrate: (persisted) => {
        const stringMap = (value: unknown): Record<string, string> => {
          if (!value || typeof value !== "object" || Array.isArray(value)) {
            return {};
          }
          return Object.fromEntries(
            Object.entries(value as Record<string, unknown>).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string",
            ),
          );
        };
        const prev = (persisted ?? {}) as Partial<UiPrefsState>;
        return {
          ...prev,
          lastTabByNode: stringMap(prev.lastTabByNode),
          lastAgentPanelByNode: stringMap(prev.lastAgentPanelByNode),
        } as UiPrefsState;
      },
    },
  ),
);
