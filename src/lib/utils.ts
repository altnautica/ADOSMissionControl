/**
 * Utility functions for Altnautica Command GCS.
 */

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

/** Check if demo mode is active (env var or URL param). */
export function isDemoMode(): boolean {
  if (typeof window === "undefined") {
    return process.env.NEXT_PUBLIC_DEMO_MODE === "true";
  }
  if (process.env.NEXT_PUBLIC_DEMO_MODE === "true") return true;
  const params = new URLSearchParams(window.location.search);
  return params.get("demo") === "true";
}

/** Generate a random ID. */
export function randomId(): string {
  return Math.random().toString(36).substring(2, 10);
}

/** Check if running inside the Electron desktop app. */
export function isElectron(): boolean {
  return typeof window !== "undefined" && (window as any).electronAPI?.isElectron === true;
}
