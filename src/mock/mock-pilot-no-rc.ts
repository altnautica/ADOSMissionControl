/**
 * @module mock/mock-pilot-no-rc
 * @description The demo pilot's no-RC declaration. `rc_receiver:absent|present`
 * sets it (refused while armed; `absent` only in `ados` control, in an open
 * place, on ArduCopter), the state carries `rc_receiver: "absent"` only while
 * declared, and with it a confined place or leaving `ados` is refused, as the
 * real pilot does. The readiness rows follow the agent's: the posture line and
 * the link-loss action check.
 * @license GPL-3.0-only
 */

import type { Json } from "./mock-pilot-wire";

/** The link-loss window the demo pilot reports. */
export const DEMO_LINK_LOSS_S = 10;

/** The pilot's answer to `rc_receiver:<value>`: null when it takes it. The
 *  demo flies an ArduCopter, so the firmware check always passes. */
export function rcReceiverRefusal(value: string | undefined, seen: Json): string | null {
  if (value !== "absent" && value !== "present") return "bad_args";
  if (seen.armed === true) return "armed";
  if (value === "present") return null;
  if (seen.control_mode !== "ados") return "control_mode";
  return seen.place_class === "confined" ? "confined" : null;
}

/** What the no-RC declaration refuses: a confined place and leaving `ados`. */
export function noRcRefusal(verb: string, value: string | undefined, seen: Json): string | null {
  if (seen.rc_receiver !== "absent") return null;
  if (verb === "place_class" && value === "confined") return "rc_receiver_absent";
  if (verb === "control_mode" && value !== "ados") return "rc_receiver_absent";
  return null;
}

/** The readiness rows the declaration adds: the posture line (always ok) and
 *  the link-loss action (a hold blocks; a window past 15 s warns). */
export function noRcReadiness(seen: Json): Json[] {
  const action = typeof seen.link_loss_action === "string" ? seen.link_loss_action : "rth";
  const s = typeof seen.link_loss_s === "number" ? seen.link_loss_s : DEMO_LINK_LOSS_S;
  const hold = action === "hold" || action === "loiter";
  return [
    { id: "rc_receiver", ok: true, severity: "warn", msg: `No controller: stop it from this phone: Pause, Land or Return. If the link drops for ${s} s it ${action === "land" ? "lands" : "returns"}.` },
    { id: "rc_seen", ok: true, severity: "block", msg: "No controller detected" },
    {
      id: "link_loss_posture",
      ok: !hold && s <= 15,
      severity: hold ? "block" : "warn",
      msg: hold ? "Link-loss action is hold: with no RC it hovers until the battery is low" : `Link-loss action ${action} after ${s} s`,
    },
  ];
}
