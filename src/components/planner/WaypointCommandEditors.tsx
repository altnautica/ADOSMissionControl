/**
 * @module WaypointCommandEditors
 * @description Command-specific parameter editors for the WaypointListItem expanded section.
 * @license GPL-3.0-only
 */
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

/** The subset of parameter fields the command editors read directly. Both a
 * navigation `Waypoint` and an attached `MissionAction` satisfy this shape, so
 * the same per-command editors drive waypoint params and action params alike. */
export interface EditableParams {
  param1?: number;
  param2?: number;
  param3?: number;
  param4?: number;
}

/** The fields the per-command editors commit; a superset of both a waypoint's
 * and an action's editable params (holdTime only ever fires for nav commands). */
type EditableField = "param1" | "param2" | "param3" | "holdTime";

interface CmdEditorProps {
  cmd: string;
  params: EditableParams;
  localParam1: string;
  localParam2: string;
  localParam3: string;
  localHoldTime: string;
  setLocalParam1: (v: string) => void;
  setLocalParam2: (v: string) => void;
  setLocalParam3: (v: string) => void;
  setLocalHoldTime: (v: string) => void;
  commitField: (field: EditableField, value: string) => void;
  onUpdate: (update: EditableParams) => void;
}

/**
 * Winch rate (MAVLink param4). Winch is an action-only command, so the rate
 * keeps its own draft value rather than widening the shared editor props.
 */
function WinchRateInput({ params, onUpdate }: Pick<CmdEditorProps, "params" | "onUpdate">) {
  const t = useTranslations("planner");
  const [draft, setDraft] = useState(params.param4 !== undefined ? String(params.param4) : "");
  return (
    <Input label={t("rate")} type="number" unit="m/s" placeholder="0" value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const num = parseFloat(draft);
        onUpdate({ param4: draft === "" || isNaN(num) ? undefined : num });
      }} />
  );
}

export function CommandSpecificEditors({
  cmd, params, localParam1, localParam2, localParam3, localHoldTime,
  setLocalParam1, setLocalParam2, setLocalParam3, setLocalHoldTime,
  commitField, onUpdate,
}: CmdEditorProps) {
  const t = useTranslations("planner");
  return (
    <>
      {/* MAVLink param1 is a hold time only for these; LOITER (unlimited) has none. */}
      {(cmd === "WAYPOINT" || cmd === "LOITER_TIME" || cmd === "SPLINE_WAYPOINT") && (
        <Input label={t("holdTime")} type="number" unit="s" placeholder="0"
          value={localHoldTime} onChange={(e) => setLocalHoldTime(e.target.value)}
          onBlur={() => commitField("holdTime", localHoldTime)} />
      )}
      {cmd === "LOITER_TURNS" && (
        // MAVLink LOITER_TURNS: param1 turns, param3 radius. The nav one-slot
        // shift puts holdTime in param1 and model param2 in param3.
        <div className="grid grid-cols-2 gap-2">
          <Input label={t("turns")} type="number" placeholder="1" value={localHoldTime}
            onChange={(e) => setLocalHoldTime(e.target.value)} onBlur={() => commitField("holdTime", localHoldTime)} />
          <Input label={t("radius")} type="number" unit="m" placeholder="0" value={localParam2}
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
            value={String(params.param2 ?? 0)} onChange={(v) => onUpdate({ param2: parseInt(v) })} />
        </div>
      )}
      {cmd === "DO_WINCH" && (
        // MAVLink DO_WINCH: param1 instance, param2 action, param3 length, param4 rate.
        <div className="grid grid-cols-2 gap-2">
          <Input label={t("winchNum")} type="number" placeholder="1" value={localParam1}
            onChange={(e) => setLocalParam1(e.target.value)} onBlur={() => commitField("param1", localParam1)} />
          <Select label={t("winchAction")}
            options={[
              { value: "0", label: t("winchRelax") },
              { value: "1", label: t("winchLength") },
              { value: "2", label: t("winchRate") },
            ]}
            value={String(params.param2 ?? 0)} onChange={(v) => onUpdate({ param2: parseInt(v) })} />
          <Input label={t("length")} type="number" unit="m" placeholder="0" value={localParam3}
            onChange={(e) => setLocalParam3(e.target.value)} onBlur={() => commitField("param3", localParam3)} />
          <WinchRateInput params={params} onUpdate={onUpdate} />
        </div>
      )}
      {cmd === "DO_FENCE_ENABLE" && (
        <Select label={t("fence")} options={[{ value: "0", label: t("disable") }, { value: "1", label: t("enable") }]}
          value={String(params.param1 ?? 0)} onChange={(v) => onUpdate({ param1: parseInt(v) })} />
      )}
      {cmd === "NAV_PAYLOAD_PLACE" && (
        // MAVLink PAYLOAD_PLACE param1 (max descent) is the nav holdTime slot.
        <Input label={t("maxDescent")} type="number" unit="m" placeholder="10" value={localHoldTime}
          onChange={(e) => setLocalHoldTime(e.target.value)} onBlur={() => commitField("holdTime", localHoldTime)} />
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
            value={String(params.param2 ?? 0)} onChange={(v) => onUpdate({ param2: parseInt(v) })} />
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
      {cmd === "DO_LAND_START" && (
        <p className="text-[9px] text-text-tertiary italic">
          Marks the start of a fixed-wing landing sequence. The flight controller uses this
          to begin the landing approach. Generated by the Landing Pattern tool.
        </p>
      )}
    </>
  );
}

// ── iNav navigation-command editors ───────────────────────────

interface INavCommandEditorProps {
  cmd: string;
  localParam1: string;
  localHoldTime: string;
  setLocalParam1: (v: string) => void;
  setLocalHoldTime: (v: string) => void;
  commitField: (field: EditableField, value: string) => void;
}

/**
 * Editors for the navigation commands an iNav waypoint maps onto. Each field
 * writes the model slot the iNav translator reads: POSHOLD_TIME hold time is
 * `holdTime` (MAVLink param1 → iNav p1) and the LAND site elevation is `param1`
 * (MAVLink param2 → iNav p2). The altitude datum (iNav p3 bit 0) follows the
 * waypoint's altitude frame. SET_POI, JUMP and SET_HEAD are attached actions
 * (ROI, DO_JUMP, CONDITION_YAW) in the action timeline.
 */
export function INavCommandEditors({
  cmd, localParam1, localHoldTime, setLocalParam1, setLocalHoldTime, commitField,
}: INavCommandEditorProps) {
  return (
    <>
      {cmd === "LOITER_TIME" && (
        <div className="flex flex-col gap-1">
          <Input label="Hold time" type="number" unit="s" placeholder="0"
            value={localHoldTime} onChange={(e) => setLocalHoldTime(e.target.value)}
            onBlur={() => commitField("holdTime", localHoldTime)} />
          <span className="text-[9px] text-text-tertiary">
            Time to loiter at this position before continuing.
          </span>
        </div>
      )}
      {cmd === "WAYPOINT" && (
        <span className="text-[9px] text-text-tertiary">
          Flies through this position at its speed, or the mission speed when blank.
        </span>
      )}
      {cmd === "LOITER" && (
        <span className="text-[9px] text-text-tertiary">
          Loiters at this position indefinitely. Mission does not advance automatically.
        </span>
      )}
      {cmd === "RTL" && (
        <span className="text-[9px] text-text-tertiary">
          Returns to home and lands. The mission ends here.
        </span>
      )}
      {cmd === "LAND" && (
        <div className="flex flex-col gap-1.5">
          <Input label="Elevation" type="number" unit="m" placeholder="0 (auto)" value={localParam1}
            onChange={(e) => setLocalParam1(e.target.value)} onBlur={() => commitField("param1", localParam1)} />
          <span className="text-[9px] text-text-tertiary">
            Landing-site elevation in the waypoint&apos;s altitude frame. 0 uses the takeoff/home
            elevation. Approach direction and landing heading are configured in the FW Approach panel.
          </span>
        </div>
      )}
    </>
  );
}
