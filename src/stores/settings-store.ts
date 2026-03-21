/**
 * @module settings-store
 * @description Zustand store for user preferences that persist across sessions.
 * Fully persisted to IndexedDB. These are portable settings that can optionally
 * sync to cloud when authenticated.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { indexedDBStorage } from "@/lib/storage";
import type { Jurisdiction } from "@/lib/jurisdiction";
import { isDemoMode } from "@/lib/utils";

export type MapTileSource = "osm" | "satellite" | "terrain" | "dark";
export type UnitSystem = "metric" | "imperial";
export type { Jurisdiction };

export type ParamColumnId = "index" | "name" | "description" | "value" | "range" | "units" | "type";
export type ParamColumnVisibility = Record<ParamColumnId, boolean>;

export const DEFAULT_PARAM_COLUMNS: ParamColumnVisibility = {
  index: true,
  name: true,
  description: false,
  value: true,
  range: true,
  units: true,
  type: false,
};

interface SettingsStoreState {
  /** Map tile source. */
  mapTileSource: MapTileSource;
  /** Unit system for display. */
  units: UnitSystem;
  /** Whether the local-data warning banner has been dismissed. */
  bannerDismissed: boolean;
  /** Timestamp when banner was dismissed (for 30-day re-show). */
  bannerDismissedAt: number | null;
  /** Total number of mission saves (for banner trigger logic). */
  saveCount: number;
  /** Whether the user has completed the welcome onboarding modal. */
  onboarded: boolean;
  /** Regulatory jurisdiction (null = not set, user skipped selection). */
  jurisdiction: Jurisdiction | null;
  /** Whether demo mode is active (gates mock data engine). */
  demoMode: boolean;
  /** True after IndexedDB hydration completes (prevents welcome modal flash). */
  _hasHydrated: boolean;
  /** FC Parameters column visibility. */
  paramColumns: ParamColumnVisibility;
  /** Whether audio alerts are enabled. */
  audioEnabled: boolean;
  /** Audio volume 0-1. */
  audioVolume: number;
  /** User-favorited FC parameter names. */
  favoriteParams: string[];
  /** Per-alert-category toggles. */
  alertLowBattery: boolean;
  alertGpsLost: boolean;
  alertRcLost: boolean;
  alertArmDisarm: boolean;
  alertWaypoint: boolean;
  alertFailsafe: boolean;
  /** Battery warning threshold (%). */
  batteryWarningPct: number;
  /** Battery critical threshold (%). */
  batteryCriticalPct: number;
  /** Alert popup duration in seconds ("3" | "5" | "10" | "never"). */
  alertPopupDuration: string;
  /** Auto-reconnect when transport disconnects unexpectedly. */
  autoReconnect: boolean;
  /** Auto-connect to last device on page load. */
  autoConnectOnLoad: boolean;
  /** Whether GCS location sharing is enabled. */
  locationEnabled: boolean;
  /** Last active FC configure panel ID (persisted for QoL). */
  lastActivePanel: string;
  /** Cesium 3D viewer imagery mode. */
  cesiumImageryMode: "dark" | "satellite";
  /** Whether Cesium OSM Buildings 3D tileset is enabled. */
  cesiumBuildingsEnabled: boolean;
  /** Terrain exaggeration factor (1 = normal). */
  terrainExaggeration: number;
  /** Whether distance/altitude labels are shown on flight paths. */
  showPathLabels: boolean;
  /** IDs of changelog entries the user has already seen. */
  seenChangelogIds: string[];
  /** Whether changelog notification modal is enabled on app load. */
  changelogNotificationsEnabled: boolean;
  /** Auto-start telemetry recording when a drone connects. */
  autoRecordOnConnect: boolean;
  /** Per-panel scroll positions (panelId -> scrollTop). */
  panelScrollPositions: Record<string, number>;
  /** Whether no-fly zone overlays are visible on maps. */
  showNoFlyZones: boolean;
  /** Whether offline tile caching is enabled. */
  offlineTileCaching: boolean;
  /** Display language locale code. */
  locale: string;
  setLocale: (locale: string) => void;

  setMapTileSource: (source: MapTileSource) => void;
  setUnits: (units: UnitSystem) => void;
  dismissBanner: () => void;
  incrementSaveCount: () => void;
  setOnboarded: (onboarded: boolean) => void;
  setJurisdiction: (jurisdiction: Jurisdiction | null) => void;
  setDemoMode: (demoMode: boolean) => void;
  setParamColumn: (col: ParamColumnId, visible: boolean) => void;
  setAudioEnabled: (enabled: boolean) => void;
  setAudioVolume: (volume: number) => void;
  toggleFavorite: (name: string) => void;
  isFavorite: (name: string) => boolean;
  setAlert: (key: "alertLowBattery" | "alertGpsLost" | "alertRcLost" | "alertArmDisarm" | "alertWaypoint" | "alertFailsafe", enabled: boolean) => void;
  setBatteryWarningPct: (pct: number) => void;
  setBatteryCriticalPct: (pct: number) => void;
  setAlertPopupDuration: (duration: string) => void;
  setAutoReconnect: (enabled: boolean) => void;
  setAutoConnectOnLoad: (enabled: boolean) => void;
  setLocationEnabled: (enabled: boolean) => void;
  setLastActivePanel: (panelId: string) => void;
  setCesiumImageryMode: (mode: "dark" | "satellite") => void;
  setCesiumBuildingsEnabled: (enabled: boolean) => void;
  setTerrainExaggeration: (value: number) => void;
  setShowPathLabels: (show: boolean) => void;
  markChangelogSeen: (ids: string[]) => void;
  clearSeenChangelog: () => void;
  setChangelogNotificationsEnabled: (enabled: boolean) => void;
  setAutoRecordOnConnect: (enabled: boolean) => void;
  setPanelScrollPosition: (panelId: string, scrollTop: number) => void;
  setShowNoFlyZones: (show: boolean) => void;
  setOfflineTileCaching: (enabled: boolean) => void;
}

export const useSettingsStore = create<SettingsStoreState>()(
  persist(
    (set, get) => ({
      mapTileSource: "osm",
      units: "metric",
      bannerDismissed: false,
      bannerDismissedAt: null,
      saveCount: 0,
      onboarded: false,
      jurisdiction: null,
      demoMode: false,
      _hasHydrated: false,
      paramColumns: { ...DEFAULT_PARAM_COLUMNS },
      audioEnabled: false,
      audioVolume: 0.7,
      favoriteParams: [],
      alertLowBattery: true,
      alertGpsLost: true,
      alertRcLost: true,
      alertArmDisarm: true,
      alertWaypoint: true,
      alertFailsafe: true,
      batteryWarningPct: 30,
      batteryCriticalPct: 20,
      alertPopupDuration: "5",
      autoReconnect: true,
      autoConnectOnLoad: true,
      locationEnabled: false,
      lastActivePanel: "outputs",
      cesiumImageryMode: "dark",
      cesiumBuildingsEnabled: false,
      terrainExaggeration: 1,
      showPathLabels: false,
      seenChangelogIds: [],
      changelogNotificationsEnabled: true,
      autoRecordOnConnect: false,
      panelScrollPositions: {},
      showNoFlyZones: false,
      offlineTileCaching: true,
      locale: 'en',

      setMapTileSource: (mapTileSource) => set({ mapTileSource }),
      setUnits: (units) => set({ units }),
      dismissBanner: () => set({ bannerDismissed: true, bannerDismissedAt: Date.now() }),
      incrementSaveCount: () => set((s) => ({ saveCount: s.saveCount + 1 })),
      setOnboarded: (onboarded) => set({ onboarded }),
      setJurisdiction: (jurisdiction) => set({ jurisdiction }),
      setDemoMode: (demoMode) => set({ demoMode }),
      setParamColumn: (col, visible) =>
        set((s) => ({ paramColumns: { ...s.paramColumns, [col]: visible } })),
      setAudioEnabled: (audioEnabled) => set({ audioEnabled }),
      setAudioVolume: (audioVolume) => set({ audioVolume }),
      toggleFavorite: (name) =>
        set((s) => ({
          favoriteParams: s.favoriteParams.includes(name)
            ? s.favoriteParams.filter((n) => n !== name)
            : [...s.favoriteParams, name],
        })),
      isFavorite: (name) => get().favoriteParams.includes(name),
      setAlert: (key, enabled) => set({ [key]: enabled }),
      setBatteryWarningPct: (batteryWarningPct) => set({ batteryWarningPct }),
      setBatteryCriticalPct: (batteryCriticalPct) => set({ batteryCriticalPct }),
      setAlertPopupDuration: (alertPopupDuration) => set({ alertPopupDuration }),
      setAutoReconnect: (autoReconnect) => set({ autoReconnect }),
      setAutoConnectOnLoad: (autoConnectOnLoad) => set({ autoConnectOnLoad }),
      setLocationEnabled: (locationEnabled) => set({ locationEnabled }),
      setLastActivePanel: (lastActivePanel) => set({ lastActivePanel }),
      setCesiumImageryMode: (cesiumImageryMode) => set({ cesiumImageryMode }),
      setCesiumBuildingsEnabled: (cesiumBuildingsEnabled) => set({ cesiumBuildingsEnabled }),
      setTerrainExaggeration: (value) => set({ terrainExaggeration: Math.max(0.1, Math.min(10, value)) }),
      setShowPathLabels: (showPathLabels) => set({ showPathLabels }),
      markChangelogSeen: (ids) =>
        set((s) => ({
          seenChangelogIds: [...new Set([...s.seenChangelogIds, ...ids])],
        })),
      clearSeenChangelog: () => set({ seenChangelogIds: [] }),
      setChangelogNotificationsEnabled: (changelogNotificationsEnabled) =>
        set({ changelogNotificationsEnabled }),
      setAutoRecordOnConnect: (autoRecordOnConnect) => set({ autoRecordOnConnect }),
      setPanelScrollPosition: (panelId, scrollTop) =>
        set((s) => ({
          panelScrollPositions: { ...s.panelScrollPositions, [panelId]: scrollTop },
        })),
      setShowNoFlyZones: (showNoFlyZones) => set({ showNoFlyZones }),
      setOfflineTileCaching: (offlineTileCaching) => set({ offlineTileCaching }),
      setLocale: (locale) => set({ locale }),
    }),
    {
      name: "altcmd:settings",
      storage: createJSONStorage(indexedDBStorage.storage),
      version: 18,
      migrate: (persisted, version) => {
        const state = persisted as Record<string, unknown>;
        if (version < 2) {
          state.onboarded = false;
          state.jurisdiction = null;
          state.demoMode = true;
        }
        if (version < 5) {
          // v5: removed description + default columns, show range + units by default
          state.paramColumns = { ...DEFAULT_PARAM_COLUMNS };
        }
        if (version < 6) {
          // v6: audio alerts + favorite params
          state.audioEnabled = true;
          state.audioVolume = 0.7;
          state.favoriteParams = [];
        }
        if (version < 7) {
          // v7: per-alert toggles + alert thresholds
          state.alertLowBattery = true;
          state.alertGpsLost = true;
          state.alertRcLost = true;
          state.alertArmDisarm = true;
          state.alertWaypoint = true;
          state.alertFailsafe = true;
          state.batteryWarningPct = 30;
          state.batteryCriticalPct = 20;
          state.alertPopupDuration = "5";
        }
        if (version < 8) {
          // v8: auto-reconnect + auto-connect on load
          state.autoReconnect = true;
          state.autoConnectOnLoad = true;
        }
        if (version < 9) {
          // v9: GCS location sharing
          state.locationEnabled = false;
        }
        if (version < 10) {
          // v10: last active FC panel persistence
          state.lastActivePanel = "outputs";
        }
        if (version < 11) {
          // v11: jurisdiction is now nullable — existing users keep their value
          // (no change needed, their persisted value is preserved)
        }
        if (version < 12) {
          // v12: Cesium 3D viewer settings
          state.cesiumImageryMode = "dark";
          state.cesiumBuildingsEnabled = false;
          state.terrainExaggeration = 1;
          state.showPathLabels = false;
        }
        if (version < 13) {
          // v13: Changelog notification tracking
          state.seenChangelogIds = [];
          state.changelogNotificationsEnabled = true;
        }
        if (version < 14) {
          // v14: Auto-start recording on drone connect
          state.autoRecordOnConnect = false;
        }
        if (version < 15) {
          // v15: Panel scroll positions + description column in param grid
          state.panelScrollPositions = {};
          const cols = state.paramColumns as ParamColumnVisibility | undefined;
          if (cols && !("description" in cols)) {
            (cols as Record<string, boolean>).description = false;
          }
        }
        if (version < 16) {
          // v16: No-fly zone overlays + offline tile caching
          state.showNoFlyZones = false;
          state.offlineTileCaching = true;
        }
        if (version < 17) {
          // v17: Demo mode default flipped to false — env var/URL is authoritative
          state.demoMode = false;
        }
        if (version < 18) {
          // v18: display language locale
          state.locale = 'en';
        }
        return state as unknown as SettingsStoreState;
      },
      onRehydrateStorage: () => {
        return (state) => {
          if (state) {
            state._hasHydrated = true;
            // Sync demo mode with env/URL — env var is authoritative
            const envDemo = isDemoMode();
            if (state.demoMode !== envDemo) {
              state.demoMode = envDemo;
            }
          }
        };
      },
    }
  )
);
