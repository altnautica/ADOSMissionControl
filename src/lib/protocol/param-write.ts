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

/** A writer that can also persist what it wrote. */
export interface ParamBatchWriter extends ParamWriter {
  commitParamsToFlash(): Promise<CommandResult>;
}

export interface ParamBatchEntry {
  name: string;
  value: number;
  oldValue: number;
  rebootRequired?: boolean;
}

/**
 * What a flash commit achieved: `failed` never reached the vehicle (values are
 * RAM-only), `unacknowledged` went on the wire with no ACK, `acknowledged` was
 * confirmed by the vehicle. `skipped` means nothing landed, so nothing was sent.
 */
export type BatchFlashState = "skipped" | "failed" | "unacknowledged" | "acknowledged";

export interface ParamBatchOutcome {
  total: number;
  /** Names the vehicle acknowledged. */
  written: Set<string>;
  /** `NAME: reason` for every write that did not land. */
  failures: string[];
  flash: BatchFlashState;
  /** True when a parameter that landed needs an FC restart. */
  rebootRequired: boolean;
}

/**
 * Write a batch through {@link writeParamToFc}, then commit what landed to
 * flash. The caller runs {@link confirmArmedParamWrite} first. Pending-write
 * records clear only when the flash commit actually went out; a failed commit
 * leaves the values RAM-only on the vehicle, which is what "pending" means.
 */
export async function writeParamBatch(
  writer: ParamBatchWriter,
  entries: ParamBatchEntry[],
  panelId: string,
  onProgress?: (current: number, total: number) => void,
): Promise<ParamBatchOutcome> {
  const written = new Set<string>();
  const failures: string[] = [];
  let rebootRequired = false;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    onProgress?.(i + 1, entries.length);
    try {
      const result = await writeParamToFc({ writer, panelId, ...entry });
      if (result.success) {
        written.add(entry.name);
        if (entry.rebootRequired) rebootRequired = true;
      } else {
        failures.push(`${entry.name}: ${result.message}`);
      }
    } catch {
      failures.push(`${entry.name}: write failed`);
    }
  }

  let flash: BatchFlashState = "skipped";
  if (written.size > 0) {
    // ArduPilot writes PARAM_SET straight to EEPROM and PREFLIGHT_STORAGE is
    // sent without waiting for an ack, so awaiting it only reads what the send
    // reported. MSP firmwares persist nothing without this commit.
    let commit: CommandResult | null = null;
    try { commit = await writer.commitParamsToFlash(); } catch { commit = null; }
    if (!commit || !commit.success) flash = "failed";
    else flash = commit.acknowledged === false ? "unacknowledged" : "acknowledged";
    if (flash !== "failed") useParamSafetyStore.getState().commitFlash(true);
  }
  return { total: entries.length, written, failures, flash, rebootRequired };
}

/** The operator-facing summary of a batch write, one toast per batch. */
export function describeParamBatch(
  outcome: ParamBatchOutcome,
): { message: string; level: "success" | "info" | "error" } {
  if (outcome.written.size === 0) {
    return { message: `Failed to write ${outcome.failures.length} parameter(s)`, level: "error" };
  }
  const wrote = `Wrote ${outcome.written.size}/${outcome.total} parameter(s) to FC`;
  switch (outcome.flash) {
    case "acknowledged":
      return { message: `${wrote} and saved to flash`, level: outcome.failures.length > 0 ? "info" : "success" };
    case "unacknowledged":
      return { message: `${wrote}; flash commit sent (unacknowledged)`, level: "info" };
    default:
      return { message: `${wrote} — flash commit FAILED, changes are RAM-only`, level: "error" };
  }
}
