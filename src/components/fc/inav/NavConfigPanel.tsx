/**
 * @module NavConfigPanel
 * @description iNav navigation configuration via the named settings system.
 * Values and ranges come from the connected firmware.
 * @license GPL-3.0-only
 */

"use client";

import { PanelHeader } from "../shared/PanelHeader";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Navigation, Upload } from "lucide-react";
import { useSettingsParams } from "@/hooks/use-settings-params";
import type { DroneProtocol } from "@/lib/protocol/types";
import {
  emptySettingGroup, enumOptionsFor, readSettingGroup, writeSettingGroup,
  type SettingGroup, type SettingSpec,
} from "./inav-setting-fields";
import { SettingNumberField } from "./SettingNumberField";

type NavKey = "autoSpeed" | "manualSpeed" | "mcBankAngle" | "fwBankAngle" | "userControlMode" | "positionTimeout";

const SPECS: readonly SettingSpec<NavKey>[] = [
  { key: "autoSpeed", name: "nav_auto_speed" },
  { key: "manualSpeed", name: "nav_manual_speed" },
  { key: "mcBankAngle", name: "nav_mc_bank_angle" },
  { key: "fwBankAngle", name: "nav_fw_bank_angle" },
  { key: "userControlMode", name: "nav_user_control_mode" },
  { key: "positionTimeout", name: "nav_position_timeout" },
];

/** iNav table `nav_user_control_mode`: how pitch/roll sticks act in POSHOLD. */
const USER_CONTROL_OPTIONS = [
  { value: "0", label: "ATTI (sticks command attitude)" },
  { value: "1", label: "CRUISE (sticks command velocity)" },
];

const NUMBER_FIELDS: { key: Exclude<NavKey, "userControlMode">; label: string }[] = [
  { key: "autoSpeed", label: "Auto speed (cm/s)" },
  { key: "manualSpeed", label: "Manual speed (cm/s)" },
  { key: "mcBankAngle", label: "Multirotor max bank angle (deg)" },
  { key: "fwBankAngle", label: "Fixed-wing max bank angle (deg)" },
  { key: "positionTimeout", label: "Position timeout (s)" },
];

const settingsSupported = (p: DroneProtocol): boolean => !!p.settings;
const readNavConfig = (p: DroneProtocol) => readSettingGroup(p.settings!, SPECS);
const writeNavConfig = (p: DroneProtocol, g: SettingGroup<NavKey>) => writeSettingGroup(p.settings!, SPECS, g);

export function NavConfigPanel() {
  const {
    values: group, setValues, loading, error, hasLoaded, dirty,
    connected, isArmed, lockMessage, read, write,
  } = useSettingsParams<SettingGroup<NavKey>>({
    panelId: "inav-nav-config",
    initial: emptySettingGroup(),
    read: readNavConfig,
    write: writeNavConfig,
    supported: settingsSupported,
    unsupportedMessage: "Settings not available on this firmware",
  });

  function update(key: NavKey, value: number) {
    setValues((prev) => ({ ...prev, values: { ...prev.values, [key]: value } }));
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-4">
        <PanelHeader
          title="Navigation Config"
          subtitle="iNav position hold and navigation speed settings"
          icon={<Navigation size={16} />}
          loading={loading}
          loadProgress={null}
          hasLoaded={hasLoaded}
          onRead={read}
          connected={connected}
          error={error}
        >
          {hasLoaded && (
            <Button
              variant="primary"
              size="sm"
              icon={<Upload size={12} />}
              loading={loading}
              disabled={!connected || loading || isArmed}
              title={isArmed ? lockMessage : undefined}
              onClick={write}
            >
              Write to FC
            </Button>
          )}
        </PanelHeader>

        {dirty && (
          <p className="text-[10px] font-mono text-status-warning">
            Unsaved changes : use Write to FC to persist.
          </p>
        )}

        {hasLoaded && (
          <div className="grid grid-cols-2 gap-3">
            {NUMBER_FIELDS.map((f) => (
              <SettingNumberField
                key={f.key}
                label={f.label}
                value={group.values[f.key]}
                range={group.ranges[f.key]}
                onChange={(v) => update(f.key, v)}
              />
            ))}
            <Select
              label="POSHOLD stick mode"
              options={enumOptionsFor(USER_CONTROL_OPTIONS, group.values.userControlMode)}
              value={String(group.values.userControlMode)}
              onChange={(v) => update("userControlMode", parseInt(v))}
            />
          </div>
        )}
      </div>
    </div>
  );
}
