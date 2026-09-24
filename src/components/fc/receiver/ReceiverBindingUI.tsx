"use client";

import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { confirmArmedParamWrite, describeParamBatch, writeParamBatch } from "@/lib/protocol/param-write";
import { RcCalibrationWizard } from "../calibration/RcCalibrationWizard";
import { Crosshair } from "lucide-react";

interface ReceiverBindingUIProps {
  /** Live channel values; zeros when no fresh RC frame is available. */
  channels: number[];
  hasRcData: boolean;
  getChannelTrim: (i: number) => number;
  rollCh: number;
  pitchCh: number;
  yawCh: number;
  currentParams: ReadonlyMap<string, number>;
  /** Called after any write reached the vehicle, so the panel re-reads. */
  onWritten: () => void;
}

/**
 * Receiver calibration: the shared RC calibration wizard plus "set trims to
 * current stick positions". Every write goes through the armed guard, and the
 * result shown is what the vehicle accepted.
 */
export function ReceiverBindingUI({
  channels,
  hasRcData,
  getChannelTrim,
  rollCh,
  pitchCh,
  yawCh,
  currentParams,
  onWritten,
}: ReceiverBindingUIProps) {
  const { toast } = useToast();
  const selectedProtocol = useDroneManager(selectSelectedProtocol);
  const { isHardBlocked } = useArmedLock();
  const [showTrimPreview, setShowTrimPreview] = useState(false);
  const [settingTrims, setSettingTrims] = useState(false);

  const trimTargets = useMemo(() => [
    { role: "Roll", ch: rollCh },
    { role: "Pitch", ch: pitchCh },
    { role: "Yaw", ch: yawCh },
  ], [rollCh, pitchCh, yawCh]);

  async function handleSetTrims() {
    const protocol = selectedProtocol;
    if (!protocol) return;
    const entries = trimTargets
      .filter(({ ch }) => (channels[ch - 1] ?? 0) > 0)
      .map(({ ch }) => {
        const name = `RC${ch}_TRIM`;
        return { name, value: channels[ch - 1], oldValue: currentParams.get(name) ?? 0 };
      });
    if (entries.length === 0) {
      toast("No live RC data; trims not changed", "error");
      return;
    }
    setSettingTrims(true);
    try {
      if (!(await confirmArmedParamWrite("receiver", entries.map((e) => e.name)))) {
        toast("Trims not changed: vehicle is armed", "error");
        return;
      }
      const outcome = await writeParamBatch(protocol, entries, "receiver");
      if (outcome.written.size > 0) onWritten();
      const { message, level } = describeParamBatch(outcome);
      if (outcome.failures.length > 0) toast(`${message}. Failed: ${outcome.failures.join(", ")}`, "error");
      else toast(message, level);
    } finally {
      setSettingTrims(false);
      setShowTrimPreview(false);
    }
  }

  return (
    <>
      <Card title="Stick Trims">
        {showTrimPreview ? (
          <div className="p-2 bg-bg-tertiary border border-border-default space-y-2">
            <p className="text-[10px] font-medium text-text-secondary">Trim Preview (Roll, Pitch, Yaw):</p>
            <div className="space-y-0.5">
              {trimTargets.map(({ role, ch }) => {
                const current = channels[ch - 1] ?? 0;
                const oldTrim = getChannelTrim(ch - 1);
                return (
                  <div key={ch} className="flex items-center gap-2 text-[10px] font-mono">
                    <span className="text-text-secondary w-10">{role}</span>
                    <span className="text-text-tertiary">RC{ch}_TRIM:</span>
                    <span className="text-text-tertiary">{oldTrim}</span>
                    <span className="text-text-secondary">→</span>
                    <span className="text-text-primary">{current || "—"}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                icon={<Crosshair size={12} />}
                loading={settingTrims}
                disabled={!hasRcData || isHardBlocked}
                onClick={handleSetTrims}
              >
                Confirm
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowTrimPreview(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<Crosshair size={12} />}
              disabled={!hasRcData || isHardBlocked}
              onClick={() => setShowTrimPreview(true)}
            >
              Set Trims to Current
            </Button>
            <span className="text-[10px] text-text-tertiary">
              {hasRcData ? "Sets Roll/Pitch/Yaw trims to live stick positions" : "No live RC data — ensure transmitter is on and bound."}
            </span>
          </div>
        )}
      </Card>
      <RcCalibrationWizard connected currentParams={currentParams} onWritten={onWritten} />
    </>
  );
}
