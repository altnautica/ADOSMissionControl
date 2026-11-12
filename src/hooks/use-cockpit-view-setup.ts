"use client";

/**
 * @module use-cockpit-view-setup
 * @description The cockpit surface's side effects, kept out of the
 * `CockpitView` render: gamepad + stick stream ownership, initial focus, the
 * immersive request, demo detections, built-in registrations, the input
 * surface and hotkeys, the video streams store, and closing the editor /
 * palette / quick settings when the skill layer or the surface goes away.
 * Renders nothing; subscribes only to input-mode state.
 *
 * @license GPL-3.0-only
 */

import { useEffect, type RefObject } from "react";

import { registerBuiltinCockpitWidgets } from "@/components/cockpit/CockpitZones";
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
import { useFlyQuickSettingsStore } from "@/stores/fly-quick-settings-store";

export function useCockpitViewSetup(
  droneId: string,
  containerRef: RefObject<HTMLDivElement | null>,
): void {
  const demo = useDemoMode();
  const confirmPending = useSkillConfirmStore((s) => s.pending !== null);
  const cockpitEnabled = useCockpitStore((s) => s.enabled);
  const editing = useSkillInputStore((s) => s.editorOpen);
  const setEditing = useSkillInputStore((s) => s.setEditorOpen);
  const paletteOpen = useSkillInputStore((s) => s.paletteOpen);
  const quickOpen = useFlyQuickSettingsStore((s) => s.isOpen);
  const closeQuick = useFlyQuickSettingsStore((s) => s.close);

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
  }, [containerRef]);

  // Demo-mode synthetic detections: feed the vision-detections store so the
  // video overlay + follow-me journey light up with no agent attached.
  useEffect(() => {
    if (!demo || !droneId) return;
    let active = true;
    let stream: { start: (id: string) => void; stop: () => void } | undefined;
    // Demo-only module: loaded on demand so it never ships in a real session.
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
}
