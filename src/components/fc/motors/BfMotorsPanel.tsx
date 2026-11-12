"use client";

import { useOptionLabels } from "@/lib/i18n/option-labels";
import { useTranslations } from "next-intl";
import { usePanelParams } from "@/hooks/use-panel-params";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { usePanelCommit } from "@/hooks/use-panel-commit";
import { usePanelScroll } from "@/hooks/use-panel-scroll";
import { ArmedWarningBanner } from "@/components/indicators/ArmedWarningBanner";
import { PanelHeader } from "../shared/PanelHeader";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

import { Cog, AlertTriangle, Gauge, Timer, Zap, Radio } from "lucide-react";
import { BfMotorTest } from "./BfMotorTest";
import { BfDshotCommands } from "../betaflight/BfDshotCommands";
import { ESC_PROTOCOLS, isDshotProtocol, usesPwmRate } from "./bf-motor-protocols";
import { BF_MOTORS_PARAM_NAMES as PARAM_NAMES } from "./bf-motors-constants";
import { FcSection } from "@/components/fc/shared/FcSection";

import { PanelSaveBar } from "@/components/fc/shared/PanelSaveBar";

// ── Component ────────────────────────────────────────────────

export function BfMotorsPanel() {
  const ol = useOptionLabels();
  const tr = useTranslations("fcPanels.bfMotorsPanel");
  const selectedProtocol = useDroneManager(selectSelectedProtocol);
  const t = useTranslations("fcToasts.motors");
  const scrollRef = usePanelScroll("bf-motors");

  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded, refresh, setLocalValue, saveAllToRam, commitToFlash, revertAll,
  } = usePanelParams({ paramNames: PARAM_NAMES, panelId: "bf-motors", autoLoad: true });
  const { saving, save: handleSave, flashing, flash: handleFlash } = usePanelCommit(
    { saveAllToRam, commitToFlash, revertAll },
    { flash: { successMessage: t("flashWritten") } },
  );
  useUnsavedGuard(dirtyParams.size > 0);

  const connected = !!selectedProtocol;
  const hasDirty = dirtyParams.size > 0;

  const p = (name: string, fallback = "0") => String(params.get(name) ?? fallback);
  const set = (name: string, v: string) => setLocalValue(name, Number(v) || 0);

  const escProtocol = params.get("BF_MOTOR_PWM_PROTOCOL") ?? 0;
  const isDshot = isDshotProtocol(escProtocol);
  const isPwmLike = usesPwmRate(escProtocol);

  const idleRaw = params.get("BF_MOTOR_IDLE_PCT") ?? 0;
  const idleDisplay = (idleRaw / 100).toFixed(2);

  const pidDenom = params.get("BF_PID_PROCESS_DENOM") ?? 1;
  // The FC reports its gyro sample rate in MSP_BOARD_INFO (API 1.43+); without
  // it the loop rates are unknown rather than assumed.
  const gyroRateHz = selectedProtocol?.getVehicleInfo()?.gyroSampleRateHz;
  const effectivePidRate = gyroRateHz ? gyroRateHz / Math.max(1, pidDenom) : undefined;

  const formatRate = (hz: number) => hz >= 1000 ? `${(hz / 1000).toFixed(1)}kHz` : `${Math.round(hz)}Hz`;

  return (
    <ArmedWarningBanner>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl space-y-6">
          <PanelHeader title={tr("motorsESC")} subtitle={tr("motorConfigurationESCProtocolAnd")}
            icon={<Cog size={16} />} loading={loading} loadProgress={loadProgress}
            hasLoaded={hasLoaded} onRead={refresh} connected={connected} error={error} />

          <FcSection icon={<Zap size={14} />} title={tr("escProtocol")} description={tr("communicationProtocolBetweenFCAnd")}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Select label={tr("protocol")} options={ol(ESC_PROTOCOLS)} value={String(escProtocol)} onChange={(v) => set("BF_MOTOR_PWM_PROTOCOL", v)} />
              {isPwmLike && <Input label={tr("pwmRate")} type="number" step="10" min="50" max="32000" unit="Hz" value={p("BF_MOTOR_PWM_RATE", "480")} onChange={(e) => set("BF_MOTOR_PWM_RATE", e.target.value)} />}
            </div>
            {isDshot && <p className="text-[10px] text-status-success mt-1">{tr("dshotIsADigitalProtocol")}</p>}
          </FcSection>

          <FcSection icon={<Gauge size={14} />} title={tr("throttle")} description={tr("motorThrottleRangeAndIdle")}>
            <div className="grid grid-cols-2 gap-4">
              <Input label={tr("minThrottle")} type="number" step="10" min="1000" max="2000" unit={"\u00B5s"} value={p("BF_MOTOR_MIN_THROTTLE", "1070")} onChange={(e) => set("BF_MOTOR_MIN_THROTTLE", e.target.value)} />
              <Input label={tr("maxThrottle")} type="number" step="10" min="1000" max="2000" unit={"\u00B5s"} value={p("BF_MOTOR_MAX_THROTTLE", "2000")} onChange={(e) => set("BF_MOTOR_MAX_THROTTLE", e.target.value)} />
              <Input label={tr("minCommand")} type="number" step="10" min="0" max="2000" unit={"\u00B5s"} value={p("BF_MOTOR_MIN_COMMAND", "1000")} onChange={(e) => set("BF_MOTOR_MIN_COMMAND", e.target.value)} />
              <div>
                <Input label={`Idle (${idleDisplay}%)`} type="number" step="10" min="0" max="3000" value={String(idleRaw)}
                  onChange={(e) => setLocalValue("BF_MOTOR_IDLE_PCT", Number(e.target.value) || 0)} />
                <p className="text-[9px] text-text-tertiary mt-0.5">Value x100 (550 = 5.50%)</p>
              </div>
            </div>
          </FcSection>

          <FcSection icon={<AlertTriangle size={14} />} title={tr("motorTest")} description={tr("testIndividualMotorsDISARMEDState")}>
            <BfMotorTest connected={connected} />
          </FcSection>

          {isDshot && (
            <FcSection icon={<Radio size={14} />} title={tr("dshotCommands")} description={tr("beaconSpinDirectionAnd3D")}>
              <BfDshotCommands connected={connected} />
            </FcSection>
          )}

          <FcSection icon={<Timer size={14} />} title={tr("timing")} description={tr("gyroAndPIDLoopRate")}>
            <div className="grid grid-cols-2 gap-4">
              <Input label={tr("gyroSyncDenom")} type="number" step="1" min="1" max="32" value={p("BF_GYRO_SYNC_DENOM", "1")} onChange={(e) => set("BF_GYRO_SYNC_DENOM", e.target.value)} />
              <Input label={tr("pidProcessDenom")} type="number" step="1" min="1" max="16" value={p("BF_PID_PROCESS_DENOM", "1")} onChange={(e) => set("BF_PID_PROCESS_DENOM", e.target.value)} />
            </div>
            <div className="mt-3 p-2 bg-bg-tertiary rounded space-y-1">
              <div className="flex justify-between text-xs"><span className="text-text-secondary">{tr("gyroSampleRateFC")}</span><span className="font-mono text-text-primary">{gyroRateHz ? formatRate(gyroRateHz) : "\u2014"}</span></div>
              <div className="flex justify-between text-xs"><span className="text-text-secondary">{tr("effectivePIDLoop")}</span><span className="font-mono text-accent-primary font-bold">{effectivePidRate ? formatRate(effectivePidRate) : "\u2014"}</span></div>
              {!gyroRateHz && <p className="text-[10px] text-text-tertiary">{tr("theFlightControllerDidNot")}</p>}
            </div>
          </FcSection>

          <PanelSaveBar
            onSave={handleSave}
            saving={saving}
            saveDisabled={!hasDirty || !connected}
            showFlash={hasRamWrites}
            onFlash={handleFlash}
            flashing={flashing}
            showConnectHint={!connected}
            showUnsavedHint={hasDirty && connected}
          />
        </div>
      </div>
    </ArmedWarningBanner>
  );
}
