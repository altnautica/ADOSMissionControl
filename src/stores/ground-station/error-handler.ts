/**
 * Error normaliser for ground-station REST + WebSocket consumers.
 *
 * Every catch site in the ground-station store routes through this helper
 * so the UI sees a consistent shape regardless of whether the failure was
 * a thrown string, a native Error, a network failure, or a
 * GroundStationApiError carrying a JSON body.
 *
 * @license GPL-3.0-only
 */

import { GroundStationApiError } from "@/lib/api/ground-station-api";
import type { GroundStationRole } from "@/lib/api/ground-station/types";

export function errorMessage(err: unknown): { message: string; status: number | null } {
  if (err instanceof GroundStationApiError) {
    let parsedMsg = err.body;
    try {
      const parsed = JSON.parse(err.body) as { detail?: string; message?: string };
      parsedMsg = parsed.detail || parsed.message || err.body;
    } catch {
      // keep raw body
    }
    return { message: parsedMsg || err.message, status: err.status };
  }
  if (err instanceof Error) return { message: err.message, status: null };
  return { message: "Unknown error", status: null };
}

/**
 * The ONE status → operator-guidance table for a failed role switch. The two
 * statuses the agent answers with a fixable cause become instructions the
 * operator can act on; anything else falls back to the decoded message. Every
 * surface that writes a role (the mesh store, the fleet board's relay cell)
 * goes through this so the same failure never reads as raw JSON on one
 * surface and as guidance on another.
 */
export function roleSwitchErrorMessage(
  err: unknown,
  role: GroundStationRole,
): string {
  const { message, status } = errorMessage(err);
  if (status === 409 && role === "relay") {
    return "Relay role needs an approved invite bundle first. Pair with the receiver from the OLED, then retry.";
  }
  if (status === 403) {
    return "Mesh role requires mesh capability on this node. Rerun install.sh --with-mesh.";
  }
  return message;
}
