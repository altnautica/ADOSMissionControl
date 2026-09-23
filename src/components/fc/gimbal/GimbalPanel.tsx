"use client";

import { useState, useCallback } from "react";
import { usePanelParams } from "@/hooks/use-panel-params";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { useDroneManager } from "@/stores/drone-manager";
import { useParamLabel } from "@/hooks/use-param-label";
import { useParamMetadataMap } from "@/hooks/use-param-metadata";
import { useTelemetryStore } from "@/stores/telemetry-store";
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
import {
  GIMBAL_PARAMS, OPTIONAL_GIMBAL_PARAMS,
  RC_INPUT_CHANNEL_OPTIONS, MNT_TYPE_OPTIONS, MNT_MODE_OPTIONS,
  GimbalCard, LiveStat,
} from "./gimbal-constants";

export function GimbalPanel() {
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
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

  const gimbalBuffer = useTelemetryStore((s) => s.gimbal);
  const latestGimbal = gimbalBuffer.latest();

  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded,
    refresh, setLocalValue, saveAllToRam, commitToFlash,
  } = usePanelParams({ paramNames: GIMBAL_PARAMS, optionalParams: OPTIONAL_GIMBAL_PARAMS, panelId: "gimbal" });
  useUnsavedGuard(dirtyParams.size > 0);

  const connected = !!getSelectedProtocol();
  const hasDirty = dirtyParams.size > 0;
  const mountEnabled = (params.get("MNT1_TYPE") ?? 0) !== 0;

  const p = (name: string, fallback = "0") => String(params.get(name) ?? fallback);
  const set = (name: string, v: string) => setLocalValue(name, Number(v) || 0);

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

  const handleCenter = useCallback(() => { setManualPitch(0); setManualYaw(0); }, []);

  async function handleSetMountMode() {
    const protocol = getSelectedProtocol();
    if (!protocol?.setGimbalMode) return;
    setModeSending(true);
    const result = await protocol.setGimbalMode(Number(liveMode));
    setModeSending(false);
    if (result.success) toast("Mount mode set", "success");
    else toast(result.message || "Failed to set mount mode", "error");
  }

  async function handleSetROI() {
    const protocol = getSelectedProtocol();
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

          {isPx4 && <p className="text-xs text-text-tertiary mb-3">PX4 uses MNT_MODE_IN for gimbal mode. Parameters mapped from ArduPilot equivalents.</p>}

          <GimbalCard icon={<Move3D size={14} />} title="Gimbal Configuration" description="Mount type and default behavior">
            <Select label={lbl("MNT1_TYPE — Mount Type")} options={MNT_TYPE_OPTIONS} value={p("MNT1_TYPE")} onChange={(v) => set("MNT1_TYPE", v)} />
            {mountEnabled && <Select label={lbl("MNT1_DEFLT_MODE — Default Mode")} options={MNT_MODE_OPTIONS} value={p("MNT1_DEFLT_MODE", "3")} onChange={(v) => set("MNT1_DEFLT_MODE", v)} />}
          </GimbalCard>

          {mountEnabled && (
            <GimbalCard icon={<Move3D size={14} />} title="Axis Limits" description="Min/max angles for each axis">
              <div className="space-y-4">
                {[
                  { axis: "Pitch", min: "MNT1_PITCH_MIN", minDef: "-90", max: "MNT1_PITCH_MAX", maxDef: "0" },
                  { axis: "Roll", min: "MNT1_ROLL_MIN", minDef: "-45", max: "MNT1_ROLL_MAX", maxDef: "45" },
                  { axis: "Yaw", min: "MNT1_YAW_MIN", minDef: "-180", max: "MNT1_YAW_MAX", maxDef: "180" },
                ].map(({ axis, min, minDef, max, maxDef }) => (
                  <div key={axis}>
                    <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">{axis}</span>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                      <Input label="Min" type="number" step="1" unit="°" value={p(min, minDef)} onChange={(e) => set(min, e.target.value)} />
                      <Input label="Max" type="number" step="1" unit="°" value={p(max, maxDef)} onChange={(e) => set(max, e.target.value)} />
                    </div>
                  </div>
                ))}
                <Input label={lbl("MNT1_RC_RATE — RC Rate")} type="number" step="1" min="0" unit="deg/s" value={p("MNT1_RC_RATE", "90")} onChange={(e) => set("MNT1_RC_RATE", e.target.value)} />
              </div>
            </GimbalCard>
          )}

          {mountEnabled && (
            <GimbalCard icon={<Move3D size={14} />} title="RC Input" description="Map RC channels to gimbal axis control">
              <div className="space-y-3">
                <Select label={lbl("MNT1_RC_IN_TILT — Tilt (Pitch) Input Channel")} options={RC_INPUT_CHANNEL_OPTIONS} value={p("MNT1_RC_IN_TILT", "0")} onChange={(v) => set("MNT1_RC_IN_TILT", v)} />
                <Select label={lbl("MNT1_RC_IN_ROLL — Roll Input Channel")} options={RC_INPUT_CHANNEL_OPTIONS} value={p("MNT1_RC_IN_ROLL", "0")} onChange={(v) => set("MNT1_RC_IN_ROLL", v)} />
                <Select label={lbl("MNT1_RC_IN_PAN — Pan (Yaw) Input Channel")} options={RC_INPUT_CHANNEL_OPTIONS} value={p("MNT1_RC_IN_PAN", "0")} onChange={(v) => set("MNT1_RC_IN_PAN", v)} />
                <p className="text-[10px] text-text-tertiary">Assign RC channels (5-16) to control gimbal axes. Set to 0 to disable. Requires mount mode RC Targeting (mode 3).</p>
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
                <div className="flex-1"><Select label="Active Mode" options={MNT_MODE_OPTIONS} value={liveMode} onChange={setLiveMode} /></div>
                <Button size="sm" onClick={handleSetMountMode} loading={modeSending}><Settings2 size={12} className="mr-1" /> Set Mode</Button>
              </div>
            </GimbalCard>
          )}

          {mountEnabled && (
            <GimbalCard icon={<Move3D size={14} />} title="Manual Control" description="Direct gimbal control sliders">
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1"><span className="text-xs text-text-secondary">Pitch</span><span className="text-xs font-mono text-text-tertiary">{manualPitch}°</span></div>
                  <input type="range" min={Number(p("MNT1_PITCH_MIN", "-90"))} max={Number(p("MNT1_PITCH_MAX", "0"))} value={manualPitch} onChange={(e) => setManualPitch(Number(e.target.value))} className="w-full h-1.5 bg-bg-tertiary rounded-full appearance-none cursor-pointer accent-accent-primary" />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1"><span className="text-xs text-text-secondary">Yaw</span><span className="text-xs font-mono text-text-tertiary">{manualYaw}°</span></div>
                  <input type="range" min={Number(p("MNT1_YAW_MIN", "-180"))} max={Number(p("MNT1_YAW_MAX", "180"))} value={manualYaw} onChange={(e) => setManualYaw(Number(e.target.value))} className="w-full h-1.5 bg-bg-tertiary rounded-full appearance-none cursor-pointer accent-accent-primary" />
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
