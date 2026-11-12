/**
 * Only a real HTTP(S) agent yields a MAVLink WebSocket URL.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { agentMavlinkWsUrl } from "@/stores/agent-connection/client-manager/mavlink-url";

describe("agentMavlinkWsUrl", () => {
  it("derives the MAVLink socket from an HTTP agent", () => {
    expect(agentMavlinkWsUrl("http://drone.local:8080")).toBe("ws://drone.local:8765/");
    expect(agentMavlinkWsUrl("https://10.0.0.5")).toBe("ws://10.0.0.5:8765/");
  });

  it("has none for the demo agent", () => {
    expect(agentMavlinkWsUrl("mock://demo")).toBeNull();
  });

  it("has none for a malformed URL", () => {
    expect(agentMavlinkWsUrl("not a url")).toBeNull();
  });
});
