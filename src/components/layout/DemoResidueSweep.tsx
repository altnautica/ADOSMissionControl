"use client";

/**
 * @module layout/DemoResidueSweep
 * @description Always mounted, and free of mock imports so it costs a real
 * session nothing. When demo mode is off it strips demo LAN nodes and demo plans
 * that leaked into the persisted stores (for example a demo -> real reload where
 * the demo teardown never ran). Each strip waits for its store's own async
 * hydration so it runs after the persisted data lands, and is keyed on the fixed
 * demo ids, so a real fleet's nodes and plans are untouched.
 * @license GPL-3.0-only
 */

import { useEffect } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { usePlanLibraryStore } from "@/stores/plan-library-store";
import { clearDemoLanNodes, stripDemoPlans } from "@/lib/demo/demo-residue";

export function DemoResidueSweep() {
  const demoMode = useSettingsStore((s) => s.demoMode);
  const hasHydrated = useSettingsStore((s) => s._hasHydrated);

  useEffect(() => {
    if (!hasHydrated || demoMode) return;
    if (useLocalNodesStore.persist.hasHydrated()) {
      clearDemoLanNodes();
      return;
    }
    return useLocalNodesStore.persist.onFinishHydration(clearDemoLanNodes);
  }, [demoMode, hasHydrated]);

  useEffect(() => {
    if (!hasHydrated || demoMode) return;
    if (usePlanLibraryStore.persist.hasHydrated()) {
      stripDemoPlans();
      return;
    }
    return usePlanLibraryStore.persist.onFinishHydration(stripDemoPlans);
  }, [demoMode, hasHydrated]);

  return null;
}
