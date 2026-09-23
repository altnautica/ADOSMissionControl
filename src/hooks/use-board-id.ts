/**
 * @module use-board-id
 * @description The connected flight controller's board id, as normalised by
 * the protocol adapter into `VehicleInfo.boardId`.
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";
import type { DroneProtocol } from "@/lib/protocol/types";

/**
 * Board id of `protocol`'s vehicle: `null` while AUTOPILOT_VERSION is pending,
 * `0` when the firmware reported no board id, otherwise the AP_FW_BOARD_ID.
 *
 * Seeds from the adapter's `VehicleInfo.boardId`, then follows each
 * AUTOPILOT_VERSION the adapter decodes. A protocol switch never shows the
 * previous vehicle's id: the reported value is keyed by the protocol it came from.
 */
export function useBoardId(protocol: DroneProtocol | null | undefined): number | null {
  const [reported, setReported] = useState<{ protocol: DroneProtocol; boardId: number } | null>(null);

  useEffect(() => {
    if (!protocol?.onAutopilotVersion) return;
    const unsub = protocol.onAutopilotVersion((info) => {
      setReported({ protocol, boardId: info.boardId ?? 0 });
    });
    protocol.requestMessage?.(148).catch(() => {});
    return unsub;
  }, [protocol]);

  if (!protocol) return null;
  if (reported?.protocol === protocol) return reported.boardId;
  return protocol.getVehicleInfo()?.boardId ?? null;
}
