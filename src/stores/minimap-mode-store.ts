/**
 * The cockpit minimap's frame toggle (`AUTO | LOCAL | MAP`), persisted per
 * vehicle so a GNSS-denied airframe keeps its local frame across sessions.
 * Keyed by the cockpit drone id. Local-first, per browser.
 *
 * @module minimap-mode-store
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import type { MinimapPin } from "@/lib/hud/minimap-mode";

interface MinimapModeState {
  pinByVehicle: Record<string, MinimapPin>;
  setPin: (droneId: string, pin: MinimapPin) => void;
}

const PINS: readonly MinimapPin[] = ["auto", "local", "map"];

export const useMinimapModeStore = create<MinimapModeState>()(
  persist(
    (set) => ({
      pinByVehicle: {},
      setPin: (droneId, pin) =>
        set((s) => {
          const pinByVehicle = { ...s.pinByVehicle };
          // `auto` is the default: store only the overrides.
          if (pin === "auto") delete pinByVehicle[droneId];
          else pinByVehicle[droneId] = pin;
          return { pinByVehicle };
        }),
    }),
    {
      name: "altcmd:minimap-mode",
      storage: createJSONStorage(() =>
        typeof window !== "undefined"
          ? window.localStorage
          : { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      ),
      partialize: (s) => ({ pinByVehicle: s.pinByVehicle }),
      version: 1,
      // Identity at v1; entries that are not a known pin are dropped so a
      // hand-edited value degrades to AUTO. Bump `version` and add a branch
      // here the moment the persisted shape changes.
      migrate: (persisted) => {
        const raw = (persisted as { pinByVehicle?: unknown } | null)?.pinByVehicle;
        const pinByVehicle: Record<string, MinimapPin> = {};
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
          for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
            if ((PINS as readonly unknown[]).includes(v)) pinByVehicle[k] = v as MinimapPin;
          }
        }
        return { pinByVehicle } as MinimapModeState;
      },
    },
  ),
);
