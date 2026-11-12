"use client";

/**
 * Localized labels for the static option lists (`{ value, label }[]`) that
 * parameter panels share as module constants.
 *
 * A constant keeps its English `label` as the key id; `optionLabelKey` turns it
 * into a key under the `optionLabels` namespace, and `useOptionLabels` returns
 * a mapper that swaps every label for its translation at render. The catalog
 * test (`tests/unit/option-labels-catalog.test.tsx`) keeps every label of every
 * wrapped constant present in the English catalog.
 *
 * @license GPL-3.0-only
 */

import { useCallback } from "react";
import { useTranslations } from "next-intl";

/** The `optionLabels` key of an English option label. */
export function optionLabelKey(label: string): string {
  const [first, ...rest] = label.match(/[A-Za-z0-9]+/g) ?? [];
  if (first === undefined) {
    return "sym" + Array.from(label).map((c) => c.codePointAt(0)!.toString(16)).join("");
  }
  const key = first.toLowerCase() + rest.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
  return /^[0-9]/.test(key) ? `n${key}` : key;
}

/**
 * Returns a mapper that replaces each entry's `label` (and `description`, when
 * the entry has one) with its translation.
 */
export function useOptionLabels() {
  const t = useTranslations("optionLabels");
  return useCallback(
    <T extends { label: string; description?: string }>(options: readonly T[]): T[] =>
      options.map((o) => ({
        ...o,
        label: t(optionLabelKey(o.label)),
        ...(typeof o.description === "string" ? { description: t(optionLabelKey(o.description)) } : {}),
      })),
    [t],
  );
}
