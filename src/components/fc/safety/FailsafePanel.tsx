"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useFlashCommitToast } from "@/hooks/use-flash-commit-toast";
import { useDroneManager, selectSelectedDrone, selectSelectedProtocol } from "@/stores/drone-manager";
import { usePanelParams } from "@/hooks/use-panel-params";
import { useFirmwareCapabilities } from "@/hooks/use-firmware-capabilities";
import { useParamLabel } from "@/hooks/use-param-label";
import { useParamMetadataMap } from "@/hooks/use-param-metadata";
import { usePanelScroll } from "@/hooks/use-panel-scroll";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { PanelHeader } from "../shared/PanelHeader";
import { ParamEnumSelect, useParamEnums } from "../shared/ParamEnumSelect";
import { ParamFieldLabel } from "../parameters/ParamFieldLabel";
import { ArmedWarningBanner } from "@/components/indicators/ArmedWarningBanner";
import { ShieldAlert, Battery, Radio, Gauge, Save, HardDrive, MapPin, SlidersHorizontal, Mountain } from "lucide-react";
import { StarredParam } from "../parameters/ParamStar";
import { FenceEnableToggle, FenceTypeBits } from "./geofence-components";
import {
  FS_OPTION_BITS, COPTER_FS_PARAMS, PLANE_FS_PARAMS,
  PLANE_FS_OPTIONAL_PARAMS, AP_SHARED_FS_PARAMS, PX4_FS_PARAMS, RC_CHANNEL_COUNT,
} from "./failsafe-constants";

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

const EMPTY: string[] = [];

export function FailsafePanel() {
  const selectedProtocol = useDroneManager(selectSelectedProtocol);
  const selectedDrone = useDroneManager(selectSelectedDrone);
  const { toast } = useToast();
  const { showFlashResult } = useFlashCommitToast();
  const { label: pl } = useParamLabel();
  const metadata = useParamMetadataMap();
  const { enumValues } = useParamEnums(metadata);
  const lbl = (raw: string) => <ParamFieldLabel raw={pl(raw)} metadata={metadata} />;
  const scrollRef = usePanelScroll("failsafe");
  const [saving, setSaving] = useState(false);

  const drone = selectedDrone;
  const isPlane = useMemo(() => {
    const vc = drone?.vehicleInfo?.vehicleClass;
    return vc === "plane" || vc === "vtol";
  }, [drone?.vehicleInfo?.vehicleClass]);

  const { firmwareType } = useFirmwareCapabilities();
  const isPx4 = firmwareType === 'px4';
  const isArduPilot = !isPx4;
  const isApPlane = isArduPilot && isPlane;
  const isApCopter = isArduPilot && !isPlane;

  const paramNames = useMemo(
    () => isPx4 ? PX4_FS_PARAMS
      : [...AP_SHARED_FS_PARAMS, ...(isPlane ? PLANE_FS_PARAMS : COPTER_FS_PARAMS)],
    [isPlane, isPx4],
  );
  const optionalParams = isApPlane ? PLANE_FS_OPTIONAL_PARAMS : EMPTY;

  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded, missingOptional,
    refresh, setLocalValue, saveAllToRam, commitToFlash,
  } = usePanelParams({ paramNames, optionalParams, panelId: "failsafe", autoLoad: true });
  useUnsavedGuard(dirtyParams.size > 0);

  const connected = !!selectedProtocol;
  const hasDirty = dirtyParams.size > 0;

  const p = (name: string, fallback = "0") => String(params.get(name) ?? fallback);
  const set = (name: string, v: string) => setLocalValue(name, Number(v) || 0);
  const enumField = (name: string, text: string) => (
    <StarredParam param={name}>
      <ParamEnumSelect label={lbl(`${name} — ${text}`)} values={enumValues(name)}
        value={params.get(name) ?? 0} onChange={(v) => setLocalValue(name, v)} />
    </StarredParam>
  );

  async function handleSave() {
    setSaving(true);
    const ok = await saveAllToRam();
    setSaving(false);
    if (ok) toast("Saved to flight controller", "success");
    else toast("Some parameters failed to save", "warning");
  }

  async function handleFlash() {
    showFlashResult(await commitToFlash());
  }

  return (
    <ArmedWarningBanner>
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-6">
        <PanelHeader title="Failsafe Configuration" subtitle="Configure failsafe actions for loss of control, battery, and GCS link"
          loading={loading} loadProgress={loadProgress} hasLoaded={hasLoaded} onRead={refresh}
          connected={connected} error={error} missingOptional={missingOptional} />

        {isApCopter && <Card icon={<Gauge size={14} />} title="Radio Failsafe" description="Triggered when the RC throttle channel drops below the threshold or the receiver is lost">
          {enumField("FS_THR_ENABLE", "Radio Failsafe Action")}
          <StarredParam param="FS_THR_VALUE"><Input label={lbl("FS_THR_VALUE — Throttle PWM Threshold")} type="number" step="1" min="800" max="1200" unit={"\u03BCs"} value={p("FS_THR_VALUE", "975")} onChange={(e) => set("FS_THR_VALUE", e.target.value)} /></StarredParam>
          <p className="text-[10px] text-text-tertiary">When throttle PWM drops below this value, the radio failsafe action triggers. Set this ~10{"\u03BCs"} below your RC transmitter&apos;s minimum throttle output.</p>
        </Card>}

        {isApPlane && <Card icon={<ShieldAlert size={14} />} title="Short Failsafe" description="Triggered on brief signal loss">
          {enumField("FS_SHORT_ACTN", "Action")}
          {params.has("FS_SHORT_TIMEOUT") && <StarredParam param="FS_SHORT_TIMEOUT"><Input label={lbl("FS_SHORT_TIMEOUT — Timeout (s)")} type="number" step="0.1" min="0" unit="s" value={p("FS_SHORT_TIMEOUT", "1.5")} onChange={(e) => set("FS_SHORT_TIMEOUT", e.target.value)} /></StarredParam>}
          {params.has("RC_FS_TIMEOUT") && <StarredParam param="RC_FS_TIMEOUT"><Input label={lbl("RC_FS_TIMEOUT — RC Failsafe Timeout (s)")} type="number" step="0.1" min="0.1" max="10" unit="s" value={p("RC_FS_TIMEOUT")} onChange={(e) => setLocalValue("RC_FS_TIMEOUT", Number(e.target.value))} /></StarredParam>}
        </Card>}

        {isApPlane && <Card icon={<ShieldAlert size={14} />} title="Long Failsafe" description="Triggered on extended signal loss">
          {enumField("FS_LONG_ACTN", "Action")}
          <StarredParam param="FS_LONG_TIMEOUT"><Input label={lbl("FS_LONG_TIMEOUT — Timeout (s)")} type="number" step="0.1" min="0" unit="s" value={p("FS_LONG_TIMEOUT", "5.0")} onChange={(e) => set("FS_LONG_TIMEOUT", e.target.value)} /></StarredParam>
        </Card>}

        {isApPlane && <Card icon={<Gauge size={14} />} title="Throttle Failsafe" description="Triggered on RC throttle loss">
          {enumField("THR_FAILSAFE", "Throttle Failsafe")}
          <Input label={lbl("THR_FS_VALUE — Throttle PWM value")} type="number" step="1" min="800" max="1200" unit={"\u03BCs"} value={p("THR_FS_VALUE", "950")} onChange={(e) => set("THR_FS_VALUE", e.target.value)} />
        </Card>}

        {isArduPilot && <Card icon={<Battery size={14} />} title="Battery Failsafe" description="Triggered on low battery voltage">
          {enumField("BATT_FS_VOLTSRC", "Voltage Source")}
          <StarredParam param="BATT_FS_LOW_VOLT"><Input label={lbl("BATT_FS_LOW_VOLT — Low Voltage Threshold")} type="number" step="0.1" min="0" unit="V" value={p("BATT_FS_LOW_VOLT")} onChange={(e) => set("BATT_FS_LOW_VOLT", e.target.value)} /></StarredParam>
          {enumField("BATT_FS_LOW_ACT", "Low Voltage Action")}
        </Card>}

        {/* PX4 has one battery failsafe action (COM_LOW_BAT_ACT) with its own
            enum; the canonical BATT_FS_LOW_ACT name maps onto it. Its
            thresholds are remaining-charge fractions, not volts. */}
        {isPx4 && <Card icon={<Battery size={14} />} title="Battery Failsafe (PX4)" description="Action on low and critical battery">
          <StarredParam param="BATT_FS_LOW_VOLT"><Input label={lbl("BATT_FS_LOW_VOLT — Low Threshold")} type="number" step="0.01" min="0.12" max="0.5" unit="fraction" value={p("BATT_FS_LOW_VOLT")} onChange={(e) => set("BATT_FS_LOW_VOLT", e.target.value)} /></StarredParam>
          <p className="text-[10px] text-text-tertiary">Fraction of charge remaining (0.15 = 15 % left), not volts.</p>
          {enumField("BATT_FS_LOW_ACT", "Battery Failsafe Action")}
        </Card>}

        {isApCopter && <Card icon={<Radio size={14} />} title="GCS Failsafe" description="Triggered on GCS link loss">
          {enumField("FS_GCS_ENABLE", "GCS Failsafe Action")}
          <StarredParam param="FS_GCS_TIMEOUT"><Input label={lbl("FS_GCS_TIMEOUT — Timeout")} type="number" step="1" min="2" max="120" unit="s" value={p("FS_GCS_TIMEOUT", "5")} onChange={(e) => set("FS_GCS_TIMEOUT", e.target.value)} /></StarredParam>
        </Card>}

        {isApPlane && <Card icon={<Radio size={14} />} title="GCS Failsafe" description="Triggered on GCS link loss">
          {enumField("FS_GCS_ENABL", "GCS Failsafe")}
        </Card>}

        {isApCopter && <Card icon={<ShieldAlert size={14} />} title="EKF & Crash Failsafe" description="Triggered on navigation variance or a detected crash">
          {enumField("FS_EKF_ACTION", "EKF Failsafe Action")}
          {enumField("FS_CRASH_CHECK", "Crash Check")}
        </Card>}

        {isArduPilot && params.has("TERRAIN_ENABLE") && <Card icon={<Mountain size={14} />} title="Terrain Failsafe" description="Triggered when terrain data is unavailable during terrain-following">
          {enumField("TERRAIN_ENABLE", "Terrain Following")}
        </Card>}

        {isApCopter && params.has("FS_OPTIONS") && <Card icon={<ShieldAlert size={14} />} title="Failsafe Options" description="FS_OPTIONS bitmask — additional failsafe behaviors">
          <div className="space-y-1.5">
            {FS_OPTION_BITS.map((bit) => {
              const current = Number(params.get("FS_OPTIONS") ?? 0);
              const isSet = (current & bit.mask) !== 0;
              return (
                <label key={bit.mask} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={isSet} onChange={() => set("FS_OPTIONS", String(current ^ bit.mask))} className="accent-accent-primary" />
                  <span className="text-xs text-text-secondary">{bit.label}</span>
                </label>
              );
            })}
          </div>
          <p className="text-[10px] font-mono text-text-tertiary mt-2">FS_OPTIONS = {Number(params.get("FS_OPTIONS") ?? 0)} (0x{(Number(params.get("FS_OPTIONS") ?? 0)).toString(16).padStart(4, "0")})</p>
        </Card>}

        {isArduPilot && <Card icon={<SlidersHorizontal size={14} />} title="RC Channel Options" description="Per-channel RC switch functions (RCn_OPTION)">
          <div className="space-y-2">
            {Array.from({ length: RC_CHANNEL_COUNT }, (_, i) => {
              const ch = i + 1;
              const paramName = `RC${ch}_OPTION`;
              return (
                <div key={ch} className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-text-secondary w-6 text-right">CH{ch}</span>
                  <div className="flex-1 min-w-0">
                    <ParamEnumSelect values={enumValues(paramName)} value={params.get(paramName) ?? 0} onChange={(v) => setLocalValue(paramName, v)} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>}

        {/* ArduPilot geofence: FENCE_ENABLE is a 0/1 switch and the fence
            types are the FENCE_TYPE bitmask. NOT rendered for PX4, whose
            canonical FENCE_ENABLE maps to GF_ACTION (a breach action enum);
            PX4 gets its own card below. */}
        {isArduPilot && <Card icon={<MapPin size={14} />} title="Geofence" description="Geographical boundary enforcement">
          <FenceEnableToggle label={pl("FENCE_ENABLE")} enabled={(params.get("FENCE_ENABLE") ?? 0) !== 0} onChange={(v) => setLocalValue("FENCE_ENABLE", v)} />
          <FenceTypeBits value={params.get("FENCE_TYPE") ?? 0} onChange={(v) => setLocalValue("FENCE_TYPE", v)} />
          {enumField("FENCE_ACTION", "Breach Action")}
          <Input label={lbl("FENCE_ALT_MAX — Max Altitude")} type="number" step="1" min="0" unit="m" value={p("FENCE_ALT_MAX", "100")} onChange={(e) => set("FENCE_ALT_MAX", e.target.value)} />
          <Input label={lbl("FENCE_RADIUS — Max Radius")} type="number" step="1" min="0" unit="m" value={p("FENCE_RADIUS", "300")} onChange={(e) => set("FENCE_RADIUS", e.target.value)} />
          <Input label={lbl("FENCE_ALT_MIN — Min Altitude")} type="number" step="0.5" min="-100" unit="m" value={p("FENCE_ALT_MIN")} onChange={(e) => set("FENCE_ALT_MIN", e.target.value)} />
        </Card>}

        {isPx4 && <Card icon={<MapPin size={14} />} title="Geofence (PX4)" description="PX4 geofence action and limits">
          {/* GF_ACTION, PX4's own breach-action enum from the vehicle's
              metadata. Value 4 is Flight Termination (motors off). */}
          {enumField("FENCE_ENABLE", "Breach Action")}
          <Input label={lbl("FENCE_ALT_MAX — Max Altitude")} type="number" step="1" min="0" unit="m" value={p("FENCE_ALT_MAX", "100")} onChange={(e) => set("FENCE_ALT_MAX", e.target.value)} />
          <Input label={lbl("FENCE_RADIUS — Max Radius")} type="number" step="1" min="0" unit="m" value={p("FENCE_RADIUS", "300")} onChange={(e) => set("FENCE_RADIUS", e.target.value)} />
        </Card>}

        {isPx4 && hasLoaded && (
          <section className="border-t border-border-strong pt-4 mt-4">
            <h3 className="text-sm font-medium text-text-secondary mb-3 flex items-center gap-2"><Gauge size={14} /> EKF Position Failsafe (PX4)</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><label className="text-xs text-text-secondary mb-1 block">Max EPH (m)</label><Input type="number" step={0.5} min={-1} max={400} value={p("COM_POS_FS_EPH", "5")} onChange={(e) => set("COM_POS_FS_EPH", e.target.value)} className="h-8 text-xs" /></div>
              <div><label className="text-xs text-text-secondary mb-1 block">Max EVH (m/s)</label><Input type="number" step={0.5} min={0} max={10} value={p("COM_VEL_FS_EVH", "1")} onChange={(e) => set("COM_VEL_FS_EVH", e.target.value)} className="h-8 text-xs" /></div>
            </div>
          </section>
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
