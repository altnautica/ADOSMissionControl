/**
 * Utility functions for Altnautica Command GCS.
 */

import { useSettingsStore } from "@/stores/settings-store";

/** Merge class names — simple conditional join (no clsx dependency). */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

/** Format ISO timestamp to readable date string. */
export function formatDate(date: Date | string | number, locale = "en"): string {
  const d = new Date(date);
  return d.toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Format ISO timestamp to readable time string. */
export function formatTime(date: Date | string | number, locale = "en"): string {
  const d = new Date(date);
  return d.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/** Format duration in seconds to MM:SS or HH:MM:SS. */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Clamp a number between min and max. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Linear interpolation. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Extract a human-readable message from an unknown error value. */
export function formatErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Whether demo mode is active. The persisted settings toggle is the single
 * source of truth once the settings store has hydrated; the build-time env
 * var and the `?demo=true` URL only seed it (the env var is the first-install
 * default, the URL flips the toggle on at hydration). Before hydration, and on
 * the server, the seed is the answer.
 */
export function isDemoMode(): boolean {
  const envSeed = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
  if (typeof window === "undefined") return envSeed;
  const settings = useSettingsStore.getState();
  if (settings._hasHydrated) return settings.demoMode;
  if (envSeed) return true;
  return new URLSearchParams(window.location.search).get("demo") === "true";
}

/** Generate a random ID. */
export function randomId(): string {
  return Math.random().toString(36).substring(2, 10);
}

/** Check if running inside the Electron desktop app. */
export function isElectron(): boolean {
  return typeof window !== "undefined" && window.electronAPI?.isElectron === true;
}

/**
 * True when an event target is a text-editing surface (input, textarea, select,
 * or a contenteditable element). Keyboard-shortcut handlers should bail when this
 * is true so typing in a field never triggers a map/tool shortcut.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}
