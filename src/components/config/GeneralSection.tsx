"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { RotateCcw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { Button } from "@/components/ui/button";
import { useSettingsStore } from "@/stores/settings-store";
import { useGcsLocationStore } from "@/stores/gcs-location-store";
import { JURISDICTIONS, type Jurisdiction } from "@/lib/jurisdiction";

export function GeneralSection() {
  const t = useTranslations("general");
  const jurisdiction = useSettingsStore((s) => s.jurisdiction);
  const units = useSettingsStore((s) => s.units);
  const demoMode = useSettingsStore((s) => s.demoMode);
  const autoReconnect = useSettingsStore((s) => s.autoReconnect);
  const autoConnectOnLoad = useSettingsStore((s) => s.autoConnectOnLoad);
  const locationEnabled = useSettingsStore((s) => s.locationEnabled);
  const setJurisdiction = useSettingsStore((s) => s.setJurisdiction);
  const setUnits = useSettingsStore((s) => s.setUnits);
  const setDemoMode = useSettingsStore((s) => s.setDemoMode);
  const setAutoReconnect = useSettingsStore((s) => s.setAutoReconnect);
  const setAutoConnectOnLoad = useSettingsStore((s) => s.setAutoConnectOnLoad);
  const setLocationEnabled = useSettingsStore((s) => s.setLocationEnabled);
  const setOnboarded = useSettingsStore((s) => s.setOnboarded);

  const permission = useGcsLocationStore((s) => s.permission);
  const position = useGcsLocationStore((s) => s.position);
  const isSupported = useGcsLocationStore((s) => s.isSupported);
  const requestPermission = useGcsLocationStore((s) => s.requestPermission);
  const startWatching = useGcsLocationStore((s) => s.startWatching);
  const stopWatching = useGcsLocationStore((s) => s.stopWatching);

  const [locationRequesting, setLocationRequesting] = useState(false);

  const [timezone, setTimezone] = useState("IST");
  const [telemetryRate, setTelemetryRate] = useState("10");

  const handleJurisdictionChange = (value: string) => {
    if (value === "") {
      setJurisdiction(null);
      return;
    }
    const j = value as Jurisdiction;
    setJurisdiction(j);
    setUnits(JURISDICTIONS[j].defaultUnits);
  };

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-text-primary">{t("title")}</h2>

      <Card>
        <div className="space-y-4">
          <Select
            label={t("jurisdiction")}
            value={jurisdiction ?? ""}
            onChange={handleJurisdictionChange}
            placeholder={t("notSet")}
            options={(Object.entries(JURISDICTIONS) as [Jurisdiction, (typeof JURISDICTIONS)[Jurisdiction]][]).map(([key, cfg]) => ({
              value: key,
              label: `${cfg.flag}  ${cfg.name}`,
            }))}
          />

          <Select
            label={t("units")}
            value={units}
            onChange={(v) => setUnits(v as "metric" | "imperial")}
            options={[
              { value: "metric", label: t("metric") },
              { value: "imperial", label: t("imperial") },
            ]}
          />

          <Select
            label={t("timezone")}
            value={timezone}
            onChange={setTimezone}
            options={[
              { value: "IST", label: t("timezoneIst") },
              { value: "UTC", label: t("timezoneUtc") },
              { value: "PST", label: t("timezonePst") },
            ]}
          />

          <Toggle
            label={t("autoConnect")}
            checked={autoConnectOnLoad}
            onChange={setAutoConnectOnLoad}
          />

          <Toggle
            label={t("autoReconnect")}
            checked={autoReconnect}
            onChange={setAutoReconnect}
          />

          <Select
            label={t("telemetryRate")}
            value={telemetryRate}
            onChange={setTelemetryRate}
            options={[
              { value: "1", label: t("telemetryRate1Hz") },
              { value: "5", label: t("telemetryRate5Hz") },
              { value: "10", label: t("telemetryRate10Hz") },
              { value: "20", label: t("telemetryRate20Hz") },
            ]}
          />
        </div>
      </Card>

      <Card>
        <div className="space-y-1">
          <Toggle
            label={t("demoMode")}
            checked={demoMode}
            onChange={setDemoMode}
          />
          <p className="text-[10px] text-text-tertiary pl-0.5">
            {t("demoDescription")}
          </p>
        </div>
      </Card>

      {/* Location */}
      <Card title={t("locationTitle")}>
        <div className="space-y-3">
          <Toggle
            label={t("showPosition")}
            checked={locationEnabled}
            onChange={async (enabled) => {
              if (enabled && permission !== "granted") {
                setLocationRequesting(true);
                const perm = await requestPermission();
                setLocationRequesting(false);
                if (perm !== "granted") return;
                startWatching();
              } else if (enabled) {
                startWatching();
              } else {
                stopWatching();
              }
              setLocationEnabled(enabled);
            }}
          />
          <p className="text-[10px] text-text-tertiary pl-0.5">
            {t("locationDescription")}
          </p>

          {/* Permission status */}
          <div className="flex items-center gap-2 pl-0.5">
            <span className={`w-2 h-2 rounded-full ${
              permission === "granted" ? "bg-status-success" :
              permission === "denied" ? "bg-status-error" :
              "bg-text-tertiary"
            }`} />
            <span className="text-[10px] text-text-tertiary">
              {permission === "granted" ? t("permGranted") :
               permission === "denied" ? t("permDenied") :
               permission === "unavailable" ? t("permUnavailable") :
               t("permNotRequested")}
            </span>
          </div>

          {/* Current position readout */}
          {permission === "granted" && position && (
            <div className="bg-bg-primary px-2.5 py-2 font-mono text-[10px] text-text-secondary space-y-0.5">
              <div>{t("latAbbr")} {position.lat.toFixed(6)}</div>
              <div>{t("lonAbbr")} {position.lon.toFixed(6)}</div>
              <div>{t("accAbbr")} {Math.round(position.accuracy)}m</div>
              {position.altitude !== null && <div>{t("altAbbr")} {position.altitude.toFixed(1)}m</div>}
            </div>
          )}

          {/* Request permission button */}
          {(permission === "prompt" || permission === "denied") && isSupported && (
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                setLocationRequesting(true);
                await requestPermission();
                setLocationRequesting(false);
              }}
              disabled={locationRequesting}
            >
              {locationRequesting ? t("requesting") : t("requestPermission")}
            </Button>
          )}

          {!isSupported && (
            <p className="text-[10px] text-status-warning pl-0.5">
              {t("geoUnavailable")}
            </p>
          )}
        </div>
      </Card>

      {/* Re-run Setup Wizard */}
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs text-text-secondary">{t("setupWizard")}</span>
            <p className="text-[10px] text-text-tertiary mt-0.5">
              {t("setupWizardDesc")}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon={<RotateCcw size={12} />}
            onClick={() => setOnboarded(false)}
          >
            {t("rerun")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
