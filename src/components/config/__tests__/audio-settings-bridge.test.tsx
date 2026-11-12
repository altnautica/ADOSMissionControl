/**
 * @license GPL-3.0-only
 *
 * The alert engine takes the saved volume and on/off state after hydration,
 * not only when the Notifications slider moves.
 */

import { describe, it, expect } from "vitest";
import { bindAudioSettings } from "../AudioSettingsBridge";
import { useSettingsStore } from "@/stores/settings-store";
import { audioEngine } from "@/lib/audio-engine";

describe("bindAudioSettings", () => {
  it("waits for hydration, then follows every change", () => {
    useSettingsStore.setState({ _hasHydrated: false, audioVolume: 0.2, audioEnabled: false });
    audioEngine.setVolume(0.7);
    audioEngine.setEnabled(true);
    const unbind = bindAudioSettings();
    expect(audioEngine.getVolume()).toBeCloseTo(0.7);

    useSettingsStore.setState({ _hasHydrated: true });
    expect(audioEngine.getVolume()).toBeCloseTo(0.2);
    expect(audioEngine.getEnabled()).toBe(false);

    useSettingsStore.setState({ audioVolume: 0.9, audioEnabled: true });
    expect(audioEngine.getVolume()).toBeCloseTo(0.9);
    expect(audioEngine.getEnabled()).toBe(true);
    unbind();
  });
});
