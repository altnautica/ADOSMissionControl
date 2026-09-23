"use client";

/**
 * @module AtlasCaptureControls
 * @description The Atlas capture lifecycle control bar (Start / Pause / Resume /
 * Stop & Reconstruct), plus an optional "Reconstruct now" action. Wired to the
 * `useAtlasControl` result; the visible buttons follow the readiness state so
 * the operator only sees valid transitions. Failures are surfaced honestly
 * (no fabricated reading): a `503` toasts "capture service unavailable", other failures toast
 * a generic message — never a silent no-op.
 *
 * Shared by the World Model setup surface and the Live World tab so both drive
 * capture identically.
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Play, Square, Pause, RotateCcw, Boxes } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { AtlasControl } from "@/hooks/use-atlas-control";
import {
  isActiveCaptureState,
  type CaptureResult,
} from "@/lib/agent/atlas-control-client";

/** "Reconstruct now" wiring (Live World only) — resolved by the caller from the
 * paired compute node + active session. */
export interface ReconstructAction {
  /** Whether the action can run (a reachable compute client + a live session). */
  available: boolean;
  /** i18n key for why it is disabled, or null when available. */
  disabledKey: string | null;
  /** Submit a reconstruct job; resolves true on success. */
  submit: () => Promise<boolean>;
}

export function AtlasCaptureControls({
  control,
  canStart,
  startBlockedKey,
  reconstruct,
  blockedKey = null,
}: {
  control: AtlasControl;
  /** Whether Start is allowed (requirements pass). */
  canStart: boolean;
  /** i18n key for why Start is blocked, or null. */
  startBlockedKey: string | null;
  /** Optional "Reconstruct now" action (Live World tab). */
  reconstruct?: ReconstructAction;
  /** When set, all lifecycle buttons are disabled with this i18n reason (e.g.
   * the drone is not reachable over the LAN to command capture). */
  blockedKey?: string | null;
}) {
  const t = useTranslations("atlas");
  const { toast } = useToast();
  const [reconstructing, setReconstructing] = useState(false);

  const readiness = control.readiness;
  // Derive "active session" from BOTH the standalone bool and the lifecycle
  // state so Pause/Resume/Stop stay visible through a paused session even when
  // an agent reports capturing:false while state:"paused" (no fabricated reading).
  const capturing = readiness
    ? readiness.capturing === true || isActiveCaptureState(readiness.state)
    : false;
  const paused = readiness?.state === "paused";
  const blocked = Boolean(blockedKey);
  const blockedTitle = blockedKey ? t(blockedKey) : undefined;

  const handleResult = (result: CaptureResult, failKey: string) => {
    if (result.ok) return;
    if (result.serviceDown) {
      toast(t("capture.captureServiceDown"), "error");
    } else if (result.message !== "inactive") {
      toast(t(failKey), "error");
    }
  };

  const onStart = async () => {
    handleResult(await control.start(), "capture.captureStartFailed");
  };
  const onStop = async () => {
    handleResult(await control.stop(), "capture.captureStopFailed");
  };
  const onPause = async () => {
    handleResult(await control.pause(), "capture.captureCommandFailed");
  };
  const onResume = async () => {
    handleResult(await control.resume(), "capture.captureCommandFailed");
  };
  const onReconstruct = async () => {
    if (!reconstruct?.available) return;
    setReconstructing(true);
    try {
      const ok = await reconstruct.submit();
      toast(
        ok ? t("capture.reconstructSubmitted") : t("capture.reconstructFailed"),
        ok ? "success" : "error",
      );
    } finally {
      setReconstructing(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!capturing && (
        <Button
          size="sm"
          variant="primary"
          icon={<Play size={12} />}
          loading={control.busy}
          disabled={blocked || !canStart || control.busy}
          title={
            blocked
              ? blockedTitle
              : !canStart && startBlockedKey
                ? t(startBlockedKey)
                : undefined
          }
          onClick={onStart}
        >
          {t("capture.startCapture")}
        </Button>
      )}

      {capturing && paused && (
        <Button
          size="sm"
          variant="primary"
          icon={<Play size={12} />}
          loading={control.busy}
          disabled={blocked || control.busy}
          title={blockedTitle}
          onClick={onResume}
        >
          {t("capture.resumeCapture")}
        </Button>
      )}

      {capturing && !paused && (
        <Button
          size="sm"
          variant="secondary"
          icon={<Pause size={12} />}
          loading={control.busy}
          disabled={blocked || control.busy}
          title={blockedTitle}
          onClick={onPause}
        >
          {t("capture.pauseCapture")}
        </Button>
      )}

      {capturing && (
        <Button
          size="sm"
          variant="danger"
          icon={<Square size={12} />}
          loading={control.busy}
          disabled={blocked || control.busy}
          title={blockedTitle}
          onClick={onStop}
        >
          {t("capture.stopCapture")}
        </Button>
      )}

      {reconstruct && (
        <Button
          size="sm"
          variant="secondary"
          icon={<Boxes size={12} />}
          loading={reconstructing}
          disabled={!reconstruct.available || reconstructing}
          title={
            !reconstruct.available && reconstruct.disabledKey
              ? t(reconstruct.disabledKey)
              : undefined
          }
          onClick={onReconstruct}
        >
          {t("capture.reconstructNow")}
        </Button>
      )}

      {control.demo && (
        <span className="flex items-center gap-1 text-[10px] text-text-tertiary">
          <RotateCcw size={10} />
          {t("capture.demoNote")}
        </span>
      )}
    </div>
  );
}
