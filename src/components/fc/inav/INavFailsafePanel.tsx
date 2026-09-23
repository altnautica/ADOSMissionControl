/**
 * @module INavFailsafePanel
 * @description iNav failsafe procedure settings via the named settings system.
 * Only shown when connected to iNav firmware.
 * @license GPL-3.0-only
 */

"use client";

import { PanelHeader } from "../shared/PanelHeader";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { ShieldAlert, Upload } from "lucide-react";
import { useSettingsParams } from "@/hooks/use-settings-params";
import type { DroneProtocol } from "@/lib/protocol/types";
import {
  emptySettingGroup, enumOptionsFor, readSettingGroup, writeSettingGroup,
  type SettingGroup, type SettingSpec,
} from "./inav-setting-fields";
import { SettingNumberField } from "./SettingNumberField";

type FailsafeKey = "procedure" | "minDistance" | "minDistanceProcedure";

const SPECS: readonly SettingSpec<FailsafeKey>[] = [
  { key: "procedure", name: "failsafe_procedure" },
  { key: "minDistance", name: "failsafe_min_distance" },
  { key: "minDistanceProcedure", name: "failsafe_min_distance_procedure" },
];

/** iNav table `failsafe_procedure`, shared by both procedure settings. */
const FAILSAFE_PROCEDURE_OPTIONS = [
  { value: "0", label: "Land (emergency landing)" },
  { value: "1", label: "Drop (motors off)" },
  { value: "2", label: "RTH" },
  { value: "3", label: "None" },
];

const settingsSupported = (p: DroneProtocol): boolean => !!p.settings;
const readFailsafe = (p: DroneProtocol) => readSettingGroup(p.settings!, SPECS);
const writeFailsafe = (p: DroneProtocol, g: SettingGroup<FailsafeKey>) => writeSettingGroup(p.settings!, SPECS, g);

export function INavFailsafePanel() {
  const {
    values: group, setValues, loading, error, hasLoaded, dirty,
    connected, isArmed, lockMessage, read, write,
  } = useSettingsParams<SettingGroup<FailsafeKey>>({
    panelId: "inav-failsafe",
    initial: emptySettingGroup(),
    read: readFailsafe,
    write: writeFailsafe,
    supported: settingsSupported,
    unsupportedMessage: "Settings not available on this firmware",
  });

  function update(key: FailsafeKey, value: number) {
    setValues((prev) => ({ ...prev, values: { ...prev.values, [key]: value } }));
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-4">
        <PanelHeader
          title="iNav Failsafe"
          subtitle="What the FC does when the RC link is lost"
          icon={<ShieldAlert size={16} />}
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
          <div className="space-y-3">
            <Select
              label="Failsafe procedure"
              options={enumOptionsFor(FAILSAFE_PROCEDURE_OPTIONS, group.values.procedure)}
              value={String(group.values.procedure)}
              onChange={(v) => update("procedure", parseInt(v))}
            />
            <SettingNumberField
              label="Min distance (cm)"
              value={group.values.minDistance}
              range={group.ranges.minDistance}
              onChange={(v) => update("minDistance", v)}
            />
            <Select
              label="Procedure inside min distance"
              options={enumOptionsFor(FAILSAFE_PROCEDURE_OPTIONS, group.values.minDistanceProcedure)}
              value={String(group.values.minDistanceProcedure)}
              onChange={(v) => update("minDistanceProcedure", parseInt(v))}
            />
          </div>
        )}
      </div>
    </div>
  );
}
