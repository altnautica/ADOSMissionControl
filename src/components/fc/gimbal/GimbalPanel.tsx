"use client";

import { useState, useCallback } from "react";
import { usePanelParams } from "@/hooks/use-panel-params";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { useParamLabel } from "@/hooks/use-param-label";
import { useParamMetadataMap } from "@/hooks/use-param-metadata";
import { useFreshTelemetry } from "@/hooks/use-telemetry-latest";
import { useToast } from "@/components/ui/toast";
import { useFlashCommitToast } from "@/hooks/use-flash-commit-toast";
import { ArmedWarningBanner } from "@/components/indicators/ArmedWarningBanner";
import { PanelHeader } from "../shared/PanelHeader";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Move3D, Save, HardDrive, Crosshair, RotateCcw, MapPin, Settings2 } from "lucide-react";
import { ParamFieldLabel } from "../parameters/ParamFieldLabel";
import { useFirmwareCapabilities } from "@/hooks/use-firmware-capabilities";
import { withCurrent } from "../frame/enum-options";
import {
  GIMBAL_PARAMS, OPTIONAL_GIMBAL_PARAMS,
  RC_INPUT_CHANNEL_OPTIONS, PX4_MAN_INPUT_OPTIONS,
  MNT_TYPE_OPTIONS, PX4_MNT_MODE_IN_OPTIONS, MNT_MODE_OPTIONS,
  GimbalCard, LiveStat,
} from "./gimbal-constants";

const AXIS_LIMITS = [
  { axis: "Pitch", min: "MNT1_PITCH_MIN", max: "MNT1_PITCH_MAX" },
  { axis: "Roll", min: "MNT1_ROLL_MIN", max: "MNT1_ROLL_MAX" },
  { axis: "Yaw", min: "MNT1_YAW_MIN", max: "MNT1_YAW_MAX" },
] as const;

const RC_INPUTS = [
  { param: "MNT1_RC_IN_TILT", label: "Tilt (Pitch) Input" },
  { param: "MNT1_RC_IN_ROLL", label: "Roll Input" },
  { param: "MNT1_RC_IN_PAN", label: "Pan (Yaw) Input" },
] as const;

export function GimbalPanel() {
  const protocol = useDroneManager(selectSelectedProtocol);
  const { toast } = useToast();
  const { showFlashResult } = useFlashCommitToast();
  const { firmwareType } = useFirmwareCapabilities();
  const isPx4 = firmwareType === "px4";
  const { label: pl } = useParamLabel();
  const metadata = useParamMetadataMap();
  const lbl = (raw: string) => <ParamFieldLabel raw={pl(raw)} metadata={metadata} />;
  const [saving, setSaving] = useState(false);
  const [manualPitch, setManualPitch] = useState(0);
  const [manualYaw, setManualYaw] = useState(0);
  const [roiLat, setRoiLat] = useState("");
  const [roiLon, setRoiLon] = useState("");
  const [roiAlt, setRoiAlt] = useState("0");
  const [roiSending, setRoiSending] = useState(false);
  const [liveMode, setLiveMode] = useState("2");
  const [modeSending, setModeSending] = useState(false);

  // Hidden once the gimbal attitude stops arriving, never frozen on screen.
  const latestGimbal = useFreshTelemetry("gimbal");

  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded,
    refresh, setLocalValue, saveAllToRam, commitToFlash,
  } = usePanelParams({ paramNames: GIMBAL_PARAMS, optionalParams: OPTIONAL_GIMBAL_PARAMS, panelId: "gimbal" });
  useUnsavedGuard(dirtyParams.size > 0);

  const connected = protocol !== null;
  const hasDirty = dirtyParams.size > 0;
  // ArduPilot MNT1_TYPE 0 is "None"; PX4's MNT_MODE_IN (mapped from MNT1_TYPE)
  // disables the mount with -1 and uses 0 for Auto.
  const mountType = params.get("MNT1_TYPE");
  const mountEnabled = mountType !== undefined && mountType !== (isPx4 ? -1 : 0);
  const rcInputOptions = isPx4 ? PX4_MAN_INPUT_OPTIONS : RC_INPUT_CHANNEL_OPTIONS;
  const hasRcInputs = RC_INPUTS.some(({ param }) => params.has(param));

  const p = (name: string) => String(params.get(name) ?? "");
  const set = (name: string, v: string) => setLocalValue(name, Number(v) || 0);

  // Manual aim range: the mount's configured limits when reported, else the
  // full mechanical range the command accepts.
  const pitchMin = params.get("MNT1_PITCH_MIN") ?? -90;
  const pitchMax = params.get("MNT1_PITCH_MAX") ?? 90;
  const yawMin = params.get("MNT1_YAW_MIN") ?? -180;
  const yawMax = params.get("MNT1_YAW_MAX") ?? 180;

  async function handleSave() {
    setSaving(true);
    const ok = await saveAllToRam();
    setSaving(false);
    if (ok) toast("Saved to flight controller", "success");
    else toast("Some parameters failed to save", "warning");
  }

  async function handleFlash() {
    const ok = await commitToFlash();
    showFlashResult(ok);
  }

  const sendAngle = useCallback(async (pitch: number, yaw: number) => {
    if (!protocol) return;
    const result = await protocol.setGimbalAngle(pitch, 0, yaw);
    if (!result.success) toast(result.message || "Gimbal refused the angle", "error");
  }, [protocol, toast]);

  const handleCenter = useCallback(() => {
    setManualPitch(0);
    setManualYaw(0);
    void sendAngle(0, 0);
  }, [sendAngle]);

  async function handleSetMountMode() {
    if (!protocol?.setGimbalMode) return;
    setModeSending(true);
    const result = await protocol.setGimbalMode(Number(liveMode));
    setModeSending(false);
    if (result.success) toast("Mount mode set", "success");
    else toast(result.message || "Failed to set mount mode", "error");
  }

  async function handleSetROI() {
    if (!protocol?.setGimbalROI) return;
    const lat = parseFloat(roiLat);
    const lon = parseFloat(roiLon);
    const alt = parseFloat(roiAlt) || 0;
    if (isNaN(lat) || isNaN(lon)) { toast("Enter valid latitude and longitude", "warning"); return; }
    setRoiSending(true);
    const result = await protocol.setGimbalROI(lat, lon, alt);
    setRoiSending(false);
    if (result.success) toast("ROI set", "success");
    else toast(result.message || "Failed to set ROI", "error");
  }

  return (
    <ArmedWarningBanner>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl space-y-6">
          <PanelHeader title="Gimbal" subtitle="Mount type, axis limits, RC rate, and manual control" icon={<Move3D size={16} />} loading={loading} loadProgress={loadProgress} hasLoaded={hasLoaded} onRead={refresh} connected={connected} error={error} />

          {isPx4 && <p className="text-xs text-text-tertiary mb-3">PX4 uses MNT_MODE_IN for gimbal input and MNT_MAN_* for AUX control inputs.</p>}

          {params.has("MNT1_TYPE") && (
            <GimbalCard icon={<Move3D size={14} />} title="Gimbal Configuration" description="Mount type and default behavior">
              <Select
                label={lbl(isPx4 ? "MNT1_TYPE — Input Mode" : "MNT1_TYPE — Mount Type")}
                options={withCurrent(isPx4 ? PX4_MNT_MODE_IN_OPTIONS : MNT_TYPE_OPTIONS, mountType)}
                value={p("MNT1_TYPE")}
                onChange={(v) => set("MNT1_TYPE", v)}
              />
              {mountEnabled && params.has("MNT1_DEFLT_MODE") && (
                <Select label={lbl("MNT1_DEFLT_MODE — Default Mode")} options={withCurrent(MNT_MODE_OPTIONS, params.get("MNT1_DEFLT_MODE"))} value={p("MNT1_DEFLT_MODE")} onChange={(v) => set("MNT1_DEFLT_MODE", v)} />
              )}
            </GimbalCard>
          )}

          {mountEnabled && AXIS_LIMITS.some(({ min, max }) => params.has(min) || params.has(max)) && (
            <GimbalCard icon={<Move3D size={14} />} title="Axis Limits" description="Min/max angles for each axis">
              <div className="space-y-4">
                {AXIS_LIMITS.filter(({ min, max }) => params.has(min) || params.has(max)).map(({ axis, min, max }) => (
                  <div key={axis}>
                    <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">{axis}</span>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                      {params.has(min) && <Input label="Min" type="number" step="1" unit="°" value={p(min)} onChange={(e) => set(min, e.target.value)} />}
                      {params.has(max) && <Input label="Max" type="number" step="1" unit="°" value={p(max)} onChange={(e) => set(max, e.target.value)} />}
                    </div>
                  </div>
                ))}
                {params.has("MNT1_RC_RATE") && (
                  <Input label={lbl("MNT1_RC_RATE — RC Rate")} type="number" step="1" min="0" unit="deg/s" value={p("MNT1_RC_RATE")} onChange={(e) => set("MNT1_RC_RATE", e.target.value)} />
                )}
              </div>
            </GimbalCard>
          )}

          {mountEnabled && (hasRcInputs || !isPx4) && (
            <GimbalCard icon={<Move3D size={14} />} title="RC Input" description="Map RC channels to gimbal axis control">
              <div className="space-y-3">
                {RC_INPUTS.filter(({ param }) => params.has(param)).map(({ param, label }) => (
                  <Select key={param} label={lbl(`${param} — ${label}`)} options={withCurrent(rcInputOptions, params.get(param))} value={p(param)} onChange={(v) => set(param, v)} />
                ))}
                {!isPx4 && !hasRcInputs && (
                  <p className="text-[10px] text-text-tertiary">Assign the gimbal axes to RC channels on the Receiver panel: RCx_OPTION 212 (Mount1 Roll), 213 (Mount1 Pitch), 214 (Mount1 Yaw).</p>
                )}
              </div>
            </GimbalCard>
          )}

          {mountEnabled && latestGimbal && (
            <GimbalCard icon={<Crosshair size={14} />} title="Live Status" description="Current gimbal orientation">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                <LiveStat label="Pitch" value={latestGimbal.pitch.toFixed(1)} unit="°" />
                <LiveStat label="Roll" value={latestGimbal.roll.toFixed(1)} unit="°" />
                <LiveStat label="Yaw" value={latestGimbal.yaw.toFixed(1)} unit="°" />
              </div>
            </GimbalCard>
          )}

          {mountEnabled && connected && (
            <GimbalCard icon={<Settings2 size={14} />} title="Mount Mode" description="Send DO_MOUNT_CONFIGURE command to change active mode">
              <div className="flex items-end gap-3">
                <div className="flex-1"><Select label="Active Mode" options={[...MNT_MODE_OPTIONS]} value={liveMode} onChange={setLiveMode} /></div>
                <Button size="sm" onClick={handleSetMountMode} loading={modeSending}><Settings2 size={12} className="mr-1" /> Set Mode</Button>
              </div>
            </GimbalCard>
          )}

          {mountEnabled && connected && (
            <GimbalCard icon={<Move3D size={14} />} title="Manual Control" description="Aim the gimbal; the angle is sent when you release the slider">
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1"><span className="text-xs text-text-secondary">Pitch</span><span className="text-xs font-mono text-text-tertiary">{manualPitch}°</span></div>
                  <input type="range" aria-label="Gimbal pitch" min={pitchMin} max={pitchMax} value={manualPitch} onChange={(e) => setManualPitch(Number(e.target.value))} onPointerUp={() => void sendAngle(manualPitch, manualYaw)} onKeyUp={() => void sendAngle(manualPitch, manualYaw)} className="w-full h-1.5 bg-bg-tertiary rounded-full appearance-none cursor-pointer accent-accent-primary" />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1"><span className="text-xs text-text-secondary">Yaw</span><span className="text-xs font-mono text-text-tertiary">{manualYaw}°</span></div>
                  <input type="range" aria-label="Gimbal yaw" min={yawMin} max={yawMax} value={manualYaw} onChange={(e) => setManualYaw(Number(e.target.value))} onPointerUp={() => void sendAngle(manualPitch, manualYaw)} onKeyUp={() => void sendAngle(manualPitch, manualYaw)} className="w-full h-1.5 bg-bg-tertiary rounded-full appearance-none cursor-pointer accent-accent-primary" />
                </div>
                <div className="flex gap-2"><Button size="sm" variant="ghost" onClick={handleCenter}><RotateCcw size={12} className="mr-1" /> Center</Button></div>
              </div>
            </GimbalCard>
          )}

          {mountEnabled && connected && (
            <GimbalCard icon={<MapPin size={14} />} title="Set ROI" description="Point gimbal at a GPS location">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                <Input label="Latitude" type="number" step="0.000001" value={roiLat} onChange={(e) => setRoiLat(e.target.value)} placeholder="-33.8688" />
                <Input label="Longitude" type="number" step="0.000001" value={roiLon} onChange={(e) => setRoiLon(e.target.value)} placeholder="151.2093" />
                <Input label="Altitude" type="number" step="1" unit="m" value={roiAlt} onChange={(e) => setRoiAlt(e.target.value)} />
              </div>
              <Button size="sm" onClick={handleSetROI} loading={roiSending}><MapPin size={12} className="mr-1" /> Set ROI</Button>
            </GimbalCard>
          )}

          <div className="flex items-center gap-3 pt-2 pb-4">
            <Button variant="primary" size="lg" icon={<Save size={14} />} disabled={!hasDirty || !connected} loading={saving} onClick={handleSave}>Save to Flight Controller</Button>
            {hasRamWrites && <Button variant="secondary" size="lg" icon={<HardDrive size={14} />} onClick={handleFlash}>Write to Flash</Button>}
            {!connected && <span className="text-[10px] text-text-tertiary">Connect a drone to save parameters</span>}
            {hasDirty && connected && <span className="text-[10px] text-status-warning">Unsaved changes</span>}
          </div>
        </div>
      </div>
    </ArmedWarningBanner>
  );
}
