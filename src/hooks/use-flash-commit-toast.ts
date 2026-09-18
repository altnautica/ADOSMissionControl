/**
 * @module hooks/use-flash-commit-toast
 * @description Shared result toast for FC panels that write parameters to
 * flash. Keeps the string copy consistent across the 20+ panels that call
 * `commitToFlash()` from `usePanelParams`.
 *
 * There are THREE outcomes, not two. `MAV_CMD_PREFLIGHT_STORAGE` is sent
 * fire-and-forget, so a command that reached the wire without a COMMAND_ACK is
 * neither a failure nor a confirmed write — and reporting it as "persists after
 * reboot" is a surface asserting a value nothing measured. `commitToFlash()`
 * carries that distinction out; this hook renders it.
 *
 * Usage:
 *
 *   const { showFlashResult } = useFlashCommitToast();
 *   async function handleFlash() {
 *     showFlashResult(await commitToFlash());
 *   }
 *
 * Override the confirmed-success copy per panel when the default "persists
 * after reboot" framing is misleading (e.g. panels that only persist a subset):
 *
 *   showFlashResult(outcome, { successMessage: "Written to flash" });
 *
 * @license GPL-3.0-only
 */

import { useCallback } from "react";
import { useToast } from "@/components/ui/toast";

const DEFAULT_SUCCESS = "Written to flash — persists after reboot";
const DEFAULT_UNACKNOWLEDGED = "Flash commit sent — vehicle did not acknowledge it";
const DEFAULT_ERROR = "Failed to write to flash";

/**
 * What a flash commit actually achieved.
 *
 * - `sent: false` — the command never reached the vehicle.
 * - `sent: true, acknowledged: false` — it went on the wire and nothing
 *   confirmed the write. NEVER report this as written.
 * - `sent: true, acknowledged: true` — the vehicle ACKed the store.
 */
export interface FlashCommitOutcome {
  sent: boolean;
  acknowledged: boolean;
}

export interface FlashResultOptions {
  /** Override the acknowledged-success message for a specific panel. */
  successMessage?: string;
  /** Override the unacknowledged message for a specific panel. */
  unacknowledgedMessage?: string;
  /** Override the error message for a specific panel. */
  errorMessage?: string;
}

export interface FlashCommitToast {
  /** Report a flash-commit outcome: success, unacknowledged, or failure. */
  showFlashResult: (
    outcome: FlashCommitOutcome,
    options?: FlashResultOptions,
  ) => void;
}

export function useFlashCommitToast(): FlashCommitToast {
  const { toast } = useToast();

  const showFlashResult = useCallback(
    (outcome: FlashCommitOutcome, options?: FlashResultOptions) => {
      if (!outcome.sent) {
        toast(options?.errorMessage ?? DEFAULT_ERROR, "error");
        return;
      }
      if (!outcome.acknowledged) {
        toast(options?.unacknowledgedMessage ?? DEFAULT_UNACKNOWLEDGED, "warning");
        return;
      }
      toast(options?.successMessage ?? DEFAULT_SUCCESS, "success");
    },
    [toast],
  );

  return { showFlashResult };
}
