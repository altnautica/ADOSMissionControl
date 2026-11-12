"use client";

import { useOptionLabels } from "@/lib/i18n/option-labels";
import { useTranslations } from "next-intl";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { usePanelParams } from "@/hooks/use-panel-params";
import { useParamPanelActions } from "@/hooks/use-param-panel-actions";
import { usePanelScroll } from "@/hooks/use-panel-scroll";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { PanelHeader } from "../shared/PanelHeader";
import { ArmedWarningBanner } from "@/components/indicators/ArmedWarningBanner";
import { MapPin, Navigation, ShieldAlert, Save, Info } from "lucide-react";
import { gpsParamNames, GPS_PROVIDER_OPTIONS, SBAS_MODE_OPTIONS, SANITY_CHECK_OPTIONS } from "./gps-constants";
import { FcSection } from "@/components/fc/shared/FcSection";

import { PanelSaveBar } from "@/components/fc/shared/PanelSaveBar";

export function GpsPanel() {
  const ol = useOptionLabels();
  const tk = useTranslations("fcPanels.gpsPanel");
  const selectedProtocol = useDroneManager(selectSelectedProtocol);
  const scrollRef = usePanelScroll("gps");

  const panelParams = usePanelParams({ paramNames: gpsParamNames, panelId: "gps", autoLoad: true });
  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded,
    refresh, setLocalValue,
  } = panelParams;
  const { saving, flashing, save: handleSave, flash: handleFlash } = useParamPanelActions(panelParams);
  useUnsavedGuard(dirtyParams.size > 0);

  const connected = !!selectedProtocol;
  const hasDirty = dirtyParams.size > 0;

  const p = (name: string, fallback = "0") => String(params.get(name) ?? fallback);
  const set = (name: string, v: string) => setLocalValue(name, Number(v) || 0);

  return (
    <ArmedWarningBanner>
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-6">
        <PanelHeader
          title="GPS"
          subtitle={tk("gpsProtocolAndGPSRescue")}
          icon={<MapPin size={16} />}
          loading={loading}
          loadProgress={loadProgress}
          hasLoaded={hasLoaded}
          onRead={refresh}
          connected={connected}
          error={error}
        />

        {/* GPS Protocol */}
        <FcSection icon={<Navigation size={14} />} title={tk("gpsProtocol")}>
          <Select
            label={tk("provider")}
            options={GPS_PROVIDER_OPTIONS}
            value={p("BF_GPS_PROVIDER")}
            onChange={(v) => set("BF_GPS_PROVIDER", v)}
          />
          <Select
            label={tk("sbasMode")}
            options={ol(SBAS_MODE_OPTIONS)}
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
              <span className="text-xs text-text-secondary">{tk("autoConfig")}</span>
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
              <span className="text-xs text-text-secondary">{tk("autoBaud")}</span>
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
              <span className="text-xs text-text-secondary">{tk("galileoSupport")}</span>
            </label>
          </div>
        </FcSection>

        {/* GPS Rescue */}
        <FcSection icon={<ShieldAlert size={14} />} title={tk("gpsRescue")} actions={<span className="text-[10px] text-text-tertiary ml-auto">{tk("betaflightReturnToHome")}</span>}>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              label={tk("maxRescueAngle")}
              type="number"
              step="1"
              min="0"
              max="60"
              unit="deg"
              value={p("BF_GPS_RESCUE_ANGLE", "30")}
              onChange={(e) => set("BF_GPS_RESCUE_ANGLE", e.target.value)}
            />
            <Input
              label={tk("initialAltitude")}
              type="number"
              step="1"
              min="1"
              max="200"
              unit="m"
              value={p("BF_GPS_RESCUE_INITIAL_ALT", "30")}
              onChange={(e) => set("BF_GPS_RESCUE_INITIAL_ALT", e.target.value)}
            />
            <Input
              label={tk("descentDistance")}
              type="number"
              step="10"
              min="0"
              max="500"
              unit="m"
              value={p("BF_GPS_RESCUE_DESCENT_DIST", "200")}
              onChange={(e) => set("BF_GPS_RESCUE_DESCENT_DIST", e.target.value)}
            />
            <Input
              label={tk("groundSpeed")}
              type="number"
              step="50"
              min="0"
              max="3000"
              unit="cm/s"
              value={p("BF_GPS_RESCUE_GROUND_SPEED", "750")}
              onChange={(e) => set("BF_GPS_RESCUE_GROUND_SPEED", e.target.value)}
            />
            <Input
              label={tk("throttleMin")}
              type="number"
              step="10"
              min="1000"
              max="2000"
              value={p("BF_GPS_RESCUE_THROTTLE_MIN", "1100")}
              onChange={(e) => set("BF_GPS_RESCUE_THROTTLE_MIN", e.target.value)}
            />
            <Input
              label={tk("throttleMax")}
              type="number"
              step="10"
              min="1000"
              max="2000"
              value={p("BF_GPS_RESCUE_THROTTLE_MAX", "1600")}
              onChange={(e) => set("BF_GPS_RESCUE_THROTTLE_MAX", e.target.value)}
            />
            <Input
              label={tk("throttleHover")}
              type="number"
              step="10"
              min="1000"
              max="2000"
              value={p("BF_GPS_RESCUE_THROTTLE_HOVER", "1280")}
              onChange={(e) => set("BF_GPS_RESCUE_THROTTLE_HOVER", e.target.value)}
            />
            <Select
              label={tk("sanityChecks")}
              options={ol(SANITY_CHECK_OPTIONS)}
              value={p("BF_GPS_RESCUE_SANITY_CHECKS", "1")}
              onChange={(v) => set("BF_GPS_RESCUE_SANITY_CHECKS", v)}
            />
          </div>
          <Input
            label={tk("minSatellites")}
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
              {tk("gpsRescueMustAlsoBe")}
            </p>
          </div>
        </FcSection>

        {/* Save */}
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
