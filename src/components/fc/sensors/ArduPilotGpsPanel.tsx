"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useDroneManager } from "@/stores/drone-manager";
import { usePanelParams } from "@/hooks/use-panel-params";
import { useParamPanelActions } from "@/hooks/use-param-panel-actions";
import { usePanelScroll } from "@/hooks/use-panel-scroll";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { PanelHeader } from "../shared/PanelHeader";
import { ArmedLockOverlay } from "@/components/indicators/ArmedLockOverlay";
import { useParamMetadataMap } from "@/hooks/use-param-metadata";
import { useParamEnums } from "../shared/ParamEnumSelect";
import { GnssConstellationEditor } from "./GnssConstellationEditor";
import { MapPin, Navigation, Satellite, Compass, Save, HardDrive, Info } from "lucide-react";
import {
  apGpsParamNames,
  apGpsOptionalParamNames,
  AP_GPS_TYPE_OPTIONS,
  AP_GPS_AUTO_SWITCH_OPTIONS,
  AP_GPS_PRIMARY_OPTIONS,
  AP_GPS_RATE_OPTIONS,
  AP_GPS_SBAS_OPTIONS,
  AP_GPS_AUTO_CONFIG_OPTIONS,
  AP_GPS_NAVFILTER_OPTIONS,
  AP_GPS_MB_TYPE_OPTIONS,
} from "./ap-gps-constants";

/**
 * ArduPilot GPS configuration panel.
 *
 * Covers the AP_GPS driver surface that has no dedicated GCS control today:
 * receiver type (single + second GPS), auto-switch/blending, GNSS constellation
 * mask, update rate, SBAS, minimum elevation, automatic configuration, GPS-for-yaw
 * moving baseline, and antenna position offsets. The Betaflight GPS panel (GPS
 * Rescue) is a separate component routed for Betaflight connections.
 */
export function ArduPilotGpsPanel() {
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const scrollRef = usePanelScroll("ap-gps");
  const { bitmaskBits } = useParamEnums(useParamMetadataMap());

  const panelParams = usePanelParams({
    paramNames: apGpsParamNames,
    optionalParams: apGpsOptionalParamNames,
    panelId: "ap-gps",
    autoLoad: true,
  });
  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded, missingOptional,
    refresh, setLocalValue,
  } = panelParams;
  const { saving, save: handleSave, flash: handleFlash } = useParamPanelActions(panelParams);
  useUnsavedGuard(dirtyParams.size > 0);

  const connected = !!getSelectedProtocol();
  const hasDirty = dirtyParams.size > 0;

  const has = (name: string) => params.has(name);
  const p = (name: string, fallback = "0") => String(params.get(name) ?? fallback);
  const set = (name: string, v: string) => setLocalValue(name, Number(v) || 0);

  return (
    <ArmedLockOverlay>
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-6">
        <PanelHeader
          title="GPS"
          subtitle="GPS receiver type, GNSS constellations, blending, and GPS-for-yaw"
          icon={<MapPin size={16} />}
          loading={loading}
          loadProgress={loadProgress}
          hasLoaded={hasLoaded}
          missingOptional={missingOptional}
          onRead={refresh}
          connected={connected}
          error={error}
        />

        {/* Receivers */}
        <div className="border border-border-default bg-bg-secondary p-4 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Satellite size={14} className="text-accent-primary" />
            <h2 className="text-sm font-medium text-text-primary">Receivers</h2>
          </div>
          <Select
            label="GPS 1 Type"
            searchable
            options={AP_GPS_TYPE_OPTIONS}
            value={p("GPS_TYPE", "1")}
            onChange={(v) => set("GPS_TYPE", v)}
          />
          {has("GPS_TYPE2") && (
            <Select
              label="GPS 2 Type"
              searchable
              options={AP_GPS_TYPE_OPTIONS}
              value={p("GPS_TYPE2")}
              onChange={(v) => set("GPS_TYPE2", v)}
            />
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Select
              label="Auto Switch"
              options={AP_GPS_AUTO_SWITCH_OPTIONS}
              value={p("GPS_AUTO_SWITCH", "1")}
              onChange={(v) => set("GPS_AUTO_SWITCH", v)}
            />
            {has("GPS_PRIMARY") && (
              <Select
                label="Primary GPS"
                options={AP_GPS_PRIMARY_OPTIONS}
                value={p("GPS_PRIMARY")}
                onChange={(v) => set("GPS_PRIMARY", v)}
              />
            )}
          </div>
          {has("GPS_BLEND_MASK") && (
            <Input
              label="Blend Mask"
              type="number"
              step="1"
              min="0"
              max="7"
              value={p("GPS_BLEND_MASK", "5")}
              onChange={(e) => set("GPS_BLEND_MASK", e.target.value)}
            />
          )}
          <p className="text-[10px] text-text-tertiary">
            Blend Mask bits (used when Auto Switch = Blend): 1 = horizontal position, 2 = vertical position, 4 = speed.
          </p>
        </div>

        {/* Constellations & rate */}
        <div className="border border-border-default bg-bg-secondary p-4 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Navigation size={14} className="text-accent-primary" />
            <h2 className="text-sm font-medium text-text-primary">Constellations &amp; Rate</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Select
              label="Update Rate"
              options={AP_GPS_RATE_OPTIONS}
              value={p("GPS_RATE_MS", "200")}
              onChange={(v) => set("GPS_RATE_MS", v)}
            />
            <Select
              label="SBAS Mode"
              options={AP_GPS_SBAS_OPTIONS}
              value={p("GPS_SBAS_MODE", "2")}
              onChange={(v) => set("GPS_SBAS_MODE", v)}
            />
            <Select
              label="Auto Config"
              options={AP_GPS_AUTO_CONFIG_OPTIONS}
              value={p("GPS_AUTO_CONFIG", "1")}
              onChange={(v) => set("GPS_AUTO_CONFIG", v)}
            />
            {has("GPS_NAVFILTER") && (
              <Select
                label="Nav Filter"
                options={AP_GPS_NAVFILTER_OPTIONS}
                value={p("GPS_NAVFILTER", "8")}
                onChange={(v) => set("GPS_NAVFILTER", v)}
              />
            )}
            <Input
              label="Min Elevation"
              type="number"
              step="1"
              min="-100"
              max="90"
              unit="deg"
              value={p("GPS_MIN_ELEV", "-100")}
              onChange={(e) => set("GPS_MIN_ELEV", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <span className="text-xs text-text-secondary">GNSS Constellations</span>
            <GnssConstellationEditor
              paramName="GPS_GNSS_MODE"
              value={Number(p("GPS_GNSS_MODE"))}
              bits={bitmaskBits("GPS_GNSS_MODE")}
              onChange={(v) => setLocalValue("GPS_GNSS_MODE", v)}
            />
          </div>
        </div>

        {/* GPS for yaw + antenna offsets */}
        {(has("GPS_MB1_TYPE") || has("GPS_POS1_X") || has("GPS_DRV_OPTIONS")) && (
          <div className="border border-border-default bg-bg-secondary p-4 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <Compass size={14} className="text-accent-primary" />
              <h2 className="text-sm font-medium text-text-primary">GPS for Yaw &amp; Antenna Offsets</h2>
            </div>
            {has("GPS_MB1_TYPE") && (
              <Select
                label="Moving Baseline Type"
                options={AP_GPS_MB_TYPE_OPTIONS}
                value={p("GPS_MB1_TYPE")}
                onChange={(v) => set("GPS_MB1_TYPE", v)}
              />
            )}
            {(has("GPS_POS1_X") || has("GPS_POS1_Y") || has("GPS_POS1_Z")) && (
              <div className="grid grid-cols-3 gap-3">
                <Input label="Antenna X" type="number" step="0.01" min="-5" max="5" unit="m" value={p("GPS_POS1_X")} onChange={(e) => set("GPS_POS1_X", e.target.value)} />
                <Input label="Antenna Y" type="number" step="0.01" min="-5" max="5" unit="m" value={p("GPS_POS1_Y")} onChange={(e) => set("GPS_POS1_Y", e.target.value)} />
                <Input label="Antenna Z" type="number" step="0.01" min="-5" max="5" unit="m" value={p("GPS_POS1_Z")} onChange={(e) => set("GPS_POS1_Z", e.target.value)} />
              </div>
            )}
            {has("GPS_DRV_OPTIONS") && (
              <Input
                label="Driver Options"
                type="number"
                step="1"
                min="0"
                value={p("GPS_DRV_OPTIONS")}
                onChange={(e) => set("GPS_DRV_OPTIONS", e.target.value)}
              />
            )}
            <div className="flex items-start gap-2 mt-1 p-2 bg-accent-primary/5 border border-accent-primary/20">
              <Info size={12} className="text-accent-primary shrink-0 mt-0.5" />
              <p className="text-[10px] text-text-secondary">
                GPS-for-yaw needs a moving-baseline receiver pair (GPS types 17/18 or 22/23). The antenna offset is the position of the primary antenna in the body frame.
              </p>
            </div>
          </div>
        )}

        {/* Save */}
        <div className="flex items-center gap-3 pt-2 pb-4">
          <Button
            variant="primary"
            size="lg"
            icon={<Save size={14} />}
            disabled={!hasDirty || !connected}
            loading={saving}
            onClick={handleSave}
          >
            Save to Flight Controller
          </Button>
          {hasRamWrites && (
            <Button
              variant="secondary"
              size="lg"
              icon={<HardDrive size={14} />}
              onClick={handleFlash}
            >
              Write to Flash
            </Button>
          )}
          {!connected && (
            <span className="text-[10px] text-text-tertiary">Connect a drone to save parameters</span>
          )}
          {hasDirty && connected && (
            <span className="text-[10px] text-status-warning">Unsaved changes</span>
          )}
        </div>
      </div>
    </div>
    </ArmedLockOverlay>
  );
}
