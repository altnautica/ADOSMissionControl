"use client";

import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { Button } from "@/components/ui/button";
import { useSettingsStore } from "@/stores/settings-store";
import { audioEngine } from "@/lib/audio-engine";
import { Volume2 } from "lucide-react";

type AlertKey =
  | "alertLowBattery"
  | "alertGpsLost"
  | "alertRcLost"
  | "alertArmDisarm"
  | "alertWaypoint"
  | "alertFailsafe";

const ALERT_ROWS: {
  key: AlertKey;
  labelKey: string;
  descriptionKey: string;
  testSound: string;
}[] = [
  {
    key: "alertLowBattery",
    labelKey: "lowBattery",
    descriptionKey: "lowBatteryDesc",
    testSound: "low_battery",
  },
  {
    key: "alertGpsLost",
    labelKey: "gpsLost",
    descriptionKey: "gpsLostDesc",
    testSound: "gps_lost",
  },
  {
    key: "alertRcLost",
    labelKey: "rcLost",
    descriptionKey: "rcLostDesc",
    testSound: "rc_lost",
  },
  {
    key: "alertArmDisarm",
    labelKey: "armDisarm",
    descriptionKey: "armDisarmDesc",
    testSound: "arm",
  },
  {
    key: "alertWaypoint",
    labelKey: "waypointMission",
    descriptionKey: "waypointMissionDesc",
    testSound: "waypoint_reached",
  },
  {
    key: "alertFailsafe",
    labelKey: "failsafeErrors",
    descriptionKey: "failsafeErrorsDesc",
    testSound: "failsafe",
  },
];

export function NotificationsSection() {
  const t = useTranslations("notifications");
  const audioEnabled = useSettingsStore((s) => s.audioEnabled);
  const audioVolume = useSettingsStore((s) => s.audioVolume);
  const setAudioEnabled = useSettingsStore((s) => s.setAudioEnabled);
  const setAudioVolume = useSettingsStore((s) => s.setAudioVolume);
  const setAlert = useSettingsStore((s) => s.setAlert);
  const batteryWarningPct = useSettingsStore((s) => s.batteryWarningPct);
  const batteryCriticalPct = useSettingsStore((s) => s.batteryCriticalPct);
  const alertPopupDuration = useSettingsStore((s) => s.alertPopupDuration);
  const setBatteryWarningPct = useSettingsStore((s) => s.setBatteryWarningPct);
  const setBatteryCriticalPct = useSettingsStore((s) => s.setBatteryCriticalPct);
  const setAlertPopupDuration = useSettingsStore((s) => s.setAlertPopupDuration);
  const changelogNotificationsEnabled = useSettingsStore((s) => s.changelogNotificationsEnabled);
  const setChangelogNotificationsEnabled = useSettingsStore((s) => s.setChangelogNotificationsEnabled);
  const clearSeenChangelog = useSettingsStore((s) => s.clearSeenChangelog);

  const alertLowBattery = useSettingsStore((s) => s.alertLowBattery);
  const alertGpsLost = useSettingsStore((s) => s.alertGpsLost);
  const alertRcLost = useSettingsStore((s) => s.alertRcLost);
  const alertArmDisarm = useSettingsStore((s) => s.alertArmDisarm);
  const alertWaypoint = useSettingsStore((s) => s.alertWaypoint);
  const alertFailsafe = useSettingsStore((s) => s.alertFailsafe);

  const alertStates: Record<AlertKey, boolean> = {
    alertLowBattery, alertGpsLost, alertRcLost,
    alertArmDisarm, alertWaypoint, alertFailsafe,
  };

  function handleVolumeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = Number(e.target.value) / 100;
    setAudioVolume(v);
    audioEngine.setVolume(v);
  }

  function handleToggleMaster(enabled: boolean) {
    setAudioEnabled(enabled);
    audioEngine.setEnabled(enabled);
  }

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-text-primary">{t("title")}</h2>

      {/* Card 1: Sound */}
      <Card title={t("soundTitle")}>
        <div className="space-y-4">
          <Toggle
            label={t("enableAudio")}
            checked={audioEnabled}
            onChange={handleToggleMaster}
          />
          {audioEnabled && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">
                {t("volume", { percent: Math.round(audioVolume * 100) })}
              </label>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(audioVolume * 100)}
                onChange={handleVolumeChange}
                className="w-full h-1.5 bg-bg-tertiary appearance-none cursor-pointer accent-accent-primary"
              />
            </div>
          )}
          <p className="text-[10px] text-text-tertiary">
            {t("soundDescription")}
          </p>
        </div>
      </Card>

      {/* Card 2: Alert Sounds */}
      <Card title={t("alertSoundsTitle")}>
        <div
          className={
            !audioEnabled ? "opacity-50 pointer-events-none space-y-3" : "space-y-3"
          }
        >
          {ALERT_ROWS.map((row) => (
            <div
              key={row.key}
              className="flex items-center justify-between gap-2"
            >
              <div className="flex-1 min-w-0">
                <div className="text-xs text-text-primary">{t(row.labelKey)}</div>
                <div className="text-[10px] text-text-tertiary truncate">
                  {t(row.descriptionKey)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => audioEngine.playForce(row.testSound)}
                className="shrink-0 w-6 h-6 flex items-center justify-center text-text-tertiary hover:text-accent-primary transition-colors"
                title={t("preview", { name: t(row.labelKey) })}
              >
                <Volume2 size={12} />
              </button>
              <Toggle
                label=""
                checked={alertStates[row.key]}
                onChange={(v) => setAlert(row.key, v)}
              />
            </div>
          ))}
        </div>
      </Card>

      {/* Card 3: Alert Thresholds */}
      <Card title={t("thresholdsTitle")}>
        <div className="space-y-4">
          <Input
            label={t("batteryWarning")}
            type="number"
            min={10}
            max={50}
            value={String(batteryWarningPct)}
            onChange={(e) => {
              const v = Math.max(10, Math.min(50, Number(e.target.value)));
              setBatteryWarningPct(v);
            }}
            unit="%"
          />
          <Input
            label={t("batteryCritical")}
            type="number"
            min={5}
            max={30}
            value={String(batteryCriticalPct)}
            onChange={(e) => {
              const v = Math.max(5, Math.min(30, Number(e.target.value)));
              setBatteryCriticalPct(v);
            }}
            unit="%"
          />
          <Select
            label={t("alertDuration")}
            value={alertPopupDuration}
            onChange={setAlertPopupDuration}
            options={[
              { value: "3", label: t("seconds", { count: 3 }) },
              { value: "5", label: t("seconds", { count: 5 }) },
              { value: "10", label: t("seconds", { count: 10 }) },
              { value: "never", label: t("neverDismiss") },
            ]}
          />
        </div>
      </Card>

      {/* Card 4: Changelog Notifications */}
      <Card title={t("changelogTitle")}>
        <div className="space-y-4">
          <Toggle
            label={t("showChangelog")}
            checked={changelogNotificationsEnabled}
            onChange={setChangelogNotificationsEnabled}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              clearSeenChangelog();
            }}
          >
            {t("resetSeen")}
          </Button>
          <p className="text-[10px] text-text-tertiary">
            {t("changelogDescription")}
          </p>
        </div>
      </Card>
    </div>
  );
}
