"use client";

/**
 * @module host-theme-vars
 * @description The host's design tokens as the CSS variable map a plugin
 * iframe receives through `theme.changed`.
 *
 * The map starts from the full generated role set for the base theme matching
 * the document theme's colour scheme (`EXTENSION_THEMES`: brand-light for any
 * light theme, nvg for night vision, brand-dark otherwise), so an extension
 * sees every role (raised surfaces, status, focus, HUD) in the right scheme,
 * then overlays the live values of the core tokens read from the document
 * root's computed style, so a community theme or accent choice still flows
 * through.
 * One observer on the root's `data-theme` and `style` attributes serves every
 * mounted iframe; it is attached while at least one iframe subscribes.
 *
 * @license GPL-3.0-only
 */

import { useSyncExternalStore } from "react";

import {
  EXTENSION_THEMES,
  type ExtensionThemeId,
} from "@/lib/plugins/extension-theme.generated";
import { THEME_CARDS } from "@/components/onboarding/constants";

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

/** The generated base theme for a document `data-theme` value: chosen from the
 * theme's light/dark grouping in the theme registry, so every light community
 * theme (Solarized Light, Catppuccin Latte, …) gets light-scheme roles. */
export function extensionThemeFor(dataTheme: string | null): ExtensionThemeId {
  if (dataTheme === "nvg") return "nvg";
  const card = THEME_CARDS.find((c) => c.value === dataTheme);
  return card?.group === "light" ? "brand-light" : "brand-dark";
}

/** Read the current theme map; `--<token>` keys, resolved colours. */
function readThemeVars(): HostThemeVars {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const vars: Record<string, string> = {
    ...EXTENSION_THEMES[extensionThemeFor(root.getAttribute("data-theme"))],
  };
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
