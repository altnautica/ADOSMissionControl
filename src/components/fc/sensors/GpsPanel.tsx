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
import { ArmedWarningBanner } from "@/components/indicators/ArmedWarningBanner";
import { MapPin, Navigation, ShieldAlert, Save, HardDrive, Info } from "lucide-react";
import { gpsParamNames, GPS_PROVIDER_OPTIONS, SBAS_MODE_OPTIONS, SANITY_CHECK_OPTIONS } from "./gps-constants";

export function GpsPanel() {
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const scrollRef = usePanelScroll("gps");

  const panelParams = usePanelParams({ paramNames: gpsParamNames, panelId: "gps", autoLoad: true });
  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded,
    refresh, setLocalValue,
  } = panelParams;
  const { saving, save: handleSave, flash: handleFlash } = useParamPanelActions(panelParams);
  useUnsavedGuard(dirtyParams.size > 0);

  const connected = !!getSelectedProtocol();
  const hasDirty = dirtyParams.size > 0;

  const p = (name: string, fallback = "0") => String(params.get(name) ?? fallback);
  const set = (name: string, v: string) => setLocalValue(name, Number(v) || 0);

  return (
    <ArmedWarningBanner>
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-6">
        <PanelHeader
          title="GPS"
          subtitle="GPS protocol and GPS Rescue (return-to-home) configuration"
          icon={<MapPin size={16} />}
          loading={loading}
          loadProgress={loadProgress}
          hasLoaded={hasLoaded}
          onRead={refresh}
          connected={connected}
          error={error}
        />

        {/* GPS Protocol */}
        <div className="border border-border-default bg-bg-secondary p-4 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Navigation size={14} className="text-accent-primary" />
            <h2 className="text-sm font-medium text-text-primary">GPS Protocol</h2>
          </div>
          <Select
            label="Provider"
            options={GPS_PROVIDER_OPTIONS}
            value={p("BF_GPS_PROVIDER")}
            onChange={(v) => set("BF_GPS_PROVIDER", v)}
          />
          <Select
            label="SBAS Mode"
            options={SBAS_MODE_OPTIONS}
            value={p("BF_GPS_SBAS_MODE")}
            onChange={(v) => set("BF_GPS_SBAS_MODE", v)}
          />
          <div className="flex flex-wrap gap-x-6 gap-y-2 mt-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={Number(params.get("BF_GPS_AUTO_CONFIG") ?? 0) === 1}
                onChange={() =>
                  setLocalValue(
                    "BF_GPS_AUTO_CONFIG",
                    Number(params.get("BF_GPS_AUTO_CONFIG") ?? 0) === 1 ? 0 : 1,
                  )
                }
                className="accent-accent-primary"
              />
              <span className="text-xs text-text-secondary">Auto Config</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={Number(params.get("BF_GPS_AUTO_BAUD") ?? 0) === 1}
                onChange={() =>
                  setLocalValue(
                    "BF_GPS_AUTO_BAUD",
                    Number(params.get("BF_GPS_AUTO_BAUD") ?? 0) === 1 ? 0 : 1,
                  )
                }
                className="accent-accent-primary"
              />
              <span className="text-xs text-text-secondary">Auto Baud</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={Number(params.get("BF_GPS_USE_GALILEO") ?? 0) === 1}
                onChange={() =>
                  setLocalValue(
                    "BF_GPS_USE_GALILEO",
                    Number(params.get("BF_GPS_USE_GALILEO") ?? 0) === 1 ? 0 : 1,
                  )
                }
                className="accent-accent-primary"
              />
              <span className="text-xs text-text-secondary">Galileo Support</span>
            </label>
          </div>
        </div>

        {/* GPS Rescue */}
        <div className="border border-border-default bg-bg-secondary p-4 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <ShieldAlert size={14} className="text-accent-primary" />
            <h2 className="text-sm font-medium text-text-primary">GPS Rescue</h2>
            <span className="text-[10px] text-text-tertiary ml-auto">Betaflight return-to-home</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              label="Max Rescue Angle"
              type="number"
              step="1"
              min="0"
              max="60"
              unit="deg"
              value={p("BF_GPS_RESCUE_ANGLE", "30")}
              onChange={(e) => set("BF_GPS_RESCUE_ANGLE", e.target.value)}
            />
            <Input
              label="Initial Altitude"
              type="number"
              step="1"
              min="1"
              max="200"
              unit="m"
              value={p("BF_GPS_RESCUE_INITIAL_ALT", "30")}
              onChange={(e) => set("BF_GPS_RESCUE_INITIAL_ALT", e.target.value)}
            />
            <Input
              label="Descent Distance"
              type="number"
              step="10"
              min="0"
              max="500"
              unit="m"
              value={p("BF_GPS_RESCUE_DESCENT_DIST", "200")}
              onChange={(e) => set("BF_GPS_RESCUE_DESCENT_DIST", e.target.value)}
            />
            <Input
              label="Ground Speed"
              type="number"
              step="50"
              min="0"
              max="3000"
              unit="cm/s"
              value={p("BF_GPS_RESCUE_GROUND_SPEED", "750")}
              onChange={(e) => set("BF_GPS_RESCUE_GROUND_SPEED", e.target.value)}
            />
            <Input
              label="Throttle Min"
              type="number"
              step="10"
              min="1000"
              max="2000"
              value={p("BF_GPS_RESCUE_THROTTLE_MIN", "1100")}
              onChange={(e) => set("BF_GPS_RESCUE_THROTTLE_MIN", e.target.value)}
            />
            <Input
              label="Throttle Max"
              type="number"
              step="10"
              min="1000"
              max="2000"
              value={p("BF_GPS_RESCUE_THROTTLE_MAX", "1600")}
              onChange={(e) => set("BF_GPS_RESCUE_THROTTLE_MAX", e.target.value)}
            />
            <Input
              label="Throttle Hover"
              type="number"
              step="10"
              min="1000"
              max="2000"
              value={p("BF_GPS_RESCUE_THROTTLE_HOVER", "1280")}
              onChange={(e) => set("BF_GPS_RESCUE_THROTTLE_HOVER", e.target.value)}
            />
            <Select
              label="Sanity Checks"
              options={SANITY_CHECK_OPTIONS}
              value={p("BF_GPS_RESCUE_SANITY_CHECKS", "1")}
              onChange={(v) => set("BF_GPS_RESCUE_SANITY_CHECKS", v)}
            />
          </div>
          <Input
            label="Min Satellites"
            type="number"
            step="1"
            min="0"
            max="20"
            value={p("BF_GPS_RESCUE_MIN_SATS", "8")}
            onChange={(e) => set("BF_GPS_RESCUE_MIN_SATS", e.target.value)}
          />

          {/* Info note */}
          <div className="flex items-start gap-2 mt-2 p-2 bg-accent-primary/5 border border-accent-primary/20">
            <Info size={12} className="text-accent-primary shrink-0 mt-0.5" />
            <p className="text-[10px] text-text-secondary">
              GPS Rescue must also be enabled as a mode in the Modes tab (assign to an AUX channel) for it to be active.
            </p>
          </div>
        </div>

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
    </ArmedWarningBanner>
  );
}
