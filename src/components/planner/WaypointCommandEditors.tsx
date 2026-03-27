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
  const t = useTranslations("planner");
  return (
    <>
      {(cmd === "LOITER" || cmd === "LOITER_TIME" || cmd === "SPLINE_WAYPOINT") && (
        <Input label={t("holdTime")} type="number" unit="s" placeholder="0"
          value={localHoldTime} onChange={(e) => setLocalHoldTime(e.target.value)}
          onBlur={() => commitField("holdTime", localHoldTime)} />
      )}
      {cmd === "LOITER_TURNS" && (
        <div className="grid grid-cols-2 gap-2">
          <Input label={t("turns")} type="number" placeholder="1" value={localParam1}
            onChange={(e) => setLocalParam1(e.target.value)} onBlur={() => commitField("param1", localParam1)} />
          <Input label={t("radius")} type="number" unit="m" placeholder="0" value={localParam3}
            onChange={(e) => setLocalParam3(e.target.value)} onBlur={() => commitField("param3", localParam3)} />
        </div>
      )}
      {cmd === "DO_JUMP" && (
        <div className="grid grid-cols-2 gap-2">
          <Input label={t("targetWp")} type="number" placeholder="1" value={localParam1}
            onChange={(e) => setLocalParam1(e.target.value)} onBlur={() => commitField("param1", localParam1)} />
          <Input label={t("repeat")} type="number" placeholder="1" value={localParam2}
            onChange={(e) => setLocalParam2(e.target.value)} onBlur={() => commitField("param2", localParam2)} />
        </div>
      )}
      {cmd === "CONDITION_YAW" && (
        <div className="grid grid-cols-2 gap-2">
          <Input label={t("angle")} type="number" unit="deg" placeholder="0" value={localParam1}
            onChange={(e) => setLocalParam1(e.target.value)} onBlur={() => commitField("param1", localParam1)} />
          <Input label={t("rate")} type="number" unit="deg/s" placeholder="0" value={localParam2}
            onChange={(e) => setLocalParam2(e.target.value)} onBlur={() => commitField("param2", localParam2)} />
        </div>
      )}
      {cmd === "DO_SET_CAM_TRIGG" && (
        <Input label={t("triggerDistance")} type="number" unit="m" placeholder="0" value={localParam1}
          onChange={(e) => setLocalParam1(e.target.value)} onBlur={() => commitField("param1", localParam1)} />
      )}
      {cmd === "DO_SET_SERVO" && (
        <div className="grid grid-cols-2 gap-2">
          <Input label={t("servoNum")} type="number" placeholder="5" value={localParam1}
            onChange={(e) => setLocalParam1(e.target.value)} onBlur={() => commitField("param1", localParam1)} />
          <Input label={t("pwm")} type="number" unit="us" placeholder="1500" value={localParam2}
            onChange={(e) => setLocalParam2(e.target.value)} onBlur={() => commitField("param2", localParam2)} />
        </div>
      )}
      {cmd === "DO_MOUNT_CONTROL" && (
        <div className="grid grid-cols-3 gap-2">
          <Input label={t("pitch")} type="number" unit="deg" placeholder="0" value={localParam1}
            onChange={(e) => setLocalParam1(e.target.value)} onBlur={() => commitField("param1", localParam1)} />
          <Input label={t("roll")} type="number" unit="deg" placeholder="0" value={localParam2}
            onChange={(e) => setLocalParam2(e.target.value)} onBlur={() => commitField("param2", localParam2)} />
          <Input label={t("yaw")} type="number" unit="deg" placeholder="0" value={localParam3}
            onChange={(e) => setLocalParam3(e.target.value)} onBlur={() => commitField("param3", localParam3)} />
        </div>
      )}
      {cmd === "DO_GRIPPER" && (
        <div className="grid grid-cols-2 gap-2">
          <Input label={t("gripperNum")} type="number" placeholder="1" value={localParam1}
            onChange={(e) => setLocalParam1(e.target.value)} onBlur={() => commitField("param1", localParam1)} />
          <Select label={t("action")} options={[{ value: "0", label: t("release") }, { value: "1", label: t("grab") }]}
            value={String(waypoint.param2 ?? 0)} onChange={(v) => onUpdate({ param2: parseInt(v) })} />
        </div>
      )}
      {cmd === "DO_WINCH" && (
        <div className="grid grid-cols-2 gap-2">
          <Input label={t("winchNum")} type="number" placeholder="1" value={localParam1}
            onChange={(e) => setLocalParam1(e.target.value)} onBlur={() => commitField("param1", localParam1)} />
          <Input label={t("length")} type="number" unit="m" placeholder="0" value={localParam3}
            onChange={(e) => setLocalParam3(e.target.value)} onBlur={() => commitField("param3", localParam3)} />
        </div>
      )}
      {cmd === "DO_FENCE_ENABLE" && (
        <Select label={t("fence")} options={[{ value: "0", label: t("disable") }, { value: "1", label: t("enable") }]}
          value={String(waypoint.param1 ?? 1)} onChange={(v) => onUpdate({ param1: parseInt(v) })} />
      )}
      {cmd === "NAV_PAYLOAD_PLACE" && (
        <Input label={t("maxDescent")} type="number" unit="m" placeholder="10" value={localParam1}
          onChange={(e) => setLocalParam1(e.target.value)} onBlur={() => commitField("param1", localParam1)} />
      )}
      {cmd === "CONDITION_DISTANCE" && (
        <Input label={t("distance")} type="number" unit="m" placeholder="0" value={localParam1}
          onChange={(e) => setLocalParam1(e.target.value)} onBlur={() => commitField("param1", localParam1)} />
      )}
      {cmd === "DO_AUX_FUNCTION" && (
        <div className="grid grid-cols-2 gap-2">
          <Input label={t("functionNum")} type="number" placeholder="0" value={localParam1}
            onChange={(e) => setLocalParam1(e.target.value)} onBlur={() => commitField("param1", localParam1)} />
          <Select label={t("switch")}
            options={[{ value: "0", label: t("low") }, { value: "1", label: t("mid") }, { value: "2", label: t("high") }]}
            value={String(waypoint.param2 ?? 0)} onChange={(v) => onUpdate({ param2: parseInt(v) })} />
        </div>
      )}
      {cmd === "DELAY" && (
        <Input label={t("delay")} type="number" unit="s" placeholder="0" value={localParam1}
          onChange={(e) => setLocalParam1(e.target.value)} onBlur={() => commitField("param1", localParam1)} />
      )}
      {cmd === "DO_SET_SPEED" && (
        <Input label={t("speed")} type="number" unit="m/s" placeholder="5" value={localParam2}
          onChange={(e) => setLocalParam2(e.target.value)} onBlur={() => commitField("param2", localParam2)} />
      )}
    </>
  );
}
