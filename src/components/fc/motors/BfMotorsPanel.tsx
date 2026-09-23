"use client";

import { useState } from "react";
import { usePanelParams } from "@/hooks/use-panel-params";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { useDroneManager } from "@/stores/drone-manager";
import { useToast } from "@/components/ui/toast";
import { useFlashCommitToast } from "@/hooks/use-flash-commit-toast";
import { usePanelScroll } from "@/hooks/use-panel-scroll";
import { ArmedLockOverlay } from "@/components/indicators/ArmedLockOverlay";
import { PanelHeader } from "../shared/PanelHeader";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Cog, Save, HardDrive, AlertTriangle, Gauge, Timer, Zap, Radio } from "lucide-react";
import { BfMotorTest } from "./BfMotorTest";
import { BfDshotCommands } from "../betaflight/BfDshotCommands";
import { ESC_PROTOCOLS, isDshotProtocol, usesPwmRate } from "./bf-motor-protocols";
import { BF_MOTORS_PARAM_NAMES as PARAM_NAMES } from "./bf-motors-constants";

// ── Card Component ───────────────────────────────────────────

function Card({ icon, title, description, children }: {
  icon: React.ReactNode; title: string; description: string; children: React.ReactNode;
}) {
  return (
    <div className="border border-border-default bg-bg-secondary p-4 space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-accent-primary">{icon}</span>
        <div>
          <h2 className="text-sm font-medium text-text-primary">{title}</h2>
          <p className="text-[10px] text-text-tertiary">{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

// ── Component ────────────────────────────────────────────────

export function BfMotorsPanel() {
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const { toast } = useToast();
  const { showFlashResult } = useFlashCommitToast();
  const scrollRef = usePanelScroll("bf-motors");
  const [saving, setSaving] = useState(false);

  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded, refresh, setLocalValue, saveAllToRam, commitToFlash,
  } = usePanelParams({ paramNames: PARAM_NAMES, panelId: "bf-motors", autoLoad: true });
  useUnsavedGuard(dirtyParams.size > 0);

  const connected = !!getSelectedProtocol();
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
  const gyroRateHz = getSelectedProtocol()?.getVehicleInfo()?.gyroSampleRateHz;
  const effectivePidRate = gyroRateHz ? gyroRateHz / Math.max(1, pidDenom) : undefined;

  const formatRate = (hz: number) => hz >= 1000 ? `${(hz / 1000).toFixed(1)}kHz` : `${Math.round(hz)}Hz`;

  async function handleSave() {
    setSaving(true);
    const ok = await saveAllToRam();
    setSaving(false);
    if (ok) toast("Saved to flight controller", "success");
    else toast("Some parameters failed to save", "warning");
  }

  async function handleFlash() {
    const ok = await commitToFlash();
    showFlashResult(ok, { successMessage: "Written to flash" });
  }

  return (
    <ArmedLockOverlay>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl space-y-6">
          <PanelHeader title="Motors & ESC" subtitle="Motor configuration, ESC protocol, and motor testing"
            icon={<Cog size={16} />} loading={loading} loadProgress={loadProgress}
            hasLoaded={hasLoaded} onRead={refresh} connected={connected} error={error} />

          <Card icon={<Zap size={14} />} title="ESC Protocol" description="Communication protocol between FC and ESCs">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Select label="Protocol" options={ESC_PROTOCOLS} value={String(escProtocol)} onChange={(v) => set("BF_MOTOR_PWM_PROTOCOL", v)} />
              {isPwmLike && <Input label="PWM Rate" type="number" step="10" min="50" max="32000" unit="Hz" value={p("BF_MOTOR_PWM_RATE", "480")} onChange={(e) => set("BF_MOTOR_PWM_RATE", e.target.value)} />}
            </div>
            {isDshot && <p className="text-[10px] text-status-success mt-1">DShot is a digital protocol. PWM rate setting does not apply.</p>}
          </Card>

          <Card icon={<Gauge size={14} />} title="Throttle" description="Motor throttle range and idle settings">
            <div className="grid grid-cols-2 gap-4">
              <Input label="Min Throttle" type="number" step="10" min="1000" max="2000" unit={"\u00B5s"} value={p("BF_MOTOR_MIN_THROTTLE", "1070")} onChange={(e) => set("BF_MOTOR_MIN_THROTTLE", e.target.value)} />
              <Input label="Max Throttle" type="number" step="10" min="1000" max="2000" unit={"\u00B5s"} value={p("BF_MOTOR_MAX_THROTTLE", "2000")} onChange={(e) => set("BF_MOTOR_MAX_THROTTLE", e.target.value)} />
              <Input label="Min Command" type="number" step="10" min="0" max="2000" unit={"\u00B5s"} value={p("BF_MOTOR_MIN_COMMAND", "1000")} onChange={(e) => set("BF_MOTOR_MIN_COMMAND", e.target.value)} />
              <div>
                <Input label={`Idle (${idleDisplay}%)`} type="number" step="10" min="0" max="3000" value={String(idleRaw)}
                  onChange={(e) => setLocalValue("BF_MOTOR_IDLE_PCT", Number(e.target.value) || 0)} />
                <p className="text-[9px] text-text-tertiary mt-0.5">Value x100 (550 = 5.50%)</p>
              </div>
            </div>
          </Card>

          <Card icon={<AlertTriangle size={14} />} title="Motor Test" description="Test individual motors. DISARMED state required.">
            <BfMotorTest connected={connected} />
          </Card>

          {isDshot && (
            <Card icon={<Radio size={14} />} title="DShot Commands" description="Beacon, spin direction, and 3D mode. DISARMED state required.">
              <BfDshotCommands connected={connected} />
            </Card>
          )}

          <Card icon={<Timer size={14} />} title="Timing" description="Gyro and PID loop rate configuration">
            <div className="grid grid-cols-2 gap-4">
              <Input label="Gyro Sync Denom" type="number" step="1" min="1" max="32" value={p("BF_GYRO_SYNC_DENOM", "1")} onChange={(e) => set("BF_GYRO_SYNC_DENOM", e.target.value)} />
              <Input label="PID Process Denom" type="number" step="1" min="1" max="16" value={p("BF_PID_PROCESS_DENOM", "1")} onChange={(e) => set("BF_PID_PROCESS_DENOM", e.target.value)} />
            </div>
            <div className="mt-3 p-2 bg-bg-tertiary rounded space-y-1">
              <div className="flex justify-between text-xs"><span className="text-text-secondary">Gyro sample rate (FC)</span><span className="font-mono text-text-primary">{gyroRateHz ? formatRate(gyroRateHz) : "\u2014"}</span></div>
              <div className="flex justify-between text-xs"><span className="text-text-secondary">Effective PID loop</span><span className="font-mono text-accent-primary font-bold">{effectivePidRate ? formatRate(effectivePidRate) : "\u2014"}</span></div>
              {!gyroRateHz && <p className="text-[10px] text-text-tertiary">The flight controller did not report its gyro rate (needs MSP API 1.43+).</p>}
            </div>
          </Card>

          <div className="flex items-center gap-3 pt-2 pb-4">
            <Button variant="primary" size="lg" icon={<Save size={14} />} disabled={!hasDirty || !connected} loading={saving} onClick={handleSave}>Save to Flight Controller</Button>
            {hasRamWrites && <Button variant="secondary" size="lg" icon={<HardDrive size={14} />} onClick={handleFlash}>Write to Flash</Button>}
            {!connected && <span className="text-[10px] text-text-tertiary">Connect a drone to save parameters</span>}
            {hasDirty && connected && <span className="text-[10px] text-status-warning">Unsaved changes</span>}
          </div>
        </div>
      </div>
    </ArmedLockOverlay>
  );
}
