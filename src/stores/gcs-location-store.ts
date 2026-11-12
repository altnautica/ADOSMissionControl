/**
 * @module gcs-location-store
 * @description Zustand store wrapping browser Geolocation API. Manages ephemeral
 * runtime state (watch ID, live coordinates, permission). The user preference
 * `locationEnabled` lives in settings-store; this store handles the actual API.
 * @license GPL-3.0-only
 */

import { create } from "zustand";

export type GeoPermission = "prompt" | "granted" | "denied" | "unavailable";

export interface GcsPosition {
  lat: number;
  lon: number;
  accuracy: number;
  altitude: number | null;
  timestamp: number;
}

interface GcsLocationState {
  permission: GeoPermission;
  position: GcsPosition | null;
  watchId: number | null;
  isSupported: boolean;
  lastError: string | null;

  checkPermission: () => Promise<GeoPermission>;
  requestPermission: () => Promise<GeoPermission>;
  startWatching: () => void;
  stopWatching: () => void;
  initLocation: () => Promise<void>;
}

function hasGeolocation(): boolean {
  return typeof navigator !== "undefined" && "geolocation" in navigator;
}

/**
 * The desktop app on Linux has no position provider: the permission is
 * granted but every fix fails with POSITION_UNAVAILABLE. Report that as
 * "unavailable" instead of leaving the operator at "not requested".
 */
export function noPositionProvider(code: number): boolean {
  return (
    code === 2 &&
    typeof window !== "undefined" &&
    window.electronAPI?.isElectron === true &&
    window.electronAPI.platform === "linux"
  );
}

export const useGcsLocationStore = create<GcsLocationState>()((set, get) => ({
  // Default true to avoid SSR/client mismatch — actions check lazily and set false if unavailable
  permission: "prompt",
  position: null,
  watchId: null,
  isSupported: true,
  lastError: null,

  checkPermission: async () => {
    if (!hasGeolocation()) {
      set({ permission: "unavailable", isSupported: false });
      return "unavailable";
    }

    try {
      const status = await navigator.permissions.query({ name: "geolocation" });
      const perm = status.state === "granted" ? "granted"
        : status.state === "denied" ? "denied"
        : "prompt";
      set({ permission: perm });

      // Listen for external revocation
      status.onchange = () => {
        const newPerm: GeoPermission = status.state === "granted" ? "granted"
          : status.state === "denied" ? "denied"
          : "prompt";
        set({ permission: newPerm });
        if (newPerm === "denied") {
          get().stopWatching();
        }
      };

      return perm;
    } catch {
      // Permissions API not supported — we'll find out when we call getCurrentPosition
      return get().permission;
    }
  },

  requestPermission: async () => {
    if (!hasGeolocation()) {
      set({ permission: "unavailable", isSupported: false });
      return "unavailable";
    }

    return new Promise<GeoPermission>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          set({
            permission: "granted",
            position: {
              lat: pos.coords.latitude,
              lon: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
              altitude: pos.coords.altitude,
              timestamp: pos.timestamp,
            },
            lastError: null,
          });
          resolve("granted");
        },
        (err) => {
          const perm: GeoPermission =
            err.code === 1 ? "denied" : noPositionProvider(err.code) ? "unavailable" : "prompt";
          set({ permission: perm, lastError: err.message });
          resolve(perm);
        },
        { enableHighAccuracy: true, timeout: 15_000 }
      );
    });
  },

  startWatching: () => {
    if (!hasGeolocation()) { set({ isSupported: false }); return; }
    if (get().watchId !== null) return; // already watching

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        set({
          position: {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            altitude: pos.coords.altitude,
            timestamp: pos.timestamp,
          },
          lastError: null,
          permission: "granted",
        });
      },
      (err) => {
        set({ lastError: err.message });
        if (err.code === 1) {
          set({ permission: "denied" });
          get().stopWatching();
        } else if (noPositionProvider(err.code)) {
          set({ permission: "unavailable" });
          get().stopWatching();
        }
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 5_000 }
    );
    set({ watchId: id });
  },

  stopWatching: () => {
    const { watchId } = get();
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      set({ watchId: null });
    }
  },

  initLocation: async () => {
    const perm = await get().checkPermission();
    if (perm !== "denied" && perm !== "unavailable") {
      get().startWatching();
    }
  },
}));
