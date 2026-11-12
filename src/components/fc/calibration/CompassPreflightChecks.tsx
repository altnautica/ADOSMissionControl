"use client";

import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/toast";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { cn } from "@/lib/utils";
import { confirmArmedParamWrite } from "@/lib/protocol/param-write";
import type { CompassParams } from "./calibration-types";

interface CompassPreflightChecksProps {
  compassParams: CompassParams;
  setCompassParams: React.Dispatch<React.SetStateAction<CompassParams>>;
}

/** ArduPilot COMPASS_EXTERNAL values (locale keys). */
const EXTERNAL_KEYS: Record<number, string> = { 0: "extInternal", 1: "extExternal", 2: "extForced" };

const LEARN_KEYS: Record<number, string> = { 0: "learnOff", 1: "learnInternal", 2: "learnEkf", 3: "learnInFlight" };

function Pending({ value }: { value: number | null | undefined }) {
  const tm = useTranslations("fcPanels.compassPreflightChecks");
  return <span className="text-text-tertiary">{value === undefined ? tm("loading") : tm("unavailable")}</span>;
}

export function CompassPreflightChecks({ compassParams, setCompassParams }: CompassPreflightChecksProps) {
  const tm = useTranslations("fcPanels.compassPreflightChecks");
  const selectedProtocol = useDroneManager(selectSelectedProtocol);
  const { toast } = useToast();

  // Only a write the FC confirmed updates the check; a refused or timed-out
  // write leaves the old value on screen.
  async function writeParam(name: "COMPASS_AUTO_ROT" | "COMPASS_OFFS_MAX", value: number) {
    const protocol = selectedProtocol;
    if (!protocol) return;
    if (!(await confirmArmedParamWrite("compass-preflight", [name]))) return;
    const result = await protocol.setParameter(name, value).catch(() => null);
    if (!result?.success) {
      toast(tm("notChanged", { name, reason: result?.message || tm("noReply") }), "error");
      return;
    }
    setCompassParams((p) => ({ ...p, [name]: value }));
    toast(tm("setTo", { name, value }), "success");
  }

  const { COMPASS_USE, COMPASS_ORIENT, COMPASS_AUTO_ROT, COMPASS_OFFS_MAX, COMPASS_LEARN, COMPASS_EXTERNAL } = compassParams;

  return (
    <div className="border border-border-default bg-bg-secondary p-4">
      <h3 className="text-xs font-medium text-text-primary mb-2">{tm("compassPreFlightChecks")}</h3>
      <div className="space-y-1.5">
        {/* COMPASS_USE */}
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-text-secondary font-mono">COMPASS_USE</span>
          {typeof COMPASS_USE !== "number" ? (
            <Pending value={COMPASS_USE} />
          ) : COMPASS_USE === 1 ? (
            <span className="text-status-success font-mono">{tm("enabled")}</span>
          ) : (
            <span className="text-status-error font-mono">{tm("disabledHint")}</span>
          )}
        </div>
        {/* COMPASS_ORIENT */}
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-text-secondary font-mono">COMPASS_ORIENT</span>
          {typeof COMPASS_ORIENT !== "number" ? (
            <Pending value={COMPASS_ORIENT} />
          ) : (
            <span className="text-text-primary font-mono">
              {COMPASS_ORIENT} {COMPASS_ORIENT === 0 ? `(${tm("none")})` : COMPASS_ORIENT === 6 ? "(Yaw270)" : ""}
            </span>
          )}
        </div>
        {/* COMPASS_AUTO_ROT */}
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-text-secondary font-mono">COMPASS_AUTO_ROT</span>
          {typeof COMPASS_AUTO_ROT !== "number" ? (
            <Pending value={COMPASS_AUTO_ROT} />
          ) : COMPASS_AUTO_ROT === 3 ? (
            <span className="text-status-success font-mono">3 ({tm("lenient")})</span>
          ) : (
            <span className="flex items-center gap-2">
              <span className="text-status-warning font-mono">{tm("recommendLenient", { value: COMPASS_AUTO_ROT })}</span>
              <button
                className="text-[9px] text-accent-primary hover:underline"
                onClick={() => writeParam("COMPASS_AUTO_ROT", 3)}
              >
                {tm("fix")}
              </button>
            </span>
          )}
        </div>
        {/* COMPASS_OFFS_MAX */}
        {COMPASS_OFFS_MAX !== undefined && (
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-text-secondary font-mono">COMPASS_OFFS_MAX</span>
            {COMPASS_OFFS_MAX === null ? (
              <Pending value={COMPASS_OFFS_MAX} />
            ) : (
              <span className="flex items-center gap-2">
                <span className={cn("font-mono", COMPASS_OFFS_MAX < 850 ? "text-status-warning" : "text-text-primary")}>
                  {COMPASS_OFFS_MAX} {COMPASS_OFFS_MAX < 850 ? `— ${tm("lowLimit")}` : ""}
                </span>
                {COMPASS_OFFS_MAX < 2000 && (
                  <button
                    className="text-[9px] text-accent-primary hover:underline"
                    onClick={() => writeParam("COMPASS_OFFS_MAX", 2000)}
                  >
                    {tm("increaseTo", { value: 2000 })}
                  </button>
                )}
              </span>
            )}
          </div>
        )}
        {/* COMPASS_LEARN */}
        {COMPASS_LEARN !== undefined && (
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-text-secondary font-mono">COMPASS_LEARN</span>
            {COMPASS_LEARN === null ? (
              <Pending value={COMPASS_LEARN} />
            ) : (
              <span className="text-text-primary font-mono">
                {COMPASS_LEARN} ({LEARN_KEYS[COMPASS_LEARN] ? tm(LEARN_KEYS[COMPASS_LEARN]) : tm("unknown")})
              </span>
            )}
          </div>
        )}
        {/* COMPASS_EXTERNAL */}
        {COMPASS_EXTERNAL !== undefined && (
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-text-secondary font-mono">COMPASS_EXTERNAL</span>
            {COMPASS_EXTERNAL === null ? (
              <Pending value={COMPASS_EXTERNAL} />
            ) : (
              <span className="text-text-primary font-mono">
                {EXTERNAL_KEYS[COMPASS_EXTERNAL] ? tm(EXTERNAL_KEYS[COMPASS_EXTERNAL]) : tm("unknownValue", { value: COMPASS_EXTERNAL })}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
