"use client";

/**
 * @module components/fc/security/signing/SigningDisabledSection
 * @description Rendered when the FC supports signing but no browser key is
 * enrolled. Shows the Enable button, the staged enrollment progress UI, and
 * the import path for a key that is already on the FC (from another browser
 * or an export backup).
 */

import { useTranslations } from "next-intl";
import { ShieldOff } from "lucide-react";
import { EnrollmentProgress } from "../EnrollmentProgress";
import { FcSection } from "@/components/fc/shared/FcSection";

export interface SigningDisabledSectionProps {
  busy: boolean;
  enrollStartedAt: number | null;
  enrollFailed: boolean;
  onEnable: () => void;
  onImport: () => void;
  onResetEnroll: () => void;
  onCancelEnroll: () => void;
  /** Whether the enrollment also stores the key on the node. */
  agentHoldsKey: boolean;
  onAgentHoldsKeyChange: (holds: boolean) => void;
}

export function SigningDisabledSection({
  busy,
  enrollStartedAt,
  enrollFailed,
  onEnable,
  onImport,
  onResetEnroll,
  onCancelEnroll,
  agentHoldsKey,
  onAgentHoldsKeyChange,
}: SigningDisabledSectionProps) {
  const tr = useTranslations("fcPanels.signingDisabledSection");
  return (
    <FcSection>
      <div className="flex items-center gap-2 text-text-primary">
        <ShieldOff size={16} aria-hidden="true" />
        <span className="font-medium">{tr("mavlinkSigningIsOff")}</span>
      </div>
      <p className="text-sm text-text-tertiary">
        Enable signing to require a 32-byte HMAC key on every command sent to this drone.{" "}
        {agentHoldsKey
          ? "The key is kept in this browser and on the node, which signs its own traffic with it. A copy is pushed to the flight controller once."
          : "The key lives only in this browser. A copy is pushed to the flight controller once."}
      </p>
      <label className="flex items-start gap-2 text-sm text-text-secondary">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={agentHoldsKey}
          disabled={busy || enrollStartedAt !== null}
          onChange={(e) => onAgentHoldsKeyChange(e.target.checked)}
        />
        <span>
          {tr("letTheAgentSignIts")}
          <span className="block text-xs text-text-tertiary">
            {tr("withoutThisTheFlightController")}
          </span>
        </span>
      </label>
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
            className="px-4 py-2 bg-accent-primary text-accent-foreground text-sm font-medium disabled:opacity-50"
            onClick={onEnable}
            disabled={busy}
          >
            {tr("enableSigning")}
          </button>
          <button
            type="button"
            className="px-4 py-2 text-sm border border-border-default hover:bg-bg-tertiary disabled:opacity-50"
            onClick={onImport}
            disabled={busy}
          >
            {tr("importAnExistingKey")}
          </button>
        </div>
      )}
    </FcSection>
  );
}
