"use client";

/**
 * @module PairingResult
 * @description Terminal states. Success shows the device name and the network
 * address the agent reported (nothing when it reported none), error shows the
 * message + retry, expired shows the timeout warning + retry.
 * @license GPL-3.0-only
 */

import { Check, AlertCircle, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";

import type { PairedInfo } from "./use-pairing-flow";

interface SuccessProps {
  variant: "success";
  info: PairedInfo;
}

interface ErrorProps {
  variant: "error";
  message: string;
  onRetry: () => void;
  // When the cloud relay does not know the code, the agent is likely in local
  // mode. Offer a jump to LAN pairing by hostname instead of only "try again".
  canPairLocally?: boolean;
  onPairLocally?: () => void;
}

interface ExpiredProps {
  variant: "expired";
  onRetry: () => void;
}

export function PairingResult(props: SuccessProps | ErrorProps | ExpiredProps) {
  const t = useTranslations("command");

  if (props.variant === "success") {
    return (
      <div className="flex flex-col items-center gap-3 py-6">
        <div className="w-10 h-10 rounded-full bg-status-success/15 flex items-center justify-center">
          <Check size={20} className="text-status-success" />
        </div>
        <div className="text-center space-y-1">
          <p className="text-sm font-medium text-text-primary">{t("paired")}</p>
          <p className="text-xs text-text-secondary">{props.info.name}</p>
          {props.info.host && (
            <p className="text-[10px] text-text-tertiary font-mono">{props.info.host}</p>
          )}
        </div>
        <p className="text-[11px] text-text-tertiary">{t("connectingAutomatically")}</p>
        <p className="text-[11px] text-text-tertiary text-center mt-2 max-w-xs">
          To enable MAVLink message signing, open Configure then Security after the drone connects.
        </p>
      </div>
    );
  }

  if (props.variant === "error") {
    return (
      <div className="flex flex-col items-center gap-3 py-6">
        <div className="w-10 h-10 rounded-full bg-status-error/15 flex items-center justify-center">
          <AlertCircle size={20} className="text-status-error" />
        </div>
        <div className="text-center space-y-1">
          <p className="text-sm font-medium text-text-primary">{t("pairingFailed")}</p>
          <p className="text-xs text-status-error">{props.message}</p>
        </div>
        <div className="flex items-center gap-2">
          {props.canPairLocally && props.onPairLocally && (
            <button
              onClick={props.onPairLocally}
              className="px-4 py-1.5 text-xs font-medium bg-accent-primary text-bg-primary rounded hover:bg-accent-primary/90 transition-colors"
            >
              {t("pairOnThisNetwork")}
            </button>
          )}
          <button
            onClick={props.onRetry}
            className="px-4 py-1.5 text-xs font-medium bg-bg-tertiary border border-border-default rounded hover:bg-bg-primary transition-colors text-text-primary"
          >
            {t("tryAgain")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 py-6">
      <div className="w-10 h-10 rounded-full bg-status-warning/15 flex items-center justify-center">
        <RotateCcw size={20} className="text-status-warning" />
      </div>
      <div className="text-center space-y-1">
        <p className="text-sm font-medium text-text-primary">{t("codeExpired")}</p>
        <p className="text-xs text-text-secondary">{t("codeExpiredMessage")}</p>
      </div>
      <button
        onClick={props.onRetry}
        className="px-4 py-1.5 text-xs font-medium bg-accent-primary text-bg-primary rounded hover:bg-accent-primary/90 transition-colors"
      >
        {t("generateNewCode")}
      </button>
    </div>
  );
}
