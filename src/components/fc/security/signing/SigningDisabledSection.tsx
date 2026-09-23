"use client";

/**
 * @module components/fc/security/signing/SigningDisabledSection
 * @description Rendered when the FC supports signing but no browser key is
 * enrolled. Shows the Enable button, the staged enrollment progress UI, and
 * the import path for a key that is already on the FC (from another browser
 * or an export backup).
 */

import { ShieldOff } from "lucide-react";
import { EnrollmentProgress } from "../EnrollmentProgress";

export interface SigningDisabledSectionProps {
  busy: boolean;
  enrollStartedAt: number | null;
  enrollFailed: boolean;
  onEnable: () => void;
  onImport: () => void;
  onResetEnroll: () => void;
  onCancelEnroll: () => void;
}

export function SigningDisabledSection({
  busy,
  enrollStartedAt,
  enrollFailed,
  onEnable,
  onImport,
  onResetEnroll,
  onCancelEnroll,
}: SigningDisabledSectionProps) {
  return (
    <div className="border border-border-default bg-bg-secondary p-4 space-y-3">
      <div className="flex items-center gap-2 text-text-primary">
        <ShieldOff size={16} aria-hidden="true" />
        <span className="font-medium">MAVLink signing is off</span>
      </div>
      <p className="text-sm text-text-tertiary">
        Enable signing to require a 32-byte HMAC key on every command sent to this drone.
        The key lives only in this browser. A copy is pushed to the flight controller once.
      </p>
      {enrollStartedAt !== null ? (
        <EnrollmentProgress
          startedAt={enrollStartedAt}
          failed={enrollFailed}
          onRetry={onResetEnroll}
          onCancel={onCancelEnroll}
        />
      ) : (
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            className="px-4 py-2 bg-accent-primary text-white text-sm font-medium disabled:opacity-50"
            onClick={onEnable}
            disabled={busy}
          >
            Enable signing
          </button>
          <button
            type="button"
            className="px-4 py-2 text-sm border border-border-default hover:bg-bg-tertiary disabled:opacity-50"
            onClick={onImport}
            disabled={busy}
          >
            Import an existing key
          </button>
        </div>
      )}
    </div>
  );
}
