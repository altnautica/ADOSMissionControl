"use client";

import { useEffect, useState } from "react";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Play, Square } from "lucide-react";
import { useMotorTestController } from "./use-motor-test-controller";

/**
 * MSP bench motor test. All sending, stopping and safety teardown lives in
 * `useMotorTestController`; this component renders it. Each motor's figure is
 * the output the FC reports, with the commanded value beside it.
 */
export function BfMotorTest({ connected }: { connected: boolean }) {
  const { toast } = useToast();
  const { isHardBlocked } = useArmedLock();
  const test = useMotorTestController();
  const [propsRemoved, setPropsRemoved] = useState(false);

  useEffect(() => {
    if (test.error) toast(test.error, "error");
  }, [test.error, toast]);

  function handleEnable() {
    if (test.enable()) toast("Motor test started. Keep clear of props!", "warning");
    else toast("Cannot test motors while armed", "error");
  }

  const count = test.motorCount ?? 0;
  const driven = test.commanded.slice(0, count);
  const master = driven.length > 0 && driven.every((v) => v === driven[0]) ? driven[0] : null;

  return (
    <>
      {/* Safety warning */}
      <div className="flex items-start gap-2 p-3 bg-status-error/10 border border-status-error/20 rounded">
        <AlertTriangle size={16} className="text-status-error shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-medium text-status-error">REMOVE ALL PROPELLERS BEFORE TESTING</p>
          <p className="text-[10px] text-status-error/80 mt-0.5">
            Motors will spin when tested. Failure to remove propellers can result in injury or damage.
          </p>
        </div>
      </div>

      {/* Props removed acknowledgment */}
      <label className="flex items-center gap-2 cursor-pointer mt-2">
        <input
          type="checkbox"
          checked={propsRemoved}
          onChange={(e) => setPropsRemoved(e.target.checked)}
          className="w-4 h-4 rounded border-border-default bg-bg-tertiary accent-accent-primary"
        />
        <span className="text-xs text-text-secondary">I confirm all propellers have been removed</span>
      </label>

      {propsRemoved && !test.supported && (
        <p className="text-[10px] text-text-tertiary mt-3">Motor test is not available on this link.</p>
      )}

      {/* Motor controls */}
      {propsRemoved && test.supported && (
        <div className="space-y-4 mt-3">
          <div className="flex items-center gap-2">
            {!test.active ? (
              <Button
                variant="primary"
                size="sm"
                icon={<Play size={12} />}
                onClick={handleEnable}
                disabled={isHardBlocked || !connected || test.motorCount === null}
              >
                Enable Motor Test
              </Button>
            ) : (
              <Button variant="secondary" size="sm" icon={<Square size={12} />} onClick={test.stop} className="border-status-error text-status-error">
                Stop All Motors
              </Button>
            )}
            {isHardBlocked && <span className="text-[10px] text-status-error">Disarm to test motors</span>}
          </div>

          {test.motorCount === null ? (
            <p className="text-[10px] text-text-tertiary">Waiting for the flight controller&apos;s motor output report.</p>
          ) : (
            <>
              {/* Individual motor sliders */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {Array.from({ length: count }, (_, i) => {
                  const fc = test.reported[i];
                  return (
                    <div key={i} className="text-center space-y-2">
                      <span className="text-xs font-mono text-text-secondary">Motor {i + 1}</span>
                      <div className="relative mx-auto w-8">
                        <input
                          type="range" min="0" max="100" value={test.commanded[i]}
                          onChange={(e) => test.setMotor(i, Number(e.target.value))}
                          disabled={!test.active}
                          aria-label={`Motor ${i + 1} throttle`}
                          className="w-24 -rotate-90 translate-y-10 origin-center accent-accent-primary disabled:opacity-30"
                          style={{ height: "2rem", marginTop: "2rem", marginBottom: "2rem" }}
                        />
                      </div>
                      <span className={`block text-sm font-mono tabular-nums ${fc !== null && fc > 0 ? "text-status-warning" : "text-text-tertiary"}`}>
                        {fc === null ? "--" : `${fc}%`}
                      </span>
                      <span className="block text-[9px] font-mono text-text-tertiary">set {test.commanded[i]}%</span>
                    </div>
                  );
                })}
              </div>

              {/* Master slider */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-text-secondary">
                  <span>Master Throttle</span>
                  <span className="font-mono tabular-nums">{master === null ? "mixed" : `${master}%`}</span>
                </div>
                <input
                  type="range" min="0" max="100" value={master ?? 0}
                  onChange={(e) => test.setAll(Number(e.target.value))}
                  disabled={!test.active}
                  aria-label="Master throttle"
                  className="w-full accent-accent-primary disabled:opacity-30"
                />
                <div className="flex justify-between text-[8px] text-text-tertiary font-mono">
                  <span>0%</span><span>50%</span><span>100%</span>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
