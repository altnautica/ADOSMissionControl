/**
 * Role-switch guidance and nested agent error decoding.
 *
 * The guidance table is shared by every surface that writes a mesh role,
 * so the same agent refusal reads as the same operator instruction on the
 * mesh panel and on the fleet board's relay cell.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import {
  errorCode,
  errorMessage,
  roleSwitchErrorMessage,
} from "@/stores/ground-station/error-handler";
import { AgentHttpError } from "@/lib/agent/agent-client/transport";
import { refusalText } from "@/lib/hud/refusal";
import { GroundStationApiError } from "@/lib/api/ground-station-api";

function coded(status: number, code: string, message?: string) {
  return new GroundStationApiError(
    status,
    JSON.stringify({ detail: { error: { code, ...(message ? { message } : {}) } } }),
  );
}

describe("roleSwitchErrorMessage", () => {
  it.each(["relay", "receiver"] as const)(
    "turns E_MESH_NOT_CAPABLE into the second-radio instruction for %s",
    (role) => {
      const msg = roleSwitchErrorMessage(coded(409, "E_MESH_NOT_CAPABLE"), role);
      expect(msg).toMatch(/not mesh-capable.*two RTL8812-class radios/);
      expect(msg).not.toContain("--with-mesh");
    },
  );

  it("turns E_NOT_PAIRED on relay into the invite-bundle instruction", () => {
    const err = coded(409, "E_NOT_PAIRED", "relay role requires a completed pair with a receiver");
    expect(roleSwitchErrorMessage(err, "relay")).toMatch(/approved invite bundle.*OLED/i);
  });

  it("keeps the decoded message for an uncoded failure", () => {
    const err = new GroundStationApiError(409, JSON.stringify({ detail: "role change already in progress" }));
    expect(roleSwitchErrorMessage(err, "receiver")).toBe("role change already in progress");
    expect(roleSwitchErrorMessage(new Error("Network unreachable"), "direct")).toBe(
      "Network unreachable",
    );
  });

  it("no longer maps a bare 403 to install advice", () => {
    const err = new GroundStationApiError(403, JSON.stringify({ detail: "forbidden" }));
    expect(roleSwitchErrorMessage(err, "relay")).toBe("forbidden");
  });
});

describe("errorMessage with nested detail", () => {
  it("uses detail.error.message when present", () => {
    expect(errorMessage(coded(409, "E_NOT_PAIRED", "pair first")).message).toBe("pair first");
  });

  it("falls back to detail.error.code and always returns a string", () => {
    const { message } = errorMessage(coded(409, "E_MESH_NOT_CAPABLE"));
    expect(message).toBe("E_MESH_NOT_CAPABLE");
    expect(typeof message).toBe("string");
  });
});

describe("agent 409 refusal bodies with a top-level code", () => {
  it("reads the code and renders it through the shared refusal text", () => {
    const err = new AgentHttpError(409, JSON.stringify({ detail: "not in GUIDED", code: "bad_state" }));
    expect(errorCode(err)).toBe("bad_state");
    expect(errorMessage(err)).toEqual({ message: refusalText("bad_state"), status: 409 });
    expect(errorMessage(err).message).not.toContain("bad_state");
  });

  it("keeps an unknown code readable through the lookup's fallback", () => {
    const err = new AgentHttpError(409, JSON.stringify({ detail: "x", code: "brand_new" }));
    expect(errorMessage(err).message).toBe(refusalText("brand_new"));
  });
});
