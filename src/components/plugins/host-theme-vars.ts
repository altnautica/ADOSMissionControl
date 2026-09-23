"use client";

/**
 * @module host-theme-vars
 * @description The host's live design tokens as the CSS variable map a
 * plugin iframe receives through `theme.changed`.
 *
 * The values are read from the document root's computed style, so they
 * follow the operator's theme and accent choice. One observer on the root's
 * `data-theme` and `style` attributes serves every mounted iframe; it is
 * attached while at least one iframe subscribes.
 *
 * @license GPL-3.0-only
 */

import { useSyncExternalStore } from "react";

/** Token names a plugin can style against, without the `--alt-` prefix. */
export const PLUGIN_THEME_TOKENS = [
  "bg-primary",
  "bg-secondary",
  "bg-tertiary",
  "text-primary",
  "text-secondary",
  "text-tertiary",
  "accent-primary",
  "accent-primary-hover",
  "accent-secondary",
  "accent-foreground",
  "border-default",
  "border-strong",
  "status-success",
  "status-warning",
  "status-error",
] as const;

export type HostThemeVars = Readonly<Record<string, string>>;

let snapshot: HostThemeVars | null = null;
let observer: MutationObserver | null = null;
const listeners = new Set<() => void>();

/** Read the current token values; `--<token>` keys, resolved colours. */
function readThemeVars(): HostThemeVars {
  const style = getComputedStyle(document.documentElement);
  const vars: Record<string, string> = {};
  for (const token of PLUGIN_THEME_TOKENS) {
    const value = style.getPropertyValue(`--alt-${token}`).trim();
    if (value) vars[`--${token}`] = value;
  }
  return vars;
}

function refresh(): void {
  const next = readThemeVars();
  const changed =
    snapshot === null ||
    Object.keys(next).length !== Object.keys(snapshot).length ||
    Object.entries(next).some(([k, v]) => snapshot?.[k] !== v);
  if (!changed) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!observer) {
    observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "style"],
    });
    refresh();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && observer) {
      observer.disconnect();
      observer = null;
      snapshot = null;
    }
  };
}

function getSnapshot(): HostThemeVars | null {
  if (snapshot === null && typeof document !== "undefined") snapshot = readThemeVars();
  return snapshot;
}

/** The host's current theme variables, or null during server render. */
export function useHostThemeVars(): HostThemeVars | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
