/**
 * @license GPL-3.0-only
 *
 * A failed agent call reads as a sentence: a known code as its localized
 * text, else the agent's own reason, else the caller's fallback. Never the
 * raw `Agent API <status>: <body>` text.
 */

import { describe, expect, it } from "vitest";

import {
  AgentHttpError,
  describeAgentError,
  type AgentErrorText,
} from "@/lib/agent/agent-client/transport";

const codes: Record<string, string> = { E_ARMED: "The drone is armed." };
const codeText: AgentErrorText = Object.assign((code: string) => codes[code] ?? code, {
  has: (code: string) => code in codes,
});

describe("describeAgentError", () => {
  it("maps a known code, top level or under detail", () => {
    expect(describeAgentError(new AgentHttpError(409, '{"error":"E_ARMED"}'), "x", codeText)).toBe(
      "The drone is armed.",
    );
    expect(
      describeAgentError(new AgentHttpError(409, '{"detail":{"error":"E_ARMED"}}'), "x", codeText),
    ).toBe("The drone is armed.");
  });

  it("uses the agent's own reason for an unknown code", () => {
    expect(
      describeAgentError(new AgentHttpError(422, '{"detail":"SSID is too long"}'), "x", codeText),
    ).toBe("SSID is too long");
  });

  it("falls back for a validation list, a non-JSON body, or a network error", () => {
    const fb = "Could not apply the change.";
    expect(
      describeAgentError(new AgentHttpError(422, '{"detail":[{"loc":["body"],"msg":"bad"}]}'), fb),
    ).toBe(fb);
    expect(describeAgentError(new AgentHttpError(500, "<html>"), fb)).toBe(fb);
    expect(describeAgentError(new TypeError("Failed to fetch"), fb)).toBe(fb);
  });
});
