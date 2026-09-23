/**
 * @module NavPidPanel
 * @description iNav navigation controller gains via the named settings
 * system. Only the terms iNav actually has are shown, with the range the
 * connected firmware reports for each.
 * @license GPL-3.0-only
 */

"use client";

import { PanelHeader } from "../shared/PanelHeader";
import { Button } from "@/components/ui/button";
import { Settings2, Upload } from "lucide-react";
import { useSettingsParams } from "@/hooks/use-settings-params";
import type { DroneProtocol } from "@/lib/protocol/types";
import {
  emptySettingGroup, readSettingGroup, writeSettingGroup,
  type SettingGroup, type SettingSpec,
} from "./inav-setting-fields";
import { SettingNumberField } from "./SettingNumberField";

type Term = "p" | "i" | "d" | "ff";

interface PidGroupDef {
  label: string;
  base: string;
  terms: Term[];
  /** Fixed-wing controllers: shown only when the firmware reports them. */
  optional?: boolean;
}

const GROUPS: PidGroupDef[] = [
  { label: "Multirotor altitude (position Z)", base: "nav_mc_pos_z", terms: ["p"] },
  { label: "Multirotor climb rate (velocity Z)", base: "nav_mc_vel_z", terms: ["p", "i", "d"] },
  { label: "Multirotor position XY", base: "nav_mc_pos_xy", terms: ["p"] },
  { label: "Multirotor velocity XY", base: "nav_mc_vel_xy", terms: ["p", "i", "d", "ff"] },
  { label: "Multirotor heading", base: "nav_mc_heading", terms: ["p"] },
  { label: "Fixed-wing altitude", base: "nav_fw_pos_z", terms: ["p", "i", "d"], optional: true },
  { label: "Fixed-wing position XY", base: "nav_fw_pos_xy", terms: ["p", "i", "d"], optional: true },
  { label: "Fixed-wing heading", base: "nav_fw_pos_hdg", terms: ["p", "i", "d"], optional: true },
];

const SPECS: readonly SettingSpec<string>[] = GROUPS.flatMap((g) =>
  g.terms.map((t) => ({ key: `${g.base}_${t}`, name: `${g.base}_${t}`, optional: g.optional })),
);

const settingsSupported = (p: DroneProtocol): boolean => !!p.settings;
const readNavPid = (p: DroneProtocol) => readSettingGroup(p.settings!, SPECS);
const writeNavPid = (p: DroneProtocol, g: SettingGroup<string>) => writeSettingGroup(p.settings!, SPECS, g);

export function NavPidPanel() {
  const {
    values: group, setValues, loading, error, hasLoaded, dirty,
    connected, isArmed, lockMessage, read, write,
  } = useSettingsParams<SettingGroup<string>>({
    panelId: "inav-nav-pid",
    initial: emptySettingGroup(),
    read: readNavPid,
    write: writeNavPid,
    supported: settingsSupported,
    unsupportedMessage: "Settings not available on this firmware",
  });

  function update(name: string, value: number) {
    setValues((prev) => ({ ...prev, values: { ...prev.values, [name]: value } }));
  }

  const shownGroups = GROUPS.filter((g) => g.terms.some((t) => group.values[`${g.base}_${t}`] !== undefined));

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-4">
        <PanelHeader
          title="Nav PID"
          subtitle="iNav navigation controller PID gains"
          icon={<Settings2 size={16} />}
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
          <div className="space-y-5">
            {shownGroups.map((g) => (
              <fieldset key={g.base} className="rounded border border-border-default p-3">
                <legend className="px-1 text-[10px] font-mono text-text-tertiary uppercase tracking-wider">
                  {g.label}
                </legend>
                <div className="grid grid-cols-4 gap-3 mt-1">
                  {g.terms.map((t) => {
                    const name = `${g.base}_${t}`;
                    return (
                      <SettingNumberField
                        key={name}
                        label={t.toUpperCase()}
                        value={group.values[name]}
                        range={group.ranges[name]}
                        onChange={(v) => update(name, v)}
                      />
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
