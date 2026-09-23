/**
 * Shared full-state shape for the persisted settings store. Slice files
 * import this so their action factories type their `set`/`get` against
 * the whole store and keep cross-field reads working when an action
 * references state outside its own slice.
 *
 * @license GPL-3.0-only
 */

import type {
  AccentColor,
  CoordFormat,
  GuidanceLineType,
  Jurisdiction,
  MapTileSource,
  ParamColumnId,
  ParamColumnVisibility,
  ParameterFilterPreset,
  TelemetryDeckMetricId,
  TelemetryDeckPageId,
  ThemeMode,
  UnitSystem,
} from "../settings-store-types";
import type {
  CockpitLayout,
  CockpitWidgetPlacement,
  Loadout,
  SuggestedBinding,
} from "./keybindings-slice";

export interface SettingsStoreState {
  // display + general preferences
  mapTileSource: MapTileSource;
  /**
   * Operator-supplied basemap tile URL template, used when `mapTileSource` is
   * `"custom"`. Stored raw — the `{z}`/`{x}`/`{y}` (and optional `{s}`/`{r}`)
   * placeholders are what Leaflet and the offline downloader consume, so the
   * string is never round-tripped through `URL`. Empty = not configured, which
   * renders as `dark` rather than an empty layer.
   */
  customTileUrl: string;
  /** Highest zoom the custom tile server serves. */
  customTileMaxZoom: number;
  /** Attribution HTML for the custom source. Empty = none. */
  customTileAttribution: string;
  units: UnitSystem;
  /** Map coordinate display format for the cursor readout (dd/dms/utm/mgrs). */
  coordFormat: CoordFormat;
  bannerDismissed: boolean;
  bannerDismissedAt: number | null;
  saveCount: number;
  onboarded: boolean;
  disclaimerAccepted: boolean;
  disclaimerAcceptedAt: number | null;
  disclaimerVersion: number;
  jurisdiction: Jurisdiction | null;
  /** GCS-wide default operating region (ISO 3166-1 alpha-2, e.g. "US"), or
   * null for the unrestricted default. Separate from the display-only
   * `jurisdiction` (which sets units + regulatory display labels). When a
   * drone is paired, the per-node region control offers this as the
   * suggested default. Null = unrestricted. */
  operatorRegion: string | null;
  demoMode: boolean;
  _hasHydrated: boolean;
  paramColumns: ParamColumnVisibility;
  audioEnabled: boolean;
  audioVolume: number;
  favoriteParams: string[];
  alertLowBattery: boolean;
  alertGpsLost: boolean;
  alertRcLost: boolean;
  alertArmDisarm: boolean;
  alertWaypoint: boolean;
  alertFailsafe: boolean;
  batteryWarningPct: number;
  batteryCriticalPct: number;
  alertPopupDuration: string;
  cesiumImageryMode: "dark" | "satellite";
  /** 3D simulation viewer rendering quality preset. "balanced" (default) or
   * "high" (adds MSAA 8x, sharper terrain LOD, and terrain relief lighting). */
  cesiumQuality: "balanced" | "high";
  cesiumBuildingsEnabled: boolean;
  terrainExaggeration: number;
  showPathLabels: boolean;
  showCameraTriggers: boolean;
  /** Draw the planned simulation path with Hermite-smoothed corners instead of
   * hard waypoint-to-waypoint turns. Display approximation only (the flight
   * controller flies its own cornering); default off. */
  roundedTurnsPreview: boolean;
  /** Auto-switch the simulation camera to follow (chase-cam) when playback
   * starts, restoring the prior mode on stop. Default off — follow stays a
   * user choice via the camera cluster. */
  autoFollowOnPlay: boolean;
  seenChangelogIds: string[];
  changelogNotificationsEnabled: boolean;
  autoRecordOnConnect: boolean;
  autoRecordOnArm: boolean;
  showNoFlyZones: boolean;
  /**
   * ISO 3166-1 alpha-2 region whose no-fly dataset the map draws, or null
   * when the operator has not said. Null is NOT "no restrictions": with no
   * region the overlay renders its unknown state, because an empty layer
   * looks exactly like clear airspace.
   */
  noFlyRegion: string | null;
  offlineTileCaching: boolean;
  locale: string;
  themeMode: ThemeMode;
  accentColor: AccentColor;
  paramFilterPresets: ParameterFilterPreset[];
  guidanceHdgLength: number;
  guidanceHdgWidth: number;
  guidanceHdgLineType: GuidanceLineType;
  guidanceHdgColor: string;
  guidanceTrackWpLength: number;
  guidanceTrackWpWidth: number;
  guidanceTrackWpLineType: GuidanceLineType;
  guidanceTrackWpColor: string;
  guidanceTgtHdgLength: number;
  guidanceTgtHdgWidth: number;
  guidanceTgtHdgLineType: GuidanceLineType;
  guidanceTgtHdgColor: string;
  guidanceHdgEnabled: boolean;
  guidanceTrackWpEnabled: boolean;
  guidanceTgtHdgEnabled: boolean;
  telemetryDeckActivePage: TelemetryDeckPageId;
  telemetryDeckPages: Record<TelemetryDeckPageId, TelemetryDeckMetricId[]>;
  /** Whether the onboarding flow pushes the chosen theme to every paired
   * agent. Default true; users can opt out from advanced settings. */
  pushThemeToAgents: boolean;

  // network preferences
  autoReconnect: boolean;
  autoConnectOnLoad: boolean;
  locationEnabled: boolean;

  // command-tab preferences
  lastActivePanel: string;
  panelScrollPositions: Record<string, number>;

  // video preferences
  videoWhepUrl: string;
  videoTransportMode: "auto" | "lan-whep" | "p2p-mqtt" | "off";
  hudAutoClaimPicOnFirstButton: boolean;

  // keybindings / hotbar (Cockpit loadouts)
  loadouts: Record<string, Loadout>;
  activeLoadoutId: string;

  // display actions
  setMapTileSource: (source: MapTileSource) => void;
  setCustomTileUrl: (url: string) => void;
  setCustomTileMaxZoom: (zoom: number) => void;
  setCustomTileAttribution: (attribution: string) => void;
  setUnits: (units: UnitSystem) => void;
  setCoordFormat: (format: CoordFormat) => void;
  dismissBanner: () => void;
  incrementSaveCount: () => void;
  setOnboarded: (onboarded: boolean) => void;
  setDisclaimerAccepted: (version: number) => void;
  setJurisdiction: (jurisdiction: Jurisdiction | null) => void;
  setOperatorRegion: (region: string | null) => void;
  setDemoMode: (demoMode: boolean) => void;
  setParamColumn: (col: ParamColumnId, visible: boolean) => void;
  setAudioEnabled: (enabled: boolean) => void;
  setAudioVolume: (volume: number) => void;
  toggleFavorite: (name: string) => void;
  isFavorite: (name: string) => boolean;
  setAlert: (
    key:
      | "alertLowBattery"
      | "alertGpsLost"
      | "alertRcLost"
      | "alertArmDisarm"
      | "alertWaypoint"
      | "alertFailsafe",
    enabled: boolean,
  ) => void;
  setBatteryWarningPct: (pct: number) => void;
  setBatteryCriticalPct: (pct: number) => void;
  setAlertPopupDuration: (duration: string) => void;
  setCesiumImageryMode: (mode: "dark" | "satellite") => void;
  setCesiumQuality: (mode: "balanced" | "high") => void;
  setCesiumBuildingsEnabled: (enabled: boolean) => void;
  setTerrainExaggeration: (value: number) => void;
  setShowPathLabels: (show: boolean) => void;
  setShowCameraTriggers: (show: boolean) => void;
  setRoundedTurnsPreview: (show: boolean) => void;
  setAutoFollowOnPlay: (enabled: boolean) => void;
  markChangelogSeen: (ids: string[]) => void;
  clearSeenChangelog: () => void;
  setChangelogNotificationsEnabled: (enabled: boolean) => void;
  setAutoRecordOnConnect: (enabled: boolean) => void;
  setAutoRecordOnArm: (enabled: boolean) => void;
  setShowNoFlyZones: (show: boolean) => void;
  /** Set the no-fly dataset region, or null to clear it. */
  setNoFlyRegion: (region: string | null) => void;
  setOfflineTileCaching: (enabled: boolean) => void;
  saveParamFilterPreset: (preset: ParameterFilterPreset) => void;
  removeParamFilterPreset: (id: string) => void;
  setGuidanceHdgLength: (v: number) => void;
  setGuidanceHdgWidth: (v: number) => void;
  setGuidanceHdgLineType: (v: GuidanceLineType) => void;
  setGuidanceHdgColor: (v: string) => void;
  setGuidanceTrackWpLength: (v: number) => void;
  setGuidanceTrackWpWidth: (v: number) => void;
  setGuidanceTrackWpLineType: (v: GuidanceLineType) => void;
  setGuidanceTrackWpColor: (v: string) => void;
  setGuidanceTgtHdgLength: (v: number) => void;
  setGuidanceTgtHdgWidth: (v: number) => void;
  setGuidanceTgtHdgLineType: (v: GuidanceLineType) => void;
  setGuidanceTgtHdgColor: (v: string) => void;
  setGuidanceHdgEnabled: (v: boolean) => void;
  setGuidanceTrackWpEnabled: (v: boolean) => void;
  setGuidanceTgtHdgEnabled: (v: boolean) => void;
  setTelemetryDeckActivePage: (page: TelemetryDeckPageId) => void;
  setTelemetryDeckPageMetrics: (
    page: TelemetryDeckPageId,
    metrics: TelemetryDeckMetricId[],
  ) => void;
  toggleTelemetryDeckPageMetric: (
    page: TelemetryDeckPageId,
    metric: TelemetryDeckMetricId,
  ) => void;
  moveTelemetryDeckMetric: (
    page: TelemetryDeckPageId,
    fromIndex: number,
    toIndex: number,
  ) => void;
  resetGuidanceDefaults: () => void;
  setLocale: (locale: string) => void;
  setThemeMode: (mode: ThemeMode) => void;
  setAccentColor: (accent: AccentColor) => void;
  setPushThemeToAgents: (enabled: boolean) => void;

  // network actions
  setAutoReconnect: (enabled: boolean) => void;
  setAutoConnectOnLoad: (enabled: boolean) => void;
  setLocationEnabled: (enabled: boolean) => void;

  // command-tab actions
  setLastActivePanel: (panelId: string) => void;
  setPanelScrollPosition: (panelId: string, scrollTop: number) => void;

  // video actions
  setVideoWhepUrl: (url: string) => void;
  setVideoTransportMode: (
    mode: "auto" | "lan-whep" | "p2p-mqtt" | "off",
  ) => void;
  setHudAutoClaimPicOnFirstButton: (enabled: boolean) => void;

  // keybindings / hotbar actions
  setActiveLoadout: (id: string) => void;
  bindSkillToSlot: (
    loadoutId: string,
    index: number,
    skillId: string | null,
  ) => void;
  setSlotKey: (loadoutId: string, index: number, key: string | null) => void;
  setSlotGamepadButton: (
    loadoutId: string,
    index: number,
    button: number | null,
  ) => void;
  createLoadout: (name: string, fromId?: string) => string;
  deleteLoadout: (id: string) => void;
  renameLoadout: (id: string, name: string) => void;
  /** Reset one loadout's slots to the factory bindings (keeps id, name, layout). */
  resetLoadoutToDefaults: (loadoutId: string) => void;
  /** Offer a plugin skill's suggested binding to a loadout, once per skill. */
  seedSuggestedBinding: (
    loadoutId: string,
    skillId: string,
    binding: SuggestedBinding,
  ) => void;
  setLoadoutLayout: (
    loadoutId: string,
    partial: Partial<CockpitLayout>,
  ) => void;
  setLoadoutWidget: (
    loadoutId: string,
    widgetId: string,
    partial: CockpitWidgetPlacement,
  ) => void;

}

/**
 * Slice action-factory signature shared by every settings slice file. Each
 * factory receives the full `set`/`get` so cross-slice reads keep working.
 */
export type SettingsSliceFactory<TActions> = (
  set: (
    partial:
      | Partial<SettingsStoreState>
      | ((s: SettingsStoreState) => Partial<SettingsStoreState>),
  ) => void,
  get: () => SettingsStoreState,
) => TActions;
