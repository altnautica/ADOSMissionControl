/**
 * The cockpit: a game-like piloting surface composed as a back-to-front layer
 * stack over the singleton video brain, rendered as the drone's "Cockpit"
 * node-detail tab.
 *
 *   L0  video            VideoCanvas (object-contain stream)
 *   L1  plugin overlay   the video.overlay slot
 *   L2  instrument HUD   registered cockpit widgets (attitude, tapes) via CockpitZones
 *   L3  cockpit chrome   CockpitTopBar (+ Immersive toggle + unified REC),
 *                        minimap PiP, ProximityRadar, TelemetryStrip, Skill Bar
 *
 * Unlike the old chromeless `/fly` route, this renders INSIDE CommandShell, so
 * the agent/video/telemetry bridges, the skill registry, and the confirm host
 * are already mounted shell-wide — this component does not re-mount them. The
 * "Immersive" control collapses the surrounding dashboard chrome in place
 * (CommandShell + NodeDetailPanel hide their chrome while `immersiveMode` is on);
 * Escape / the shell's floating exit button return to the embedded tab.
 *
 * Pointer-event discipline: the instrument HUD and read-only readouts are
 * pointer-events-none so a click falls through to the video; only the Skill
 * Bar, the minimap card, and the top-bar controls opt back to pointer-events-auto.
 *
 * @module fly/CockpitView
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

import { MinimapBasemapSelector } from "@/components/map/MinimapBasemapSelector";
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
import { PluginSkillHost } from "@/components/cockpit/PluginSkillHost";
import { SkillBar } from "@/components/cockpit/SkillBar";
import { SkillBarEditor } from "@/components/cockpit/SkillBarEditor";
import { CockpitCommandPalette } from "@/components/cockpit/CockpitCommandPalette";
import { CockpitQuickSettings } from "@/components/cockpit/CockpitQuickSettings";
import { CockpitTopBar } from "@/components/cockpit/CockpitTopBar";
import { SkillRadial } from "@/components/cockpit/SkillRadial";
import { CockpitTopRight } from "@/components/cockpit/CockpitTopRight";
import { CockpitStreamTabs } from "@/components/cockpit/CockpitStreamTabs";
import { CockpitDemoStream } from "@/components/cockpit/CockpitDemoStream";
import { CockpitPipInset } from "@/components/cockpit/CockpitPipInset";
import { DEFAULT_DENSITY } from "@/lib/cockpit/density";
import { zoneContainerClass } from "@/lib/cockpit/zones";

import { registerBuiltinTargetActions } from "@/lib/skills/target-actions";
import { useTargetActionHotkeys } from "@/hooks/use-target-action-hotkeys";
import { useFlightInputSurface } from "@/hooks/use-skill-input";
import { useCockpitInput } from "@/hooks/use-cockpit-input";
import { useFlightRecording } from "@/hooks/use-flight-recording";
import { useVideoStreams } from "@/hooks/use-video-streams";
import {
  startGamepadPolling,
  stopGamepadPolling,
  startManualControlStream,
} from "@/lib/input/gamepad-poller";
import { useUiStore } from "@/stores/ui-store";
import { useSkillConfirmStore } from "@/stores/skill-confirm-store";
import { useSkillInputStore } from "@/stores/skill-input-store";
import { useCockpitStore } from "@/stores/cockpit-store";
import { useSettingsStore } from "@/stores/settings-store";
import {
  DEFAULT_LOADOUT_ID,
  cloneDefaultCockpitLayout,
} from "@/stores/settings/keybindings-slice";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import {
  CircleDot,
  Command,
  Layers,
  Maximize2,
  Plane,
  Settings2,
  SlidersHorizontal,
  Square,
} from "lucide-react";
import { useFlyQuickSettingsStore } from "@/stores/fly-quick-settings-store";
import { cn, isDemoMode } from "@/lib/utils";

// The minimap is a Leaflet view: load it client-only so the cockpit renders on
// the server without pulling Leaflet into the SSR pass.
const OverviewMap = dynamic(
  () => import("@/components/flight/OverviewMap").then((m) => m.OverviewMap),
  {
    ssr: false,
    loading: () => <div className="w-full h-full bg-media" />,
  },
);

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

interface CockpitViewProps {
  /** The drone whose tab this is (equals the globally-selected drone). */
  droneId: string;
}

export function CockpitView({ droneId }: CockpitViewProps) {
  const t = useTranslations("skillBindings");
  const tFly = useTranslations("flyCockpit");
  const tCockpit = useTranslations("cockpit");
  const tPalette = useTranslations("commandPalette");
  const containerRef = useRef<HTMLDivElement>(null);

  const immersiveMode = useUiStore((s) => s.immersiveMode);
  const enterImmersiveMode = useUiStore((s) => s.enterImmersiveMode);
  const exitImmersiveMode = useUiStore((s) => s.exitImmersiveMode);

  // A pending skill-confirm modal owns input: pause the dispatcher and defer
  // Escape to the dialog's own onCancel while one is open.
  const confirmPending = useSkillConfirmStore((s) => s.pending !== null);

  // The skill / game layer (Skill Bar + editor + radial) is opt-in; default off.
  const cockpitEnabled = useCockpitStore((s) => s.enabled);

  // The editor and palette flags live in the skill-input store so the
  // shell-level dispatcher and every cockpit input handler see them.
  const editing = useSkillInputStore((s) => s.editorOpen);
  const setEditing = useSkillInputStore((s) => s.setEditorOpen);
  const paletteOpen = useSkillInputStore((s) => s.paletteOpen);
  const setPaletteOpen = useSkillInputStore((s) => s.setPaletteOpen);

  // The minimap basemap selector is collapsed behind a layers icon so it does
  // not cover the (enlarged) minimap; the icon reveals DARK / OSM / SAT / TOPO.
  const [basemapOpen, setBasemapOpen] = useState(false);

  const quickOpen = useFlyQuickSettingsStore((s) => s.isOpen);
  const quickFocusPluginId = useFlyQuickSettingsStore((s) => s.focusPluginId);
  const toggleQuick = useFlyQuickSettingsStore((s) => s.toggle);
  const closeQuick = useFlyQuickSettingsStore((s) => s.close);

  const recording = useFlightRecording(droneId);

  // Cockpit chrome layout, read from the active loadout.
  const activeLoadoutId = useSettingsStore((s) => s.activeLoadoutId);
  const loadouts = useSettingsStore((s) => s.loadouts);
  const setLoadoutLayout = useSettingsStore((s) => s.setLoadoutLayout);
  const layout =
    (loadouts[activeLoadoutId] ?? loadouts[DEFAULT_LOADOUT_ID])?.layout ??
    cloneDefaultCockpitLayout();
  // Information density lives in the loadout, so it persists with the active
  // preset (a saved mission preset restores its own density) instead of
  // resetting to standard on every remount.
  const density = layout.density ?? DEFAULT_DENSITY;

  // The cockpit is a flying surface, so it reads the gamepad and opens the
  // stick stream. The stream stays gated frame by frame regardless.
  useEffect(() => {
    startGamepadPolling();
    startManualControlStream();
    return () => {
      stopGamepadPolling();
    };
  }, []);

  // Focus the container on mount so window-level keyboard skills fire without a
  // click into the cockpit first.
  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  // Demo-mode synthetic detections: feed the vision-detections store so the L1
  // video overlay + follow-me journey light up with no agent attached.
  useEffect(() => {
    if (!isDemoMode() || !droneId) return;
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
  }, [droneId]);

  // Register the built-in target actions (Designate) once so the cockpit
  // target-overlay popup always has them. Idempotent.
  useEffect(() => {
    registerBuiltinTargetActions();
  }, []);

  // Register the built-in cockpit widgets (radar, telemetry strip, ...) into
  // the cockpit widget registry once, so a plugin or a new built-in adds a
  // cockpit surface by registering it rather than editing this component.
  useEffect(() => {
    registerBuiltinCockpitWidgets();
  }, []);

  // The live detection feed is opened by the always-mounted
  // VisionDetectionsBridge (resolves host + key local-first for the selected
  // drone), so the cockpit no longer dials it here — that path was gated on
  // useAgentConnectionStore.agentUrl, which is null for a LAN pairing.

  // The shell mounts the keyboard + gamepad skill dispatcher; registering this
  // surface wakes it. It stays dormant while a confirm modal, the binding
  // editor, the quick-settings drawer, the radial or the palette owns input.
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
  // apply the switch side effect, so the top-left stream switcher (below) works
  // on any multi-camera node. Renders nothing.
  useVideoStreams(droneId);

  // Leaving the skill layer while editing closes the editor + the drawer +
  // the command palette.
  useEffect(() => {
    if (!cockpitEnabled && editing) setEditing(false);
  }, [cockpitEnabled, editing, setEditing]);
  useEffect(() => {
    if (!cockpitEnabled && quickOpen) closeQuick();
  }, [cockpitEnabled, quickOpen, closeQuick]);

  // Palette, Escape, quick-settings, stream, PiP, D-pad and Start controls.
  useCockpitInput({ droneId, cockpitEnabled });

  const topBarControls = (
    <>
      <button
        type="button"
        onClick={recording.toggle}
        aria-label={recording.isRecording ? tCockpit("recStop") : tCockpit("rec")}
        title={recording.isRecording ? tCockpit("recStop") : tCockpit("recTitle")}
        className={cn(
          "flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide transition-colors",
          recording.isRecording
            ? "text-status-error"
            : "text-on-media/70 hover:text-on-media",
        )}
      >
        {recording.isRecording ? (
          <Square size={11} className="fill-current" />
        ) : (
          <CircleDot size={12} />
        )}
        {recording.isRecording ? formatDuration(recording.durationMs) : tCockpit("rec")}
      </button>
      {!immersiveMode && (
        <button
          type="button"
          onClick={enterImmersiveMode}
          aria-label={tCockpit("immersive")}
          title={tCockpit("immersiveTitle")}
          className="flex items-center gap-1 px-1.5 py-0.5 text-on-media/70 hover:text-on-media transition-colors"
        >
          <Maximize2 size={12} />
        </button>
      )}
    </>
  );

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      data-density={density}
      className="ados-cockpit relative flex-1 min-h-0 overflow-hidden bg-media outline-none"
    >
      {/* Registers plugin-contributed flight skills for the active drone into
          the Skill Bar registry and seeds their default bindings. Renders null. */}
      <PluginSkillHost />

      {/* Registers plugin-contributed target actions (into the click popup). */}
      {droneId && <PluginTargetActionHost droneId={droneId} />}

      {/* L0 video + (as VideoCanvas children) L1 plugin overlay + the host-owned
          detection/target layers. The glass instrument HUD (attitude, tapes,
          FPM) is now composed from the widget registry via CockpitZones below. */}
      <VideoCanvas className="absolute inset-0 z-0" hideRecordButton droneId={droneId}>
        {/* Demo-only synthetic feed so switching visibly changes the picture in
            demo mode (no live WebRTC); self-gated, never on a real node. */}
        {droneId && <CockpitDemoStream droneId={droneId} />}
        {droneId && <VideoOverlayHost droneId={droneId} />}
        {/* Host-owned detection/target overlay: click a box to select + act. */}
        {droneId && <CockpitTargetOverlay droneId={droneId} />}
        {/* The lead reticle for a MOVING designated target: pushes an aim-ahead
            reticle into the shared mark store (drawn by CockpitMarkLayer). Self-
            gated — nothing for a still, lost, or unselected target. */}
        {droneId && <TargetLeadReticle droneId={droneId} />}
        {/* Composited mark layer: the active-target reticle + any source's
            marks, letterbox-correct, in one overlay (no per-plugin iframe). */}
        {droneId && <CockpitMarkLayer droneId={droneId} />}
      </VideoCanvas>

      {/* Registered cockpit widgets (radar, telemetry strip, ...), composed
          from the widget registry so a built-in or plugin adds one without
          editing this component. */}
      <CockpitZones droneId={droneId} layout={layout} />

      {/* L3 cockpit chrome. The safety band is ALWAYS on (arm / battery / GPS /
          link are never hidden); the "top bar" chrome toggle only drops its
          decorative wordmark + node label via `lean`. It also carries the
          record + immersive controls, so there is no separate controls cluster. */}
      <CockpitTopBar controls={topBarControls} lean={!layout.topBar} />

      {layout.minimap && (
        <div className="zone tl d-std pointer-events-auto">
          <div className="mmap panel">
            <div className="absolute inset-0">
              <OverviewMap compact />
            </div>
            {/* The minimap is a clean, non-interactive map; a click opens the
                full Flight tab (telemetry panel + interactive map). */}
            <button
              type="button"
              onClick={() => {
                exitImmersiveMode();
                useUiStore.getState().setPendingDetailTab("flight");
              }}
              title={tCockpit("openFlight")}
              aria-label={tCockpit("openFlight")}
              className="absolute inset-0 z-[1001] cursor-pointer transition-colors hover:bg-on-media/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-primary"
            />
            {/* Map-type selector collapsed behind a layers icon so it does not
                cover the minimap; click to reveal DARK / OSM / SAT / TOPO.
                Above the click overlay, stops clicks falling through to the
                Flight-tab switch. */}
            <div
              className="absolute top-1.5 left-1.5 z-[1002]"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setBasemapOpen((o) => !o)}
                aria-label={tCockpit("mapLayer")}
                aria-expanded={basemapOpen}
                title={tCockpit("mapLayer")}
                className="flex h-6 w-6 items-center justify-center rounded bg-bg-primary/70 text-on-media/80 backdrop-blur-sm transition-colors hover:text-on-media focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
              >
                <Layers size={13} aria-hidden="true" />
              </button>
              {basemapOpen && (
                <div className="absolute left-0 top-7">
                  <MinimapBasemapSelector className="rounded bg-bg-primary/85 p-0.5 backdrop-blur-sm" />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Top-left stream switcher: sleek 1..N tabs beside the minimap, shown
          only when the node exposes more than one video stream. Press 1..N or
          click a tab to toggle the main view. */}
      <div className="zone tls pointer-events-auto">
        <CockpitStreamTabs droneId={droneId} />
      </div>

      {/* Picture-in-picture inset: a second stream over the main video
          (toggle with P on a multi-stream node). Self-gates when no PiP set. */}
      {droneId && <CockpitPipInset droneId={droneId} />}

      {/* Top-right: density toggle + video stats + camera select. Writing
          density into the active loadout persists it with the preset. */}
      <div className="pointer-events-auto">
        <CockpitTopRight
          density={density}
          droneId={droneId}
          onDensity={(d) => setLoadoutLayout(activeLoadoutId, { density: d })}
        />
      </div>

      {/* EDIT banner — the dispatcher is paused and the bar is in binding-edit mode. */}
      {cockpitEnabled && editing && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex justify-center">
          <span className="pointer-events-auto mt-2 border border-accent-primary bg-bg-secondary/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-accent-primary backdrop-blur-sm">
            {t("editBanner")}
          </span>
        </div>
      )}

      {/* Bottom-center: the live Skill Bar with an edit affordance, or the
          binding editor while editing. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-30 flex justify-center">
        {cockpitEnabled && editing ? (
          <SkillBarEditor onClose={() => setEditing(false)} />
        ) : (
          <div className="pointer-events-auto flex items-end gap-2">
            <SkillBar />
            {cockpitEnabled && (
              <>
                <button
                  type="button"
                  onClick={() => setPaletteOpen(true)}
                  aria-label={tPalette("open")}
                  title={`${tPalette("open")} (Ctrl/⌘ K)`}
                  className="flex h-9 w-9 items-center justify-center self-center border border-border-default bg-bg-secondary/85 text-text-secondary backdrop-blur-sm transition-colors hover:border-accent-primary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
                >
                  <Command size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={toggleQuick}
                  aria-label={t("openQuickSettings")}
                  title={t("openQuickSettings")}
                  className="flex h-9 w-9 items-center justify-center self-center border border-border-default bg-bg-secondary/85 text-text-secondary backdrop-blur-sm transition-colors hover:border-accent-primary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
                >
                  <SlidersHorizontal size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  aria-label={t("editBar")}
                  className="flex h-9 w-9 items-center justify-center self-center border border-border-default bg-bg-secondary/85 text-text-secondary backdrop-blur-sm transition-colors hover:border-accent-primary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
                >
                  <Settings2 size={16} aria-hidden="true" />
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Re-enable-skills prompt. The skill layer is ON by default, so this is
          only reachable after an explicit opt-out — but it must still never
          sit over the boresight. It used to render as a centred card at
          `inset-0`, i.e. parked across the middle of the live video, which is
          the one region of a piloting surface that has to stay clear. It is
          now a strip in the bottom-left zone container, above the Skill Bar,
          leaving the video, HUD, tapes and stream switcher unobstructed. */}
      {!cockpitEnabled && (
        <div className={`${zoneContainerClass("bottom-left")} pointer-events-auto z-40`}>
          <div className="max-w-xs border border-border-default bg-bg-secondary/95 p-3 shadow-lg backdrop-blur-sm">
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
              onClick={() => useCockpitStore.getState().setEnabled(true)}
              className="mt-2"
            >
              {tFly("enableButton")}
            </Button>
          </div>
        </div>
      )}

      {/* Gamepad radial quick-select. */}
      <SkillRadial enabled={cockpitEnabled && !confirmPending && !editing} />

      {/* Quick-settings drawer (plugin parameters + the vision model picker). */}
      {cockpitEnabled && quickOpen && (
        <CockpitQuickSettings
          onClose={closeQuick}
          {...(quickFocusPluginId ? { focusPluginId: quickFocusPluginId } : {})}
        />
      )}

      {/* Command palette (Ctrl/⌘ K): a searchable list of every command
          available on this drone, firing through the shared skill pipeline.
          Not gated on the skill layer — it is how the feature is discovered. */}
      {paletteOpen && droneId && (
        <CockpitCommandPalette
          droneId={droneId}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </div>
  );
}
