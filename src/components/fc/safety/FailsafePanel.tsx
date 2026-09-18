"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useFlashCommitToast } from "@/hooks/use-flash-commit-toast";
import { useDroneManager } from "@/stores/drone-manager";
import { usePanelParams } from "@/hooks/use-panel-params";
import { useFirmwareCapabilities } from "@/hooks/use-firmware-capabilities";
import { useParamLabel } from "@/hooks/use-param-label";
import { useParamMetadataMap } from "@/hooks/use-param-metadata";
import { usePanelScroll } from "@/hooks/use-panel-scroll";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { PanelHeader } from "../shared/PanelHeader";
import { ParamFieldLabel } from "../parameters/ParamFieldLabel";
import { ArmedLockOverlay } from "@/components/indicators/ArmedLockOverlay";
import { ShieldAlert, Battery, Radio, Gauge, Save, HardDrive, MapPin, SlidersHorizontal, Mountain } from "lucide-react";
import { StarredParam } from "../parameters/ParamStar";
import {
  BF_FAILSAFE_PARAMS, BF_FS_PROCEDURE_OPTIONS, RC_OPTION_VALUES,
  FS_OPTION_BITS, COPTER_FS_PARAMS, PLANE_FS_PARAMS, SHARED_FS_PARAMS, RC_CHANNEL_COUNT,
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

export function FailsafePanel() {
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const getSelectedDrone = useDroneManager((s) => s.getSelectedDrone);
  const { toast } = useToast();
  const { showFlashResult } = useFlashCommitToast();
  const { label: pl } = useParamLabel();
  const metadata = useParamMetadataMap();
  const lbl = (raw: string) => <ParamFieldLabel raw={pl(raw)} metadata={metadata} />;
  const scrollRef = usePanelScroll("failsafe");
  const [saving, setSaving] = useState(false);

  const drone = getSelectedDrone();
  const isPlane = useMemo(() => {
    const vc = drone?.vehicleInfo?.vehicleClass;
    return vc === "plane" || vc === "vtol";
  }, [drone?.vehicleInfo?.vehicleClass]);

  const { firmwareType } = useFirmwareCapabilities();
  const isPx4 = firmwareType === 'px4';
  const isBetaflight = firmwareType === 'betaflight';

  const paramNames = useMemo(
    () => isBetaflight
      ? [...BF_FAILSAFE_PARAMS]
      : [...SHARED_FS_PARAMS, ...(isPlane ? PLANE_FS_PARAMS : COPTER_FS_PARAMS),
         ...(isPx4 ? ["COM_POS_FS_DELAY", "COM_POS_FS_EPH", "COM_POS_FS_EPV", "COM_VEL_FS_EVH"] : [])],
    [isPlane, isPx4, isBetaflight],
  );
  // PX4 has no equivalent for `FENCE_ACTION` or `FENCE_ALT_MIN`
  // (`PX4_PARAM_MAP` maps neither), so they are optional there rather than a
  // hard read failure that blanks the whole panel.
  const optionalParams = useMemo(
    () => isBetaflight
      ? []
      : [
          ...(isPlane ? COPTER_FS_PARAMS : PLANE_FS_PARAMS),
          ...(isPx4 ? ["FENCE_ACTION", "FENCE_ALT_MIN"] : []),
        ],
    [isPlane, isPx4, isBetaflight],
  );

  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded, missingOptional,
    refresh, setLocalValue, saveAllToRam, commitToFlash,
  } = usePanelParams({ paramNames, optionalParams, panelId: "failsafe", autoLoad: true });
  useUnsavedGuard(dirtyParams.size > 0);

  const connected = !!getSelectedProtocol();
  const hasDirty = dirtyParams.size > 0;

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
    showFlashResult(await commitToFlash());
  }

  return (
    <ArmedLockOverlay>
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-6">
        <PanelHeader title="Failsafe Configuration" subtitle="Configure failsafe actions for loss of control, battery, and GCS link"
          loading={loading} loadProgress={loadProgress} hasLoaded={hasLoaded} onRead={refresh}
          connected={connected} error={error} missingOptional={missingOptional} />

        {isBetaflight && (<>
          <Card icon={<ShieldAlert size={14} />} title="Stage 1 — Guard" description="Delay before failsafe activates after signal loss">
            <Input label="Guard Delay (x 0.1s)" type="number" step="1" min="0" max="200" value={p("BF_FS_DELAY", "10")} onChange={(e) => set("BF_FS_DELAY", e.target.value)} />
            <p className="text-[10px] text-text-tertiary">Value of 10 = 1.0 second. During this period, the FC holds last known stick positions.</p>
            <Input label="Throttle Value (Stage 1)" type="number" step="10" min="1000" max="2000" unit="us" value={p("BF_FS_THROTTLE", "1000")} onChange={(e) => set("BF_FS_THROTTLE", e.target.value)} />
            <p className="text-[10px] text-text-tertiary">Throttle PWM applied during Stage 1 guard period.</p>
          </Card>
          <Card icon={<ShieldAlert size={14} />} title="Stage 2 — Action" description="What happens after guard delay expires">
            <Select label="Failsafe Procedure" options={BF_FS_PROCEDURE_OPTIONS} value={p("BF_FS_PROCEDURE", "0")} onChange={(v) => set("BF_FS_PROCEDURE", v)} />
            <Input label="Off Delay (x 0.1s)" type="number" step="1" min="0" max="200" value={p("BF_FS_OFF_DELAY", "10")} onChange={(e) => set("BF_FS_OFF_DELAY", e.target.value)} />
            <p className="text-[10px] text-text-tertiary">For Land procedure: motors off after this delay. Value of 10 = 1.0 second.</p>
          </Card>
        </>)}

        {!isBetaflight && !isPlane && <Card icon={<ShieldAlert size={14} />} title="Short Failsafe" description="Triggered on brief signal loss">
          <StarredParam param="FS_SHORT_ACTN"><Select label={lbl("FS_SHORT_ACTN — Action")} options={[{ value: "0", label: "0 — Disabled" }, { value: "1", label: "1 — Enabled (Circle)" }]} value={p("FS_SHORT_ACTN")} onChange={(v) => set("FS_SHORT_ACTN", v)} /></StarredParam>
          <StarredParam param="FS_SHORT_TIMEOUT"><Input label={lbl("FS_SHORT_TIMEOUT — Timeout (s)")} type="number" step="0.1" min="0" unit="s" value={p("FS_SHORT_TIMEOUT", "1.5")} onChange={(e) => set("FS_SHORT_TIMEOUT", e.target.value)} /></StarredParam>
        </Card>}

        {!isBetaflight && !isPlane && <Card icon={<ShieldAlert size={14} />} title="Long Failsafe" description="Triggered on extended signal loss">
          <StarredParam param="FS_LONG_ACTN"><Select label={lbl("FS_LONG_ACTN — Action")} options={[{ value: "0", label: "0 — Continue" }, { value: "1", label: "1 — RTL" }, { value: "2", label: "2 — Glide" }]} value={p("FS_LONG_ACTN")} onChange={(v) => set("FS_LONG_ACTN", v)} /></StarredParam>
          <StarredParam param="FS_LONG_TIMEOUT"><Input label={lbl("FS_LONG_TIMEOUT — Timeout (s)")} type="number" step="0.1" min="0" unit="s" value={p("FS_LONG_TIMEOUT", "5.0")} onChange={(e) => set("FS_LONG_TIMEOUT", e.target.value)} /></StarredParam>
        </Card>}

        {!isBetaflight && <Card icon={<Battery size={14} />} title="Battery Failsafe" description="Triggered on low battery voltage">
          <StarredParam param="BATT_FS_VOLTSRC"><Select label={lbl("BATT_FS_VOLTSRC — Voltage Source")} options={[{ value: "0", label: "0 — Raw Voltage" }, { value: "1", label: "1 — Sag Compensated" }]} value={p("BATT_FS_VOLTSRC")} onChange={(v) => set("BATT_FS_VOLTSRC", v)} /></StarredParam>
          <StarredParam param="BATT_FS_LOW_VOLT"><Input label={lbl("BATT_FS_LOW_VOLT — Low Voltage Threshold")} type="number" step="0.1" min="0" unit="V" value={p("BATT_FS_LOW_VOLT")} onChange={(e) => set("BATT_FS_LOW_VOLT", e.target.value)} /></StarredParam>
          <StarredParam param="BATT_FS_LOW_ACT"><Select label={lbl("BATT_FS_LOW_ACT — Low Voltage Action")} options={[{ value: "0", label: "0 — None" }, { value: "1", label: "1 — Land" }, { value: "2", label: "2 — RTL" }, { value: "3", label: "3 — SmartRTL or RTL" }]} value={p("BATT_FS_LOW_ACT")} onChange={(v) => set("BATT_FS_LOW_ACT", v)} /></StarredParam>
        </Card>}

        {!isBetaflight && !isPlane && <Card icon={<Radio size={14} />} title="GCS Failsafe" description="Triggered on GCS link loss">
          <StarredParam param="FS_GCS_ENABL"><Select label={lbl("FS_GCS_ENABL — GCS Failsafe")} options={[{ value: "0", label: "0 — Disabled" }, { value: "1", label: "1 — Enabled (RTL)" }, { value: "2", label: "2 — Enabled (continue in auto)" }]} value={p("FS_GCS_ENABL")} onChange={(v) => set("FS_GCS_ENABL", v)} /></StarredParam>
        </Card>}

        {!isBetaflight && !isPlane && <Card icon={<Mountain size={14} />} title="Terrain Failsafe" description="Triggered when terrain data is unavailable during terrain-following">
          <Select label={lbl("TERRAIN_ENABLE — Terrain Following")} options={[{ value: "0", label: "0 — Disabled" }, { value: "1", label: "1 — Enabled" }]} value={p("TERRAIN_ENABLE")} onChange={(v) => set("TERRAIN_ENABLE", v)} />
        </Card>}

        {!isBetaflight && !isPlane && <Card icon={<ShieldAlert size={14} />} title="Failsafe Options" description="FS_OPTIONS bitmask — additional failsafe behaviors">
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

        {!isBetaflight && !isPlane && <Card icon={<Gauge size={14} />} title="Throttle Failsafe PWM" description="PWM value below which throttle failsafe triggers">
          <StarredParam param="FS_THR_VALUE"><Input label={lbl("FS_THR_VALUE — Throttle PWM Threshold")} type="number" step="1" min="800" max="1200" unit={"\u03BCs"} value={p("FS_THR_VALUE", "975")} onChange={(e) => set("FS_THR_VALUE", e.target.value)} /></StarredParam>
          <p className="text-[10px] text-text-tertiary">When throttle PWM drops below this value, the short failsafe action triggers. Set this ~10{"\u03BCs"} below your RC transmitter&apos;s minimum throttle output.</p>
        </Card>}

        {!isBetaflight && isPlane && <Card icon={<Gauge size={14} />} title="Throttle Failsafe" description="Triggered on RC throttle loss">
          <Select label={lbl("THR_FAILSAFE — Throttle Failsafe")} options={[{ value: "0", label: "0 — Disabled" }, { value: "1", label: "1 — Enabled" }]} value={p("THR_FAILSAFE")} onChange={(v) => set("THR_FAILSAFE", v)} />
          <Input label={lbl("THR_FS_VALUE — Throttle PWM value")} type="number" step="1" min="800" max="1200" unit={"\u03BCs"} value={p("THR_FS_VALUE", "950")} onChange={(e) => set("THR_FS_VALUE", e.target.value)} />
        </Card>}

        {!isBetaflight && <Card icon={<SlidersHorizontal size={14} />} title="RC Channel Options" description="Per-channel RC switch functions (RCn_OPTION)">
          <div className="space-y-2">
            {Array.from({ length: RC_CHANNEL_COUNT }, (_, i) => {
              const ch = i + 1;
              const paramName = `RC${ch}_OPTION`;
              return (
                <div key={ch} className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-text-secondary w-6 text-right">CH{ch}</span>
                  <Select options={RC_OPTION_VALUES} value={p(paramName)} onChange={(v) => set(paramName, v)} className="flex-1" />
                </div>
              );
            })}
          </div>
        </Card>}

        {/* ArduPilot geofence. NOT rendered for PX4: `FENCE_ENABLE` maps to
            PX4's `GF_ACTION` (see PX4_PARAM_MAP), which is a BREACH ACTION
            enum, not a fence-type bitmask — so the "4 — Polygon Only" option
            on this control configured PX4 Flight Termination. PX4 gets its own
            card below with its own enum. */}
        {!isBetaflight && !isPx4 && <Card icon={<MapPin size={14} />} title="Geofence" description="Geographical boundary enforcement">
          <Select label={lbl("FENCE_ENABLE — Fence Type")} options={[{ value: "0", label: "0 — Disabled" }, { value: "1", label: "1 — Altitude Only" }, { value: "2", label: "2 — Circle Only" }, { value: "3", label: "3 — Altitude + Circle" }, { value: "4", label: "4 — Polygon Only" }, { value: "5", label: "5 — Altitude + Polygon" }, { value: "6", label: "6 — Circle + Polygon" }, { value: "7", label: "7 — All" }]} value={p("FENCE_ENABLE")} onChange={(v) => set("FENCE_ENABLE", v)} />
          <Select label={lbl("FENCE_ACTION — Breach Action")} options={[{ value: "0", label: "0 — Report Only" }, { value: "1", label: "1 — RTL or Land" }, { value: "2", label: "2 — Always Land" }, { value: "3", label: "3 — SmartRTL or RTL or Land" }, { value: "4", label: "4 — Brake or Land" }, { value: "5", label: "5 — SmartRTL or Land" }]} value={p("FENCE_ACTION")} onChange={(v) => set("FENCE_ACTION", v)} />
          <Input label={lbl("FENCE_ALT_MAX — Max Altitude")} type="number" step="1" min="0" unit="m" value={p("FENCE_ALT_MAX", "100")} onChange={(e) => set("FENCE_ALT_MAX", e.target.value)} />
          <Input label={lbl("FENCE_RADIUS — Max Radius")} type="number" step="1" min="0" unit="m" value={p("FENCE_RADIUS", "300")} onChange={(e) => set("FENCE_RADIUS", e.target.value)} />
          <Input label={lbl("FENCE_ALT_MIN — Min Altitude")} type="number" step="0.5" min="-100" unit="m" value={p("FENCE_ALT_MIN")} onChange={(e) => set("FENCE_ALT_MIN", e.target.value)} />
        </Card>}

        {isPx4 && <Card icon={<MapPin size={14} />} title="Geofence (PX4)" description="PX4 geofence action and limits">
          {/* PX4's own enum. Value 4 is Flight Termination — an irreversible
              motors-off action — so it is labelled as such rather than hidden
              behind an ArduPilot fence-type label. */}
          <Select
            label={lbl("GF_ACTION — Breach Action")}
            options={[
              { value: "0", label: "0 — None" },
              { value: "1", label: "1 — Warning" },
              { value: "2", label: "2 — Hold" },
              { value: "3", label: "3 — Return" },
              { value: "4", label: "4 — Flight Termination (motors off)" },
              { value: "5", label: "5 — Land" },
            ]}
            value={p("FENCE_ENABLE")}
            onChange={(v) => set("FENCE_ENABLE", v)}
          />
          <Input label={lbl("FENCE_ALT_MAX — Max Altitude")} type="number" step="1" min="0" unit="m" value={p("FENCE_ALT_MAX", "100")} onChange={(e) => set("FENCE_ALT_MAX", e.target.value)} />
          <Input label={lbl("FENCE_RADIUS — Max Radius")} type="number" step="1" min="0" unit="m" value={p("FENCE_RADIUS", "300")} onChange={(e) => set("FENCE_RADIUS", e.target.value)} />
        </Card>}

        {isPx4 && hasLoaded && (
          <section className="border-t border-border-strong pt-4 mt-4">
            <h3 className="text-sm font-medium text-text-secondary mb-3 flex items-center gap-2"><Gauge size={14} /> EKF Position Failsafe (PX4)</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><label className="text-xs text-text-secondary mb-1 block">Position Loss Delay (s)</label><Input type="number" step={0.5} min={0} max={30} value={p("COM_POS_FS_DELAY", "1")} onChange={(e) => set("COM_POS_FS_DELAY", e.target.value)} className="h-8 text-xs" /></div>
              <div><label className="text-xs text-text-secondary mb-1 block">Max EPH (m)</label><Input type="number" step={1} min={0} max={50} value={p("COM_POS_FS_EPH", "5")} onChange={(e) => set("COM_POS_FS_EPH", e.target.value)} className="h-8 text-xs" /></div>
              <div><label className="text-xs text-text-secondary mb-1 block">Max EPV (m)</label><Input type="number" step={1} min={0} max={100} value={p("COM_POS_FS_EPV", "10")} onChange={(e) => set("COM_POS_FS_EPV", e.target.value)} className="h-8 text-xs" /></div>
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
    </ArmedLockOverlay>
  );
}
