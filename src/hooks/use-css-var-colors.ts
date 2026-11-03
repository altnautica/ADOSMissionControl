"use client";

/**
 * @module use-css-var-colors
 * @description Resolved values of theme colour tokens for renderers that take
 * a literal colour (Leaflet path options, three.js materials) and so cannot
 * use `var(--token)` directly. Re-reads when the root element's theme
 * attribute or inline accent overrides change, so a theme or accent switch
 * repaints the map or the 3D scene. Returns "" for every token before mount.
 *
 * @license GPL-3.0-only
 */

import { useMemo, useSyncExternalStore } from "react";

const SEPARATOR = "\u0000";

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "class", "style"],
  });
  return () => observer.disconnect();
}

function serverSnapshot(): string {
  return "";
}

/** The computed values of `names` (custom properties, e.g. `--alt-accent-primary`). */
export function useCssVarColors(names: readonly string[]): string[] {
  const key = names.join(SEPARATOR);
  const snapshot = useSyncExternalStore(
    subscribe,
    () => {
      const style = getComputedStyle(document.documentElement);
      return key
        .split(SEPARATOR)
        .map((n) => style.getPropertyValue(n).trim())
        .join(SEPARATOR);
    },
    serverSnapshot,
  );
  return useMemo(
    () => (snapshot === "" ? names.map(() => "") : snapshot.split(SEPARATOR)),
    // `names` is captured through `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshot, key],
  );
}
