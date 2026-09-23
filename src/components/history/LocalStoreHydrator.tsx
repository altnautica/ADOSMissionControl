"use client";

/**
 * Loads every IndexedDB-backed local record store once at app start:
 * flight history, aircraft, batteries, equipment, operator profile and
 * loadouts. Mounted from the root layout so the stores are hydrated on
 * every route, not only on the pages that display them.
 *
 * Each store also gates its own writes on the same load, so a write that
 * races this effect still waits for the stored value to be merged first.
 *
 * @license GPL-3.0-only
 */

import { useEffect } from "react";
import { useHistoryStore } from "@/stores/history-store";
import { useAircraftRegistryStore } from "@/stores/aircraft-registry-store";
import { useBatteryRegistryStore } from "@/stores/battery-registry-store";
import { useEquipmentRegistryStore } from "@/stores/equipment-registry-store";
import { useOperatorProfileStore } from "@/stores/operator-profile-store";
import { useLoadoutStore } from "@/stores/loadout-store";

export function LocalStoreHydrator() {
  useEffect(() => {
    void useHistoryStore.getState().ensureLoaded();
    void useAircraftRegistryStore.getState().ensureLoaded();
    void useBatteryRegistryStore.getState().ensureLoaded();
    void useEquipmentRegistryStore.getState().ensureLoaded();
    void useOperatorProfileStore.getState().ensureLoaded();
    void useLoadoutStore.getState().ensureLoaded();
  }, []);
  return null;
}
