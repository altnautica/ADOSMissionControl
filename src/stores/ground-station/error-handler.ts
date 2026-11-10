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
import { AgentArmedRefusal, AgentHttpError } from "@/lib/agent/agent-client/transport";
import { refusalText } from "@/lib/hud/refusal";

interface ErrorEnvelope {
  error?: { code?: string; message?: string };
}

interface ErrorBody {
  detail?: string | ErrorEnvelope;
  message?: string;
  code?: unknown;
}

function parseBody(body: string): ErrorBody | null {
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed !== null && typeof parsed === "object" ? (parsed as ErrorBody) : null;
  } catch {
    return null;
  }
}

/** The agent's machine-readable error code: `detail.error.code`, else the
 *  top-level `code` of a `{"detail","code"}` refusal body. */
export function errorCode(err: unknown): string | null {
  if (!(err instanceof GroundStationApiError || err instanceof AgentHttpError)) return null;
  const parsed = parseBody(err.body);
  const detail = parsed?.detail;
  if (detail && typeof detail === "object" && detail.error?.code) return detail.error.code;
  return typeof parsed?.code === "string" ? parsed.code : null;
}

export function errorMessage(err: unknown): { message: string; status: number | null } {
  if (err instanceof GroundStationApiError || err instanceof AgentHttpError) {
    const parsed = parseBody(err.body);
    // A 409 refusal names its code at the top level (`{"detail","code"}`):
    // the operator reads it through the shared refusal text.
    if (err.status === 409 && typeof parsed?.code === "string" && parsed.code) {
      return { message: refusalText(parsed.code), status: err.status };
    }
    let parsedMsg: string | undefined = err.body;
    if (parsed) {
      const detail = parsed.detail;
      const detailMsg =
        detail && typeof detail === "object"
          ? (detail.error?.message ?? detail.error?.code)
          : detail;
      parsedMsg = detailMsg || parsed.message || err.body;
    }
    return { message: parsedMsg || err.message, status: err.status };
  }
  if (err instanceof Error) return { message: err.message, status: null };
  return { message: "Unknown error", status: null };
}

/**
 * The ONE code → operator-guidance table for a failed role switch. The
 * agent's fixable refusal codes become instructions the operator can act
 * on; anything else falls back to the decoded message. Every surface that
 * writes a role (the mesh store, the fleet board's relay cell) goes through
 * this so the same failure never reads as raw JSON on one surface and as
 * guidance on another.
 */
export function roleSwitchErrorMessage(
  err: unknown,
  role: GroundStationRole,
): string {
  const { message } = errorMessage(err);
  // An armed refusal is not a missing invite: name the actual cause.
  if (err instanceof AgentArmedRefusal) return message;
  switch (errorCode(err)) {
    case "E_MESH_NOT_CAPABLE":
      return "This node is not mesh-capable: mesh roles need two RTL8812-class radios. Plug in a second adapter; the agent detects it automatically.";
    case "E_NOT_PAIRED":
      // The invite flow only exists for the relay role.
      return role === "relay"
        ? "Relay role needs an approved invite bundle first. Pair with the receiver from the OLED, then retry."
        : message;
    default:
      return message;
  }
}
