/**
 * @module WaypointCommandEditors
 * @description Command-specific parameter editors for the WaypointListItem expanded section.
 * @license GPL-3.0-only
 */
"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { Waypoint } from "@/lib/types";

interface CmdEditorProps {
  cmd: string;
  waypoint: Waypoint;
  localParam1: string;
  localParam2: string;
  localParam3: string;
  localHoldTime: string;
  setLocalParam1: (v: string) => void;
  setLocalParam2: (v: string) => void;
  setLocalParam3: (v: string) => void;
  setLocalHoldTime: (v: string) => void;
  commitField: (field: keyof Waypoint, value: string) => void;
  onUpdate: (update: Partial<Waypoint>) => void;
}

export function CommandSpecificEditors({
  cmd, waypoint, localParam1, localParam2, localParam3, localHoldTime,
  setLocalParam1, setLocalParam2, setLocalParam3, setLocalHoldTime,
  commitField, onUpdate,
}: CmdEditorProps) {
  return (
    <>
      {(cmd === "LOITER" || cmd === "LOITER_TIME") && (
        <Input label="Hold Time" type="number" unit="s" placeholder="0"
          value={localHoldTime} onChange={(e) => setLocalHoldTime(e.target.value)}
          onBlur={() => commitField("holdTime", localHoldTime)} />
      )}
      {cmd === "LOITER_TURNS" && (
        <div className="grid grid-cols-2 gap-2">
          <Input label="Turns" type="number" placeholder="1" value={localParam1}
            onChange={(e) => setLocalParam1(e.target.value)} onBlur={() => commitField("param1", localParam1)} />
          <Input label="Radius" type="number" unit="m" placeholder="0" value={localParam3}
            onChange={(e) => setLocalParam3(e.target.value)} onBlur={() => commitField("param3", localParam3)} />
        </div>
      )}
      {cmd === "DO_JUMP" && (
        <div className="grid grid-cols-2 gap-2">
          <Input label="Target WP" type="number" placeholder="1" value={localParam1}
            onChange={(e) => setLocalParam1(e.target.value)} onBlur={() => commitField("param1", localParam1)} />
          <Input label="Repeat" type="number" placeholder="1" value={localParam2}
            onChange={(e) => setLocalParam2(e.target.value)} onBlur={() => commitField("param2", localParam2)} />
        </div>
      )}
      {cmd === "CONDITION_YAW" && (
        <div className="grid grid-cols-2 gap-2">
          <Input label="Angle" type="number" unit="deg" placeholder="0" value={localParam1}
            onChange={(e) => setLocalParam1(e.target.value)} onBlur={() => commitField("param1", localParam1)} />
          <Input label="Rate" type="number" unit="deg/s" placeholder="0" value={localParam2}
            onChange={(e) => setLocalParam2(e.target.value)} onBlur={() => commitField("param2", localParam2)} />
        </div>
      )}
      {cmd === "DO_SET_CAM_TRIGG" && (
        <Input label="Trigger Distance" type="number" unit="m" placeholder="0" value={localParam1}
          onChange={(e) => setLocalParam1(e.target.value)} onBlur={() => commitField("param1", localParam1)} />
      )}
      {cmd === "DO_SET_SERVO" && (
        <div className="grid grid-cols-2 gap-2">
          <Input label="Servo #" type="number" placeholder="5" value={localParam1}
            onChange={(e) => setLocalParam1(e.target.value)} onBlur={() => commitField("param1", localParam1)} />
          <Input label="PWM" type="number" unit="us" placeholder="1500" value={localParam2}
            onChange={(e) => setLocalParam2(e.target.value)} onBlur={() => commitField("param2", localParam2)} />
        </div>
      )}
      {cmd === "DO_MOUNT_CONTROL" && (
        <div className="grid grid-cols-3 gap-2">
          <Input label="Pitch" type="number" unit="deg" placeholder="0" value={localParam1}
            onChange={(e) => setLocalParam1(e.target.value)} onBlur={() => commitField("param1", localParam1)} />
          <Input label="Roll" type="number" unit="deg" placeholder="0" value={localParam2}
            onChange={(e) => setLocalParam2(e.target.value)} onBlur={() => commitField("param2", localParam2)} />
          <Input label="Yaw" type="number" unit="deg" placeholder="0" value={localParam3}
            onChange={(e) => setLocalParam3(e.target.value)} onBlur={() => commitField("param3", localParam3)} />
        </div>
      )}
      {cmd === "DO_GRIPPER" && (
        <div className="grid grid-cols-2 gap-2">
          <Input label="Gripper #" type="number" placeholder="1" value={localParam1}
            onChange={(e) => setLocalParam1(e.target.value)} onBlur={() => commitField("param1", localParam1)} />
          <Select label="Action" options={[{ value: "0", label: "Release" }, { value: "1", label: "Grab" }]}
            value={String(waypoint.param2 ?? 0)} onChange={(v) => onUpdate({ param2: parseInt(v) })} />
        </div>
      )}
      {cmd === "DO_WINCH" && (
        <div className="grid grid-cols-2 gap-2">
          <Input label="Winch #" type="number" placeholder="1" value={localParam1}
            onChange={(e) => setLocalParam1(e.target.value)} onBlur={() => commitField("param1", localParam1)} />
          <Input label="Length" type="number" unit="m" placeholder="0" value={localParam3}
            onChange={(e) => setLocalParam3(e.target.value)} onBlur={() => commitField("param3", localParam3)} />
        </div>
      )}
      {cmd === "DO_FENCE_ENABLE" && (
        <Select label="Fence" options={[{ value: "0", label: "Disable" }, { value: "1", label: "Enable" }]}
          value={String(waypoint.param1 ?? 1)} onChange={(v) => onUpdate({ param1: parseInt(v) })} />
      )}
      {cmd === "NAV_PAYLOAD_PLACE" && (
        <Input label="Max Descent" type="number" unit="m" placeholder="10" value={localParam1}
          onChange={(e) => setLocalParam1(e.target.value)} onBlur={() => commitField("param1", localParam1)} />
      )}
      {cmd === "CONDITION_DISTANCE" && (
        <Input label="Distance" type="number" unit="m" placeholder="0" value={localParam1}
          onChange={(e) => setLocalParam1(e.target.value)} onBlur={() => commitField("param1", localParam1)} />
      )}
      {cmd === "DO_AUX_FUNCTION" && (
        <div className="grid grid-cols-2 gap-2">
          <Input label="Function #" type="number" placeholder="0" value={localParam1}
            onChange={(e) => setLocalParam1(e.target.value)} onBlur={() => commitField("param1", localParam1)} />
          <Select label="Switch"
            options={[{ value: "0", label: "Low" }, { value: "1", label: "Mid" }, { value: "2", label: "High" }]}
            value={String(waypoint.param2 ?? 0)} onChange={(v) => onUpdate({ param2: parseInt(v) })} />
        </div>
      )}
      {cmd === "DELAY" && (
        <Input label="Delay" type="number" unit="s" placeholder="0" value={localParam1}
          onChange={(e) => setLocalParam1(e.target.value)} onBlur={() => commitField("param1", localParam1)} />
      )}
      {cmd === "DO_SET_SPEED" && (
        <Input label="Speed" type="number" unit="m/s" placeholder="5" value={localParam2}
          onChange={(e) => setLocalParam2(e.target.value)} onBlur={() => commitField("param2", localParam2)} />
      )}
    </>
  );
}
