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

import { useCallback, useEffect, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Plane } from "lucide-react";

import { VideoCanvas } from "@/components/flight/VideoCanvas";
import {
  CockpitZones,
  registerBuiltinCockpitWidgets,
} from "@/components/cockpit/CockpitZones";
import { VideoOverlayHost } from "@/components/cockpit/VideoOverlayHost";
import { CockpitTargetOverlay } from "@/components/vision/CockpitTargetOverlay";
import { CockpitMarkLayer } from "@/components/vision/CockpitMarkLayer";
import { TargetLeadReticle } from "@/components/vision/TargetLeadReticle";
import { PluginTargetActionHost } from "@/components/vision/PluginTargetActionHost";
import { PluginCockpitWidgetHost } from "@/components/plugins/PluginCockpitWidgetHost";
import { PluginSkillHost } from "@/components/cockpit/PluginSkillHost";
import { SkillBar } from "@/components/cockpit/SkillBar";
import { CockpitBarControls } from "@/components/cockpit/CockpitBarControls";
import { CockpitTopBar } from "@/components/cockpit/CockpitTopBar";
import { CockpitAlerts } from "@/components/cockpit/CockpitAlerts";
import { CockpitVideoStatusBanner } from "@/components/cockpit/CockpitVideoStatusBanner";
import { CockpitTopRight } from "@/components/cockpit/CockpitTopRight";
import { CockpitStreamTabs } from "@/components/cockpit/CockpitStreamTabs";
import { CockpitDemoStream } from "@/components/cockpit/CockpitDemoStream";
import { CockpitPipInset } from "@/components/cockpit/CockpitPipInset";
import { CockpitMinimap } from "@/components/cockpit/CockpitMinimap";
import { DEFAULT_DENSITY, type CockpitDensity } from "@/lib/cockpit/density";
import { zoneContainerClass } from "@/lib/cockpit/zones";

import { registerBuiltinTargetActions } from "@/lib/skills/target-actions";
import { useTargetActionHotkeys } from "@/hooks/use-target-action-hotkeys";
import { useFlightInputSurface } from "@/hooks/use-skill-input";
import { useCockpitInput } from "@/hooks/use-cockpit-input";
import { useVideoStreams } from "@/hooks/use-video-streams";
import { useDemoMode } from "@/hooks/use-demo-mode";
import {
  acquireGamepadPolling,
  startManualControlStream,
  stopManualControlStream,
} from "@/lib/input/gamepad-poller";
import { useSkillConfirmStore } from "@/stores/skill-confirm-store";
import { useSkillInputStore } from "@/stores/skill-input-store";
import { useCockpitStore } from "@/stores/cockpit-store";
import { useSettingsStore } from "@/stores/settings-store";
import {
  DEFAULT_LOADOUT_ID,
  cloneDefaultCockpitLayout,
} from "@/stores/settings/keybindings-slice";
import { Button } from "@/components/ui/button";
import { useFlyQuickSettingsStore } from "@/stores/fly-quick-settings-store";
import { useUiStore } from "@/stores/ui-store";
import {
  consumeImmersiveRequest,
  onImmersiveRequest,
} from "@/lib/cockpit/immersive-request";

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
const SkillRadial = dynamic(() =>
  import("@/components/cockpit/SkillRadial").then((m) => m.SkillRadial),
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
  const demo = useDemoMode();

  // A pending skill confirm owns input: pause the radial while one is open.
  const confirmPending = useSkillConfirmStore((s) => s.pending !== null);

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

  // The cockpit is a flying surface, so it holds the gamepad and opens the
  // stick stream (gated frame by frame on the stick-control switch). Leaving
  // the cockpit always stops the stick stream, even while another surface
  // still holds the gamepad: no surface on screen flies the vehicle.
  useEffect(() => {
    const release = acquireGamepadPolling();
    startManualControlStream();
    return () => {
      stopManualControlStream();
      release();
    };
  }, []);

  // Focus the container on mount so window-level keyboard skills fire without a
  // click into the cockpit first.
  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  // "Open cockpit" from the node header: go immersive once this tab shows.
  useEffect(() => {
    const honour = () => {
      if (consumeImmersiveRequest()) useUiStore.getState().enterImmersiveMode();
    };
    honour();
    return onImmersiveRequest(honour);
  }, []);

  // Demo-mode synthetic detections: feed the vision-detections store so the
  // video overlay + follow-me journey light up with no agent attached.
  useEffect(() => {
    if (!demo || !droneId) return;
    let active = true;
    let stream: { start: (id: string) => void; stop: () => void } | undefined;
    import("@/mock/mock-detections").then((mod) => {
      if (!active) return;
      stream = mod.mockDetectionStream;
      stream.start(droneId);
    });
    return () => {
      active = false;
      stream?.stop();
    };
  }, [demo, droneId]);

  // Built-in target actions and cockpit widgets register once (idempotent), so
  // an extension or a new built-in adds a surface by registering it.
  useEffect(() => {
    registerBuiltinTargetActions();
    registerBuiltinCockpitWidgets();
  }, []);

  // The shell mounts the keyboard + gamepad skill dispatcher; registering this
  // surface wakes it. It stays dormant while a confirm sheet, the binding
  // editor, quick settings, the radial or the palette owns input.
  useFlightInputSurface();

  // The editor and palette are this surface's: close them when it unmounts so
  // a stale flag never pauses the dispatcher on another surface.
  useEffect(
    () => () => {
      const input = useSkillInputStore.getState();
      input.setEditorOpen(false);
      input.setPaletteOpen(false);
    },
    [],
  );

  // Target-action hotkeys: fire an action on the selected detection by its key
  // (preempts a Skill Bar binding only while a target is selected).
  useTargetActionHotkeys({
    enabled: !confirmPending && !editing && !quickOpen && !paletteOpen,
  });

  // Populate the per-drone video streams store from the node's cameras and
  // apply the switch side effect. Renders nothing.
  useVideoStreams(droneId);

  // Leaving the skill layer closes the editor and quick settings.
  useEffect(() => {
    if (!cockpitEnabled && editing) setEditing(false);
  }, [cockpitEnabled, editing, setEditing]);
  useEffect(() => {
    if (!cockpitEnabled && quickOpen) closeQuick();
  }, [cockpitEnabled, quickOpen, closeQuick]);

  // Palette, Escape, quick-settings, stream, PiP, D-pad and Start controls.
  useCockpitInput({ droneId, cockpitEnabled });

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      data-density={density}
      className="ados-cockpit relative flex-1 min-h-0 overflow-hidden bg-media outline-none"
    >
      {/* Render-null registrars: extension flight skills (with their default
          bindings), extension target actions, extension cockpit widgets. */}
      <PluginSkillHost droneId={droneId} />
      <PluginTargetActionHost droneId={droneId} />
      <PluginCockpitWidgetHost droneId={droneId} />

      <VideoCanvas className="absolute inset-0 z-0" chrome="cockpit" droneId={droneId}>
        {/* Demo-only synthetic feed so switching visibly changes the picture in
            demo mode; self-gated, never on a real node. */}
        <CockpitDemoStream droneId={droneId} />
        <VideoOverlayHost droneId={droneId} />
        {/* Host-owned detection/target overlay: click a box to select + act. */}
        <CockpitTargetOverlay droneId={droneId} />
        {/* Aim-ahead reticle for a moving designated target (self-gated). */}
        <TargetLeadReticle droneId={droneId} />
        {/* The active-target reticle + every source's marks, letterbox-correct. */}
        <CockpitMarkLayer droneId={droneId} />
      </VideoCanvas>

      {/* Registered cockpit widgets: the instrument HUD, radar, telemetry
          strip, chips and extension widgets. */}
      <CockpitZones droneId={droneId} layout={layout} />

      {/* The safety band is always on; the "top bar" layout toggle only drops
          its decorative wordmark. */}
      <CockpitTopBar droneId={droneId} lean={!layout.topBar} />
      <CockpitVideoStatusBanner droneId={droneId} />
      <CockpitAlerts droneId={droneId} />

      {layout.minimap && <CockpitMinimap />}

      {/* Stream switcher under the band, shown only for a multi-stream node. */}
      <div className="zone tls pointer-events-auto">
        <CockpitStreamTabs droneId={droneId} />
      </div>

      <CockpitPipInset droneId={droneId} />

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

      {/* Bottom-center: the live Skill Bar with its side controls, or the
          binding editor while editing. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-30 flex justify-center">
        {cockpitEnabled && editing ? (
          <SkillBarEditor onClose={closeEditor} />
        ) : (
          <div className="pointer-events-auto flex items-end gap-2">
            <SkillBar droneId={droneId} />
            {cockpitEnabled && <CockpitBarControls />}
          </div>
        )}
      </div>

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

      {/* Gamepad radial quick-select. */}
      {cockpitEnabled && (
        <SkillRadial enabled={!confirmPending && !editing} />
      )}

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
  );
}
