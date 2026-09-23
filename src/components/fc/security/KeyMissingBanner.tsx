"use client";

/**
 * @module components/fc/security/KeyMissingBanner
 * @description Recovery UX for the `key_missing` enrollment state.
 *
 * Renders when the flight controller has `SIGNING_REQUIRE=1` but this
 * browser has no matching key in the keystore. Surfaces three mutually
 * exclusive recovery paths:
 *   1. Re-enroll from this browser (generates a fresh key, replaces the
 *      FC key, kicks any other browser on the old key offline)
 *   2. Import an existing key (paste hex from another browser that still
 *      has the key; the full paste flow lands in a follow-up)
 *   3. Clear FC signing (destructive; agent `/disable-on-fc`, leaves the
 *      FC accepting unsigned commands)
 *
 * @license GPL-3.0-only
 */

import { AlertTriangle, RotateCw, KeyRound, Trash2 } from "lucide-react";

interface Props {
  onReenroll: () => void;
  onImport: () => void;
  onClearFc: () => void;
  disabled?: boolean;
}

export function KeyMissingBanner({ onReenroll, onImport, onClearFc, disabled }: Props) {
  return (
    <div
      role="alert"
      className="border border-status-warning/40 bg-status-warning/5 p-4 space-y-3"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle
          size={16}
          aria-hidden="true"
          className="text-status-warning mt-0.5"
        />
        <div className="space-y-1">
          <p className="text-sm font-medium text-text-primary">
            Signing key missing on this browser
          </p>
          <p className="text-sm text-text-secondary">
            The flight controller requires signed commands, but this browser
            does not have the matching key. Commands you send here will be
            rejected until you recover.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={onReenroll}
          disabled={disabled}
          className="px-3 py-1.5 text-sm border border-border-default hover:bg-bg-tertiary disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          <RotateCw size={14} aria-hidden="true" />
          Re-enroll this browser
        </button>
        <button
          type="button"
          onClick={onImport}
          disabled={disabled}
          className="px-3 py-1.5 text-sm border border-border-default hover:bg-bg-tertiary disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          <KeyRound size={14} aria-hidden="true" />
          Import from another browser
        </button>
        <button
          type="button"
          onClick={onClearFc}
          disabled={disabled}
          className="px-3 py-1.5 text-sm border border-status-error/40 text-status-error hover:bg-status-error/10 disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          <Trash2 size={14} aria-hidden="true" />
          Clear FC signing
        </button>
      </div>
      <p className="text-[11px] text-text-tertiary">
        Re-enrolling generates a new key and replaces the flight controller&apos;s
        stored key. Any other browser that held the previous key will stop
        working until it re-enrolls.
      </p>
    </div>
  );
}
