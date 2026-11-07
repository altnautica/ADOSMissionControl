/**
 * The cockpit: a piloting surface composed as a back-to-front layer stack
 * over the singleton video brain, rendered as a drone's "Cockpit" node-detail
 * tab.
 *
 *   0   video            VideoCanvas (object-contain stream, cockpit chrome)
 *   10  extension overlay the video.overlay slot
 *   12  host marks       detection / target overlay + mark layer
 *   15  instrument HUD   HudLayer (horizon, tapes, heading) via CockpitZones
 *   20  widget zones     radar, telemetry strip, chips, extension widgets
 *   25  PiP              second stream inset
 *   30  Skill Bar        bound skills + palette / quick settings / editor
 *   40  safety band      CockpitTopBar (always on)
 *   41  video banner     PICTURE FROZEN under the band
 *   45  alert stack      CockpitAlerts
 *   50  sheets           quick settings, palette, confirm sheet (shell-wide)
 *
 * This renders INSIDE CommandShell, so the agent/video/telemetry bridges, the
 * skill registry and the confirm host are already mounted shell-wide. The root
 * subscribes only to layout and input-mode state; telemetry, recording time and
 * video health are read by the leaf components that show them, so a live
 * stream never re-renders the root.
 *
 * Pointer-event discipline: the instrument HUD and read-only readouts are
 * pointer-events-none so a click falls through to the video; only the Skill
 * Bar, the minimap, the PiP, the band controls and sheets take input.
 *
 * @module cockpit/CockpitView
 * @license GPL-3.0-only
 */

"use client";

import { useCallback, useMemo, useRef, type CSSProperties } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Plane } from "lucide-react";

import { VideoCanvas } from "@/components/flight/VideoCanvas";
import { CockpitZones } from "@/components/cockpit/CockpitZones";
import { VideoOverlayHost } from "@/components/cockpit/VideoOverlayHost";
import { LayerStack } from "@/components/cockpit/layers/LayerStack";
import { PRIMARY_CAMERA_ID } from "@/lib/agent/detection-demand";
import { useVideoStreamsStore } from "@/stores/video-streams-store";
import { PluginTargetActionHost } from "@/components/vision/PluginTargetActionHost";
import { PluginCockpitWidgetHost } from "@/components/plugins/PluginCockpitWidgetHost";
import { PluginSkillHost } from "@/components/cockpit/PluginSkillHost";
import { CockpitBarControls } from "@/components/cockpit/CockpitBarControls";
import { FlightStateChip } from "@/components/cockpit/v2/FlightStateChip";
import { LeftColumn } from "@/components/cockpit/v2/LeftColumn";
import { SkillPicker } from "@/components/cockpit/v2/SkillPicker";
import { usePilotState } from "@/lib/cockpit/use-pilot-state";
import { useCockpitView, viewDef, type CockpitViewId } from "@/lib/cockpit/views";
import { CockpitMapPane } from "@/components/cockpit/v2/CockpitMapPane";
import { CockpitTopActions } from "@/components/cockpit/v2/CockpitTopActions";
import { VisionViewPanel } from "@/components/cockpit/layers/VisionViewPanel";
import { FlightFlowOverlays } from "@/components/cockpit/v2/FlightFlowOverlays";
import { OnScreenSticks } from "@/components/cockpit/v2/OnScreenSticks";
import { useDs4Dispatcher } from "@/hooks/use-ds4-dispatcher";
import { notifySkill } from "@/lib/skills/registry";
import { CockpitTopBar } from "@/components/cockpit/CockpitTopBar";
import { CockpitAlerts } from "@/components/cockpit/CockpitAlerts";
import { CockpitVideoStatusBanner } from "@/components/cockpit/CockpitVideoStatusBanner";
import { CockpitTopRight } from "@/components/cockpit/CockpitTopRight";
import { CockpitStreamTabs } from "@/components/cockpit/CockpitStreamTabs";
import { CockpitDemoStream } from "@/components/cockpit/CockpitDemoStream";
import { CockpitPipInset } from "@/components/cockpit/CockpitPipInset";
import { CockpitMinimap } from "@/components/cockpit/CockpitMinimap";
import { FollowRangePanel } from "@/components/cockpit/FollowRangePanel";
import { FollowRail } from "@/components/cockpit/FollowRail";
import {
  CockpitLayoutContext,
  useCockpitContainerLayout,
  useSkillBarClearance,
} from "@/hooks/use-cockpit-width-class";
import { DEFAULT_DENSITY, type CockpitDensity } from "@/lib/cockpit/density";
import { zoneContainerClass } from "@/lib/cockpit/zones";
import { useCockpitViewSetup } from "@/hooks/use-cockpit-view-setup";

import { useSkillInputStore } from "@/stores/skill-input-store";
import { useCockpitStore } from "@/stores/cockpit-store";
import { useSettingsStore } from "@/stores/settings-store";
import {
  DEFAULT_LOADOUT_ID,
  cloneDefaultCockpitLayout,
} from "@/stores/settings/keybindings-slice";
import { Button } from "@/components/ui/button";
import { useFlyQuickSettingsStore } from "@/stores/fly-quick-settings-store";

// Sheets and editors are opened on demand; keep them out of the cockpit's
// first load.
const SkillBarEditor = dynamic(() =>
  import("@/components/cockpit/SkillBarEditor").then((m) => m.SkillBarEditor),
);
const CockpitQuickSettings = dynamic(() =>
  import("@/components/cockpit/CockpitQuickSettings").then((m) => m.CockpitQuickSettings),
);
const CockpitCommandPalette = dynamic(() =>
  import("@/components/cockpit/CockpitCommandPalette").then((m) => m.CockpitCommandPalette),
);

function enableSkillLayer(): void {
  useCockpitStore.getState().setEnabled(true);
}

/** The video pane's placement per view. */
const VIDEO_CLASS: Record<CockpitViewId, string> = {
  pilot: "absolute inset-0 z-0",
  vision: "absolute inset-y-0 left-0 right-[min(340px,40%)] z-0",
  split: "absolute inset-y-0 left-0 z-0 w-1/2",
  map: "absolute bottom-24 left-3 z-[25] aspect-video w-[min(320px,40%)] overflow-hidden rounded-lg border border-white/20 shadow-lg",
};

interface CockpitViewProps {
  /** The drone this cockpit flies (the node whose tab this is). */
  droneId: string;
}

export function CockpitView({ droneId }: CockpitViewProps) {
  const t = useTranslations("skillBindings");
  const tFly = useTranslations("flyCockpit");
  const containerRef = useRef<HTMLDivElement>(null);
  const skillBarRef = useRef<HTMLDivElement>(null);
  const { pilot } = usePilotState(droneId);
  const view = useCockpitView(droneId);
  const viewMeta = viewDef(view);
  const notifyToast = useCallback((msg: string) => notifySkill(msg, "warning"), []);

  // Width class + size from the cockpit container (never the viewport), and
  // the measured Skill Bar clearance the range panel sits above.
  const layoutSize = useCockpitContainerLayout(containerRef);
  const skillBarClear = useSkillBarClearance(skillBarRef);
  // The served camera the main video shows: the layer stack draws for it.
  const layerCamera = useVideoStreamsStore(
    (s) => s.activeStreamIdByDrone[droneId] ?? s.streamsByDrone[droneId]?.[0]?.id ?? PRIMARY_CAMERA_ID,
  );


  // The skill / game layer (Skill Bar + editor + radial); on by default.
  const cockpitEnabled = useCockpitStore((s) => s.enabled);

  // The editor and palette flags live in the skill-input store so the
  // shell-level dispatcher and every cockpit input handler see them.
  const editing = useSkillInputStore((s) => s.editorOpen);
  const setEditing = useSkillInputStore((s) => s.setEditorOpen);
  const paletteOpen = useSkillInputStore((s) => s.paletteOpen);
  const setPaletteOpen = useSkillInputStore((s) => s.setPaletteOpen);

  const quickOpen = useFlyQuickSettingsStore((s) => s.isOpen);
  const quickFocusPluginId = useFlyQuickSettingsStore((s) => s.focusPluginId);
  const closeQuick = useFlyQuickSettingsStore((s) => s.close);

  // Cockpit chrome layout, read from the active loadout.
  const activeLoadoutId = useSettingsStore((s) => s.activeLoadoutId);
  const loadoutLayout = useSettingsStore(
    (s) => (s.loadouts[s.activeLoadoutId] ?? s.loadouts[DEFAULT_LOADOUT_ID])?.layout,
  );
  const setLoadoutLayout = useSettingsStore((s) => s.setLoadoutLayout);
  const layout = useMemo(
    () => loadoutLayout ?? cloneDefaultCockpitLayout(),
    [loadoutLayout],
  );
  // Information density lives in the loadout, so it persists with the active
  // preset instead of resetting on every remount.
  const density = layout.density ?? DEFAULT_DENSITY;
  const onDensity = useCallback(
    (d: CockpitDensity) => setLoadoutLayout(activeLoadoutId, { density: d }),
    [setLoadoutLayout, activeLoadoutId],
  );
  const closeEditor = useCallback(() => setEditing(false), [setEditing]);
  const closePalette = useCallback(() => setPaletteOpen(false), [setPaletteOpen]);

  // Every side effect of the surface (gamepad, focus, immersive request,
  // registrations, input surface, hotkeys, video streams, close-on-leave).
  useCockpitViewSetup(droneId, containerRef);
  // Controller buttons: the binding table in force, rumble and lightbar.
  useDs4Dispatcher(droneId);

  return (
    <CockpitLayoutContext.Provider value={layoutSize}>
      <div
        ref={containerRef}
        tabIndex={0}
        data-density={density}
        data-width-class={layoutSize.widthClass}
        style={{ "--skillbar-clear": `${skillBarClear}px` } as CSSProperties}
        className="ados-cockpit relative flex-1 min-h-0 overflow-hidden bg-media outline-none"
      >
        {/* Render-null registrars: extension flight skills (with their default
            bindings), extension target actions, extension cockpit widgets. */}
        <PluginSkillHost droneId={droneId} />
        <PluginTargetActionHost droneId={droneId} />
        <PluginCockpitWidgetHost droneId={droneId} />

        {/* Views (cockpit spec views.json): Pilot and Vision put the video
            main, Split puts the map beside it, Map puts the map main with the
            video as a PiP. The video element is never remounted. */}
        {viewMeta.main === "map" || viewMeta.secondary === "map" ? (
          <CockpitMapPane
            droneId={droneId}
            className={
              viewMeta.main === "map"
                ? "absolute inset-0 z-0"
                : "absolute inset-y-0 right-0 z-0 w-1/2 border-l-2 border-white/30"
            }
          />
        ) : null}
        <VideoCanvas className={VIDEO_CLASS[view]} chrome="cockpit" droneId={droneId}>
          {/* Demo-only synthetic feed so switching visibly changes the picture in
              demo mode; self-gated, never on a real node. */}
          <CockpitDemoStream droneId={droneId} />
          <VideoOverlayHost droneId={droneId} />
          {/* Every data layer (targets, marks, AR, obstacles, depth, surfaces)
              in one canvas, with the target click areas. The PiP never draws
              layers. */}
          {viewMeta.main === "video" && (
            <LayerStack droneId={droneId} cameraId={layerCamera} view={view} />
          )}
        </VideoCanvas>
        {viewMeta.sidePanel && (
          <aside className="pointer-events-auto absolute inset-y-0 right-0 z-30 w-[min(340px,40%)] overflow-y-auto border-l border-white/10 bg-bg-primary/90 pt-14 backdrop-blur-sm">
            <VisionViewPanel droneId={droneId} />
          </aside>
        )}

        {/* Registered cockpit widgets: the instrument HUD, radar, telemetry
            strip, chips and extension widgets. */}
        <CockpitZones droneId={droneId} layout={layout} />

        {/* The safety band is always on; the "top bar" layout toggle only drops
            its decorative wordmark. */}
        <CockpitTopBar droneId={droneId} lean={!layout.topBar} />
        <CockpitVideoStatusBanner droneId={droneId} />
        <CockpitAlerts droneId={droneId} />

        {layout.minimap && <CockpitMinimap droneId={droneId} />}

        {/* Stream switcher under the band, shown only for a multi-stream node. */}
        <div className="zone tls pointer-events-auto">
          <CockpitStreamTabs droneId={droneId} />
        </div>

        <CockpitPipInset droneId={droneId} />

        {/* Following-mode chrome: the read-only range panel (instrument layer)
            and the right rail (widget layer). Both self-gate on following mode. */}
        <FollowRangePanel droneId={droneId} />
        <FollowRail droneId={droneId} />

        <div className="pointer-events-auto">
          <CockpitTopRight density={density} droneId={droneId} onDensity={onDensity} />
        </div>

        {/* EDIT banner — the dispatcher is paused and the bar is in binding-edit mode. */}
        {cockpitEnabled && editing && (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex justify-center">
            <span className="glass-pill pointer-events-auto mt-2 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-accent-primary">
              {t("editBanner")}
            </span>
          </div>
        )}

        {/* Cockpit grid (shared spec layout.json): the flight-state chip top-left,
            the left column centred, the skill picker bottom-right. The
            loadout editor (keyboard / gamepad bindings) shows only while
            editing; there is no visible skill bar. */}
        <div className="pointer-events-auto absolute left-3 top-14 z-40 flex flex-wrap items-start gap-2">
          <FlightStateChip droneId={droneId} />
          <CockpitTopActions droneId={droneId} />
        </div>
        {cockpitEnabled && <LeftColumn droneId={droneId} />}
        <div
          ref={skillBarRef}
          className="pointer-events-none absolute inset-x-0 bottom-3 z-30 flex justify-center"
        >
          {cockpitEnabled && editing && <SkillBarEditor onClose={closeEditor} />}
        </div>
        {cockpitEnabled && !editing && (
          <div className="pointer-events-auto absolute bottom-3 right-3 z-30 flex items-end gap-2">
            <CockpitBarControls />
            <SkillPicker droneId={droneId} pilot={pilot} notify={notifyToast} />
          </div>
        )}

        {/* Re-enable-skills prompt, reachable only after an explicit opt-out. It
            sits in the bottom-left zone so it never covers the boresight. */}
        {!cockpitEnabled && (
          <div className={`${zoneContainerClass("bottom-left")} pointer-events-auto z-40`}>
            <div className="glass-panel max-w-xs p-3">
              <h2 className="text-xs font-semibold text-text-primary">
                {tFly("enableTitle")}
              </h2>
              <p className="mt-1 text-[11px] leading-snug text-text-secondary">
                {tFly("enableBody")}
              </p>
              <Button
                variant="primary"
                size="sm"
                icon={<Plane size={12} aria-hidden="true" />}
                onClick={enableSkillLayer}
                className="mt-2"
              >
                {tFly("enableButton")}
              </Button>
            </div>
          </div>
        )}

        {/* Flight-flow chrome the pilot drives (handover banner, centre-sticks
            ring, sticks-with take over, countdowns, voice) and the optional
            on-screen sticks. */}
        <FlightFlowOverlays droneId={droneId} pilot={pilot} />
        <OnScreenSticks droneId={droneId} />

        {/* Quick settings (extension parameters + the vision model picker). */}
        {cockpitEnabled && quickOpen && (
          <CockpitQuickSettings
            droneId={droneId}
            onClose={closeQuick}
            {...(quickFocusPluginId ? { focusPluginId: quickFocusPluginId } : {})}
          />
        )}

        {/* Command palette (Ctrl/⌘ K): every command available on this drone,
            firing through the shared skill pipeline. Not gated on the skill
            layer — it is how the feature is discovered. */}
        {paletteOpen && (
          <CockpitCommandPalette droneId={droneId} onClose={closePalette} />
        )}
      </div>
    </CockpitLayoutContext.Provider>
  );
}
