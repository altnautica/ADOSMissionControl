/**
 * Unit tests for the ground-station store's error normaliser.
 *
 * The helper is the gate for every catch site in the store. It must
 * surface a readable message for the UI regardless of whether the
 * error is a thrown string, a native Error, a network failure, or a
 * GroundStationApiError carrying a JSON body with detail or message
 * fields.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import {
  errorMessage,
  roleSwitchErrorMessage,
} from "@/stores/ground-station-store";
import { GroundStationApiError } from "@/lib/api/ground-station-api";

describe("errorMessage", () => {
  it("returns the parsed detail field when the API body is JSON with a detail key", () => {
    const err = new GroundStationApiError(400, JSON.stringify({ detail: "WFB tx is busy" }));
    const result = errorMessage(err);
    expect(result.message).toBe("WFB tx is busy");
    expect(result.status).toBe(400);
  });

  it("falls back to the message field when the API body has no detail", () => {
    const err = new GroundStationApiError(409, JSON.stringify({ message: "Already paired" }));
    const result = errorMessage(err);
    expect(result.message).toBe("Already paired");
    expect(result.status).toBe(409);
  });

  it("returns the raw body when the API body is non-JSON", () => {
    const err = new GroundStationApiError(500, "Internal Server Error");
    const result = errorMessage(err);
    expect(result.message).toBe("Internal Server Error");
    expect(result.status).toBe(500);
  });

  it("propagates the status code on a 404 error", () => {
    const err = new GroundStationApiError(404, JSON.stringify({ detail: "Not found" }));
    const result = errorMessage(err);
    expect(result.message).toBe("Not found");
    expect(result.status).toBe(404);
  });

  it("returns null status for a thrown native Error", () => {
    const err = new Error("Network unreachable");
    const result = errorMessage(err);
    expect(result.message).toBe("Network unreachable");
    expect(result.status).toBe(null);
  });

  it("returns Unknown error with null status for a non-Error thrown value", () => {
    expect(errorMessage("oops")).toEqual({ message: "Unknown error", status: null });
    expect(errorMessage(undefined)).toEqual({ message: "Unknown error", status: null });
    expect(errorMessage(42)).toEqual({ message: "Unknown error", status: null });
  });

  it("preserves the API error's synthesized message when body is empty", () => {
    const err = new GroundStationApiError(503, "");
    const result = errorMessage(err);
    expect(result.message).toBe("Ground station API 503: ");
    expect(result.status).toBe(503);
  });

  it("prefers the parsed detail over the API error's synthesized message", () => {
    const err = new GroundStationApiError(
      422,
      JSON.stringify({ detail: "Invalid PIC token" }),
      "synthesized fallback",
    );
    const result = errorMessage(err);
    expect(result.message).toBe("Invalid PIC token");
    expect(result.status).toBe(422);
  });

  it("handles a JSON body that is neither detail nor message by returning the raw body", () => {
    const err = new GroundStationApiError(400, JSON.stringify({ code: "X" }));
    const result = errorMessage(err);
    expect(result.message).toBe(JSON.stringify({ code: "X" }));
    expect(result.status).toBe(400);
  });
});

/**
 * The role-switch guidance table is shared by every surface that writes a mesh
 * role, so the same agent refusal reads as the same operator instruction on
 * the mesh panel and on the fleet board's relay cell.
 */
describe("roleSwitchErrorMessage", () => {
  it("turns a 409 on relay into the invite-bundle instruction", () => {
    const err = new GroundStationApiError(
      409,
      JSON.stringify({ detail: "no approved invite bundle" }),
    );
    expect(roleSwitchErrorMessage(err, "relay")).toMatch(
      /approved invite bundle.*OLED/i,
    );
  });

  it("keeps the decoded detail for a 409 on a non-relay role", () => {
    const err = new GroundStationApiError(
      409,
      JSON.stringify({ detail: "role change already in progress" }),
    );
    expect(roleSwitchErrorMessage(err, "receiver")).toBe(
      "role change already in progress",
    );
  });

  it("turns a 403 into the mesh-capability instruction for any role", () => {
    const err = new GroundStationApiError(
      403,
      JSON.stringify({ detail: "mesh not installed" }),
    );
    expect(roleSwitchErrorMessage(err, "receiver")).toMatch(
      /mesh capability.*--with-mesh/i,
    );
  });

  it("falls back to the decoded message for any other failure", () => {
    const err = new GroundStationApiError(
      503,
      JSON.stringify({ detail: "sentinel not running" }),
    );
    expect(roleSwitchErrorMessage(err, "relay")).toBe("sentinel not running");
    expect(roleSwitchErrorMessage(new Error("Network unreachable"), "direct")).toBe(
      "Network unreachable",
    );
  });
});
