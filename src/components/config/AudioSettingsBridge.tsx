"use client";

/**
 * Keeps the alert audio engine on the operator's saved sound settings: once
 * the settings store has hydrated and on every later change, so a reload
 * plays alerts at the saved volume (or not at all) without opening Settings.
 * Mounted once in the app shell; renders nothing.
 * @license GPL-3.0-only
 */

import { useEffect } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { audioEngine } from "@/lib/audio-engine";

/** Subscribe the engine to the store; returns the unsubscribe. */
export function bindAudioSettings(): () => void {
  const apply = () => {
    const s = useSettingsStore.getState();
    if (!s._hasHydrated) return;
    audioEngine.setEnabled(s.audioEnabled);
    audioEngine.setVolume(s.audioVolume);
  };
  apply();
  return useSettingsStore.subscribe((s, prev) => {
    if (
      s._hasHydrated !== prev._hasHydrated ||
      s.audioEnabled !== prev.audioEnabled ||
      s.audioVolume !== prev.audioVolume
    ) {
      apply();
    }
  });
}

export function AudioSettingsBridge(): null {
  useEffect(() => bindAudioSettings(), []);
  return null;
}
