/**
 * Settings store aggregator. Combines per-domain slices into one persisted
 * Zustand store. State stays unified so the persist middleware writes a
 * single IndexedDB record per session.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { indexedDBStorage } from "@/lib/storage";
import { migrateSettings } from "./settings-store/migrations";
import { createDisplayActions, displayDefaults } from "./settings/display-slice";
import { createNetworkActions, networkDefaults } from "./settings/network-slice";
import { authDefaults, createAuthActions } from "./settings/auth-slice";
import { commandTabDefaults, createCommandTabActions } from "./settings/command-tab-slice";
import { createVideoActions, videoDefaults } from "./settings/video-slice";
import {
  createKeybindingsActions,
  keybindingsDefaults,
} from "./settings/keybindings-slice";
import type { SettingsStoreState } from "./settings/types";

export type * from "./settings-store-types";
export type { SettingsStoreState } from "./settings/types";
export {
  DEFAULT_PARAM_COLUMNS,
  DEFAULT_TELEMETRY_DECK_PAGES,
  cloneDefaultTelemetryDeckPages,
} from "./settings-store/constants";
export { migrateSettings } from "./settings-store/migrations";

export const useSettingsStore = create<SettingsStoreState>()(
  persist(
    (set, get) => ({
      ...(displayDefaults as SettingsStoreState),
      ...(networkDefaults as SettingsStoreState),
      ...(authDefaults as SettingsStoreState),
      ...(commandTabDefaults as SettingsStoreState),
      ...(videoDefaults as SettingsStoreState),
      ...(keybindingsDefaults as SettingsStoreState),
      ...createDisplayActions(set, get),
      ...createNetworkActions(set, get),
      ...createAuthActions(set, get),
      ...createCommandTabActions(set, get),
      ...createVideoActions(set, get),
      ...createKeybindingsActions(set, get),
    }),
    {
      name: "altcmd:settings",
      storage: createJSONStorage(indexedDBStorage.storage),
      version: 49,
      migrate: migrateSettings,
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state._hasHydrated = true;
        // `?demo=true` URL is an explicit per-session opt-in: flip the
        // toggle on so DemoProvider activates this load. The env var no
        // longer overrides the persisted toggle here — env seeds the
        // first-install default in display-slice, then the user's choice
        // wins on subsequent loads.
        if (typeof window !== "undefined") {
          const params = new URLSearchParams(window.location.search);
          if (params.get("demo") === "true" && !state.demoMode) {
            state.demoMode = true;
          }
        }
      },
    },
  ),
);
