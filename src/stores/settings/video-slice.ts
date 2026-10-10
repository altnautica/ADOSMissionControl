/**
 * Video slice for the persisted settings store. Owns video-transport
 * preferences: WHEP endpoint URL and transport mode (auto / lan-whep /
 * p2p-mqtt / off).
 *
 * @license GPL-3.0-only
 */

import type { SettingsSliceFactory, SettingsStoreState } from "./types";

export const videoDefaults: Partial<SettingsStoreState> = {
  videoWhepUrl: "",
  videoTransportMode: "auto",
};

export const createVideoActions: SettingsSliceFactory<
  Pick<SettingsStoreState, "setVideoWhepUrl" | "setVideoTransportMode">
> = (set) => ({
  setVideoWhepUrl: (videoWhepUrl) => set({ videoWhepUrl }),
  setVideoTransportMode: (videoTransportMode) => set({ videoTransportMode }),
});
