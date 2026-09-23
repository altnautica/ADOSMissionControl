/**
 * The one way a flight-controller parameter is written from this GCS.
 *
 * Two panels write parameters: the curated FC panels through `usePanelParams`,
 * and the raw Parameters grid. They used to be two independent implementations
 * with different safety semantics — the grid had no armed confirmation and
 * recorded nothing in the param-safety store, so the same edit to the same byte
 * on the same vehicle produced a confirmation dialog and a pending-write
 * highlight from one surface and neither from the other. Both now call through
 * here, so there is one write contract and one place to change it.
 *
 * What a write owes the operator, and what this enforces:
 *   - an armed vehicle gets an explicit confirmation naming the parameters
 *   - a successful write is recorded as pending until a flash commit lands
 *   - a reboot-required parameter is recorded so the banner can say so
 *   - the vehicle's own answer is returned, never swallowed
 *
 * @module protocol/param-write
 * @license GPL-3.0-only
 */

import { useDroneStore } from "@/stores/drone-store";
import { useArmedConfirmStore } from "@/stores/armed-confirm-store";
import { useParamSafetyStore } from "@/stores/param-safety-store";
import { useDiagnosticsStore } from "@/stores/diagnostics-store";
import type { CommandResult } from "@/lib/protocol/types";

/** The single protocol method a parameter write needs. */
export interface ParamWriter {
  setParameter(name: string, value: number): Promise<CommandResult>;
}

export interface ParamWriteRequest {
  writer: ParamWriter;
  name: string;
  value: number;
  /** Value on the vehicle before this write, for the pending-write record. */
  oldValue: number;
  /** Panel the pending-write record is attributed to. */
  panelId: string;
  /** True when this parameter needs an FC restart to take effect. */
  rebootRequired?: boolean;
}

/**
 * Ask the operator to confirm a write while the vehicle is armed.
 *
 * Returns true when the write may proceed: either the vehicle is not armed (or
 * not connected, so nothing is flying) or the operator explicitly opted in. A
 * disarmed vehicle is never interrupted.
 */
export async function confirmArmedParamWrite(
  panelId: string,
  paramNames: string[],
): Promise<boolean> {
  if (paramNames.length === 0) return true;
  const { armState, connectionState } = useDroneStore.getState();
  if (armState !== "armed" || connectionState === "disconnected") return true;
  return useArmedConfirmStore
    .getState()
    .requestConfirm({ panelId, paramNames });
}

/**
 * Write one parameter and record what it did. Returns the vehicle's result
 * unchanged; a thrown transport error propagates to the caller, which knows
 * whether it is writing one parameter or the twentieth of a batch.
 */
export async function writeParamToFc(
  req: ParamWriteRequest,
): Promise<CommandResult> {
  const { writer, name, value, oldValue, panelId, rebootRequired } = req;
  const result = await writer.setParameter(name, value);
  if (!result.success) return result;

  const safety = useParamSafetyStore.getState();
  // Pending until a flash commit: the value is in RAM on the vehicle and a
  // power cycle loses it, which is exactly what the grid's highlight means.
  safety.trackWrite(name, oldValue, value, panelId);
  if (rebootRequired) safety.trackRebootParam(name);
  useDiagnosticsStore.getState().logEvent("param_write", `${name} = ${value}`);
  return result;
}
