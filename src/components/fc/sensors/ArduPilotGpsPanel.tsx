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
import { useParamMetadataMap } from "@/hooks/use-param-metadata";
import { useParamEnums } from "../shared/ParamEnumSelect";
import { GnssConstellationEditor } from "./GnssConstellationEditor";
import { MapPin, Navigation, Satellite, Compass, Save, Info } from "lucide-react";
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
  resolveApGpsName,
} from "./ap-gps-constants";
import { FcSection } from "@/components/fc/shared/FcSection";

import { PanelSaveBar } from "@/components/fc/shared/PanelSaveBar";

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
  const ol = useOptionLabels();
  const tk = useTranslations("fcPanels.arduPilotGpsPanel");
  const selectedProtocol = useDroneManager(selectSelectedProtocol);
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
  const { saving, flashing, save: handleSave, flash: handleFlash } = useParamPanelActions(panelParams);
  useUnsavedGuard(dirtyParams.size > 0);

  const connected = !!selectedProtocol;
  const hasDirty = dirtyParams.size > 0;

  const has = (name: string) => params.has(name);
  const p = (name: string, fallback = "0") => String(params.get(name) ?? fallback);
  const set = (name: string, v: string) => setLocalValue(name, Number(v) || 0);
  // Per-receiver params carry a different name before and after ArduPilot
  // 4.6; each resolves to the spelling this vehicle reported, or null.
  const type1 = resolveApGpsName("type1", params);
  const type2 = resolveApGpsName("type2", params);
  const rateMs = resolveApGpsName("rateMs", params);
  const gnssMode = resolveApGpsName("gnssMode", params);
  const mbType = resolveApGpsName("mbType", params);
  const posNames = [
    resolveApGpsName("posX", params),
    resolveApGpsName("posY", params),
    resolveApGpsName("posZ", params),
  ];
  const notOnFirmware = (what: string) => (
    <p className="text-xs text-text-tertiary">{what} is not on this firmware.</p>
  );

  return (
    <ArmedWarningBanner>
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-6">
        <PanelHeader
          title="GPS"
          subtitle={tk("gpsReceiverTypeGNSSConstellations")}
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
        <FcSection icon={<Satellite size={14} />} title={tk("receivers")}>
          {type1 ? (
            <Select
              label={tk("gps1Type")}
              searchable
              options={ol(AP_GPS_TYPE_OPTIONS)}
              value={p(type1)}
              onChange={(v) => set(type1, v)}
            />
          ) : hasLoaded && notOnFirmware("GPS 1 type")}
          {type2 && (
            <Select
              label={tk("gps2Type")}
              searchable
              options={ol(AP_GPS_TYPE_OPTIONS)}
              value={p(type2)}
              onChange={(v) => set(type2, v)}
            />
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Select
              label={tk("autoSwitch")}
              options={ol(AP_GPS_AUTO_SWITCH_OPTIONS)}
              value={p("GPS_AUTO_SWITCH", "1")}
              onChange={(v) => set("GPS_AUTO_SWITCH", v)}
            />
            {has("GPS_PRIMARY") && (
              <Select
                label={tk("primaryGPS")}
                options={ol(AP_GPS_PRIMARY_OPTIONS)}
                value={p("GPS_PRIMARY")}
                onChange={(v) => set("GPS_PRIMARY", v)}
              />
            )}
          </div>
          {has("GPS_BLEND_MASK") && (
            <Input
              label={tk("blendMask")}
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
        </FcSection>

        {/* Constellations & rate */}
        <FcSection icon={<Navigation size={14} />} title={tk("constellationsRate")}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {rateMs ? (
              <Select
                label={tk("updateRate")}
                options={ol(AP_GPS_RATE_OPTIONS)}
                value={p(rateMs)}
                onChange={(v) => set(rateMs, v)}
              />
            ) : hasLoaded && notOnFirmware("GPS update rate")}
            <Select
              label={tk("sbasMode")}
              options={ol(AP_GPS_SBAS_OPTIONS)}
              value={p("GPS_SBAS_MODE", "2")}
              onChange={(v) => set("GPS_SBAS_MODE", v)}
            />
            <Select
              label={tk("autoConfig")}
              options={ol(AP_GPS_AUTO_CONFIG_OPTIONS)}
              value={p("GPS_AUTO_CONFIG", "1")}
              onChange={(v) => set("GPS_AUTO_CONFIG", v)}
            />
            {has("GPS_NAVFILTER") && (
              <Select
                label={tk("navFilter")}
                options={ol(AP_GPS_NAVFILTER_OPTIONS)}
                value={p("GPS_NAVFILTER", "8")}
                onChange={(v) => set("GPS_NAVFILTER", v)}
              />
            )}
            <Input
              label={tk("minElevation")}
              type="number"
              step="1"
              min="-100"
              max="90"
              unit="deg"
              value={p("GPS_MIN_ELEV", "-100")}
              onChange={(e) => set("GPS_MIN_ELEV", e.target.value)}
            />
          </div>
          {gnssMode ? (
            <div className="space-y-1">
              <span className="text-xs text-text-secondary">{tk("gnssConstellations")}</span>
              <GnssConstellationEditor
                paramName={gnssMode}
                value={Number(p(gnssMode))}
                bits={bitmaskBits(gnssMode)}
                onChange={(v) => setLocalValue(gnssMode, v)}
              />
            </div>
          ) : hasLoaded && notOnFirmware("GNSS constellation mask")}
        </FcSection>

        {/* GPS for yaw + antenna offsets */}
        {(mbType || posNames.some(Boolean) || has("GPS_DRV_OPTIONS")) && (
          <FcSection icon={<Compass size={14} />} title={tk("gpsForYawAntennaOffsets")}>
            {mbType && (
              <Select
                label={tk("movingBaselineType")}
                options={ol(AP_GPS_MB_TYPE_OPTIONS)}
                value={p(mbType)}
                onChange={(v) => set(mbType, v)}
              />
            )}
            {posNames.some(Boolean) && (
              <div className="grid grid-cols-3 gap-3">
                {posNames.map((name, i) => {
                  const axis = ["X", "Y", "Z"][i];
                  return name ? (
                    <Input key={axis} label={`Antenna ${axis}`} type="number" step="0.01" min="-5" max="5" unit="m" value={p(name)} onChange={(e) => set(name, e.target.value)} />
                  ) : (
                    <div key={axis} />
                  );
                })}
              </div>
            )}
            {has("GPS_DRV_OPTIONS") && (
              <Input
                label={tk("driverOptions")}
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
                {tk("gpsForYawNeedsA")}
              </p>
            </div>
          </FcSection>
        )}

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
