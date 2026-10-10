"use client";

/**
 * @module use-demo-mode
 * @description Reactive demo-mode flag. `isDemoMode()` is a point-in-time read;
 * components that branch on it during render use this hook so they re-render
 * when the settings toggle flips or the persisted store hydrates.
 *
 * @license GPL-3.0-only
 */

import { useSettingsStore } from "@/stores/settings-store";
import { isDemoMode } from "@/lib/utils";

export function useDemoMode(): boolean {
  // Subscribing to both fields re-renders on hydration and on toggle; the
  // answer itself comes from the single source of truth in `isDemoMode()`.
  useSettingsStore((s) => s.demoMode);
  useSettingsStore((s) => s._hasHydrated);
  return isDemoMode();
}
