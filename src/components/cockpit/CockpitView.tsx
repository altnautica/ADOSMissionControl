/**
 * The cockpit: the flight screen, a drone's "Cockpit" node-detail tab shown
 * over the whole viewport. It is the cockpit spec's grid (`layout.json`):
 *
 *   top bar          chip · status pill · battery · link · nav source ·
 *                    controller · data layers · Menu · STOP
 *   left column      Take off / Land, Return home, Pause
 *   right column     shutter, photo / video, zoom, camera settings
 *   bottom-left card map / attitude radar / obstacle radar
 *   bottom row       D · H · H.S · V.S · AGL
 *   bottom-right     skills chip
 *   centre           clean video, data layers and the centre marks; the
 *                    flight instruments only at the Instruments level
 *
 * Every zone is placed from one measured grid (`flight/flight-grid`), so no
 * two zones overlap at any width class, and the screen draws no status band,
 * telemetry strip, navigation rail or hint bar (`legacy_chrome: none`).
 * Navigation and everything not flight-critical sit behind the Menu.
 *
 * Back to front: video and data layers (0), the centre HUD (15), widget
 * zones (20), PiP and card (25), columns and docks (30), top bar (40),
 * banners and alerts (45), sheets (50).
 *
 * This renders INSIDE CommandShell, so the agent/video/telemetry bridges, the
 * skill registry and the confirm host are already mounted shell-wide. The root
 * subscribes only to layout and input-mode state; telemetry, recording time and
 * video health are read by the leaf components that show them, so a live
 * stream never re-renders the root.
 *
 * @module cockpit/CockpitView
 * @license GPL-3.0-only
 */

"use client";

import { useCallback, useMemo, useRef } from "react";
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
import { LeftColumn } from "@/components/cockpit/v2/LeftColumn";
import { SkillPicker } from "@/components/cockpit/v2/SkillPicker";
import { usePilotState } from "@/lib/cockpit/use-pilot-state";
import { useCockpitView, viewDef } from "@/lib/cockpit/views";
import { CockpitMapPane } from "@/components/cockpit/v2/CockpitMapPane";
import { VisionViewPanel } from "@/components/cockpit/layers/VisionViewPanel";
import { FlightFlowOverlays } from "@/components/cockpit/v2/FlightFlowOverlays";
import { OnScreenSticks } from "@/components/cockpit/v2/OnScreenSticks";
import { useDs4Dispatcher } from "@/hooks/use-ds4-dispatcher";
import { notifySkill } from "@/lib/skills/registry";
import { CockpitAlerts } from "@/components/cockpit/CockpitAlerts";
import { CockpitVideoStatusBanner } from "@/components/cockpit/CockpitVideoStatusBanner";
import { CockpitDemoStream } from "@/components/cockpit/CockpitDemoStream";
import { CockpitPipInset } from "@/components/cockpit/CockpitPipInset";
import { HudLayer } from "@/components/cockpit/HudLayer";
import { FlightTopBar } from "@/components/cockpit/flight/FlightTopBar";
import { RightColumn } from "@/components/cockpit/flight/RightColumn";
import { BottomRow } from "@/components/cockpit/flight/BottomRow";
import { BottomLeftCard } from "@/components/cockpit/flight/BottomLeftCard";
import { FollowDock } from "@/components/cockpit/flight/FollowDock";
import {
  FlightFrame,
  FlightMapFrame,
  FlightVideoFrame,
  ZoneBox,
} from "@/components/cockpit/flight/FlightFrame";
import {
  CockpitLayoutContext,
  useCockpitContainerLayout,
} from "@/hooks/use-cockpit-width-class";
import { DEFAULT_DENSITY } from "@/lib/cockpit/density";
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

interface CockpitViewProps {
  /** The drone this cockpit flies (the node whose tab this is). */
  droneId: string;
}

export function CockpitView({ droneId }: CockpitViewProps) {
  const t = useTranslations("skillBindings");
  const tFly = useTranslations("flyCockpit");
  const containerRef = useRef<HTMLDivElement>(null);
  const { pilot } = usePilotState(droneId);
  const view = useCockpitView(droneId);
  const viewMeta = viewDef(view);
  const notifyToast = useCallback((msg: string) => notifySkill(msg, "warning"), []);

  // Width class + size from the cockpit container (never the viewport).
  const layoutSize = useCockpitContainerLayout(containerRef);
  // The served camera the main video shows: the layer stack draws for it.
  const layerCamera = useVideoStreamsStore(
    (s) => s.activeStreamIdByDrone[droneId] ?? s.streamsByDrone[droneId]?.[0]?.id ?? PRIMARY_CAMERA_ID,
  );

  // The skill / game layer (left column, skills chip, editor); on by default.
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

  // Widget visibility and density, read from the active loadout.
  const loadoutLayout = useSettingsStore(
    (s) => (s.loadouts[s.activeLoadoutId] ?? s.loadouts[DEFAULT_LOADOUT_ID])?.layout,
  );
  const layout = useMemo(
    () => loadoutLayout ?? cloneDefaultCockpitLayout(),
    [loadoutLayout],
  );
  const density = layout.density ?? DEFAULT_DENSITY;
  const closeEditor = useCallback(() => setEditing(false), [setEditing]);
  const closePalette = useCallback(() => setPaletteOpen(false), [setPaletteOpen]);

  // Every side effect of the surface (gamepad, focus, immersive request,
  // registrations, input surface, hotkeys, video streams, close-on-leave).
  useCockpitViewSetup(droneId, containerRef);
  // Controller buttons: the binding table in force, rumble and lightbar.
  useDs4Dispatcher(droneId);

  return (
    <CockpitLayoutContext.Provider value={layoutSize}>
      <FlightFrame
        droneId={droneId}
        containerRef={containerRef}
        size={layoutSize}
        view={view}
        sidePanel={viewMeta.sidePanel}
        density={density}
      >
        {/* Render-null registrars: extension flight skills (with their default
            bindings), extension target actions, extension cockpit widgets. */}
        <PluginSkillHost droneId={droneId} />
        <PluginTargetActionHost droneId={droneId} />
        <PluginCockpitWidgetHost droneId={droneId} />

        {/* Views (cockpit spec views.json): Pilot and Vision put the video
            main, Split puts the map beside it, Map puts the map main with the
            video in the bottom-left card. The video element is never remounted. */}
        {viewMeta.main === "map" || viewMeta.secondary === "map" ? (
          <FlightMapFrame main={viewMeta.main === "map"}>
            <CockpitMapPane droneId={droneId} className="absolute inset-0" />
          </FlightMapFrame>
        ) : null}
        <FlightVideoFrame droneId={droneId} view={view}>
          <VideoCanvas className="absolute inset-0" chrome="cockpit" droneId={droneId}>
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
        </FlightVideoFrame>
        {viewMeta.sidePanel && (
          <ZoneBox zone="side_panel" className="fs-panel pointer-events-auto z-30 overflow-y-auto">
            <VisionViewPanel droneId={droneId} />
          </ZoneBox>
        )}

        {/* The centre: centre marks at every level, instruments at Instruments. */}
        {viewMeta.main === "video" && <HudLayer droneId={droneId} />}
        {/* Registered cockpit widgets (extension widgets, the lock and
            perception chips), placed inside the centre zone. */}
        <CockpitZones droneId={droneId} layout={layout} />

        <FlightTopBar droneId={droneId} />
        <CockpitVideoStatusBanner droneId={droneId} />
        <CockpitAlerts droneId={droneId} />
        <CockpitPipInset droneId={droneId} />

        {cockpitEnabled && <LeftColumn droneId={droneId} />}
        <RightColumn droneId={droneId} />
        {viewMeta.main !== "map" && <BottomLeftCard droneId={droneId} />}
        <BottomRow droneId={droneId} />
        <FollowDock droneId={droneId} />

        {/* EDIT banner — the dispatcher is paused and the bindings are in edit mode. */}
        {cockpitEnabled && editing && (
          <div className="pointer-events-none absolute inset-x-0 z-40 flex justify-center" style={{ top: "var(--fs-top-y)" }}>
            <span className="fs-panel pointer-events-auto px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-accent-primary">
              {t("editBanner")}
            </span>
          </div>
        )}
        {cockpitEnabled && editing && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 z-50 flex justify-center">
            <SkillBarEditor onClose={closeEditor} />
          </div>
        )}

        {/* Bottom-right: the skills chip, or the re-enable prompt after an
            explicit opt-out. */}
        <ZoneBox zone="bottom_right" className="pointer-events-auto z-30 flex items-end justify-end">
          {cockpitEnabled ? (
            !editing && <SkillPicker droneId={droneId} pilot={pilot} notify={notifyToast} />
          ) : (
            <div className="fs-panel fs-enable" data-testid="fs-enable-skills">
              <h2 className="text-xs font-semibold">{tFly("enableTitle")}</h2>
              <p className="mt-1 text-[11px] leading-snug">{tFly("enableBody")}</p>
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
          )}
        </ZoneBox>

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
      </FlightFrame>
    </CockpitLayoutContext.Provider>
  );
}
