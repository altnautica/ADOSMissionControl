/**
 * @module cockpit/confirm/confirm-text
 * @description Text and audit helpers for the skill confirm sheet.
 * @license GPL-3.0-only
 */

import type { useTranslations } from "next-intl";

const OVERRIDE_LOG_KEY = "ados:flight-safety-overrides";

/**
 * Append a best-effort local audit row when an operator overrides an
 * incomplete checklist. Shares its storage key with the flight action panel so
 * both surfaces write one trail. Never throws — an audit failure must not
 * block a command.
 */
export function recordSafetyOverride(action: string, reason: string): void {
  try {
    const existing = JSON.parse(
      localStorage.getItem(OVERRIDE_LOG_KEY) ?? "[]",
    ) as unknown;
    const rows = Array.isArray(existing) ? existing : [];
    rows.push({ action, reason, at: new Date().toISOString() });
    localStorage.setItem(OVERRIDE_LOG_KEY, JSON.stringify(rows.slice(-100)));
  } catch {
    // Local audit trail is best-effort and must never block a command.
  }
}

/**
 * Translate a policy string. Built-in policies carry i18n keys; an extension
 * may supply literal text, which is shown as is.
 */
export function translatePolicyText(
  t: ReturnType<typeof useTranslations>,
  value: string,
  values?: Record<string, string | number>,
): string {
  if (!value.includes(".") || !t.has(value)) return value;
  return t(value, values);
}
