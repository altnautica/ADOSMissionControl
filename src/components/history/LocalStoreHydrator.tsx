"use client";

/**
 * Loads every IndexedDB-backed local record store once at app start:
 * flight history, aircraft, batteries, equipment, operator profile and
 * loadouts. Mounted from the root layout so the stores are hydrated on
 * every route, not only on the pages that display them.
 *
 * In demo mode it also replaces any stored demo flights with the curated
 * demo history. Seeding here rather than on one page means Reports, a
 * drone's Flights tab and the Flight logs list all read the same records.
 * Demo records are filtered out of persistToIDB so they never reach IDB.
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
import { useDemoMode } from "@/hooks/use-demo-mode";

export function LocalStoreHydrator() {
  const demo = useDemoMode();

  useEffect(() => {
    void useHistoryStore.getState().ensureLoaded();
    void useAircraftRegistryStore.getState().ensureLoaded();
    void useBatteryRegistryStore.getState().ensureLoaded();
    void useEquipmentRegistryStore.getState().ensureLoaded();
    void useOperatorProfileStore.getState().ensureLoaded();
    void useLoadoutStore.getState().ensureLoaded();
  }, []);

  useEffect(() => {
    if (!demo) return;
    let cancelled = false;
    void (async () => {
      // Loaded on demand: this component sits in the root layout, and the
      // demo dataset must stay out of the bundle every non-demo page loads.
      const { seedDemoHistory, seedDemoTelemetryRecordings } = await import("@/mock/history");
      await useHistoryStore.getState().resetDemoData();
      if (cancelled) return;
      const records = seedDemoHistory();
      await seedDemoTelemetryRecordings(records);
      if (cancelled) return;
      useHistoryStore.getState().initWithSeedData(records);
    })();
    return () => {
      cancelled = true;
    };
  }, [demo]);

  return null;
}
