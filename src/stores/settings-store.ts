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
  persist<SettingsStoreState, [], [], Partial<SettingsStoreState>>(
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
      // Runs after a successful rehydrate AND after a failed one (state is
      // undefined then): either way the persisted read is over and every gate
      // waiting on `_hasHydrated` must open, on the defaults if need be.
      // The flags go through setState so subscribers are notified; mutating
      // the state object here would change the value no selector re-reads.
      // Deferred a microtask because a synchronous storage hydrates inside
      // create(), before `useSettingsStore` is bound.
      onRehydrateStorage: () => () => {
        queueMicrotask(() => {
          // `?demo=true` URL is an explicit opt-in: flip the toggle on so
          // DemoProvider activates this load. The env var no longer overrides
          // the persisted toggle here — env seeds the first-install default in
          // display-slice, then the user's choice wins on subsequent loads.
          const demoFromUrl =
            typeof window !== "undefined" &&
            new URLSearchParams(window.location.search).get("demo") === "true";
          useSettingsStore.setState(
            demoFromUrl ? { _hasHydrated: true, demoMode: true } : { _hasHydrated: true },
          );
        });
      },
    },
  ),
);
