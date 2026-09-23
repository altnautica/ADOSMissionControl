/**
 * Relayed command results land in the stores with the agent's real route
 * bodies: `/api/logs` answers an object carrying `entries`, and
 * `/api/services` an object carrying `services`.
 *
 * @license GPL-3.0-only
 */

import { beforeEach, describe, expect, it } from "vitest";
import { routeCommandResult } from "../CloudCommandResultBridge";
import { useAgentSystemStore } from "@/stores/agent-system-store";

describe("cloud command result routing", () => {
  beforeEach(() => {
    useAgentSystemStore.setState({ logs: [], services: [] });
  });

  it("maps get_logs entries to chronological log rows", () => {
    // Body of the agent's GET /api/logs (legacy entry shape), newest first.
    routeCommandResult("get_logs", {
      entries: [
        { seq: 2, timestamp: "2026-01-01T00:00:02+00:00", level: "WARNING", logger: "ados.mavlink", message: "late" },
        { seq: 1, timestamp: "2026-01-01T00:00:01+00:00", level: "INFO", logger: "ados.video", message: "early" },
      ],
      total: 2,
      limit: 200,
      offset: 0,
    });
    expect(useAgentSystemStore.getState().logs).toEqual([
      { timestamp: "2026-01-01T00:00:01+00:00", level: "info", service: "ados.video", message: "early" },
      { timestamp: "2026-01-01T00:00:02+00:00", level: "warning", service: "ados.mavlink", message: "late" },
    ]);
  });

  it("maps get_services from the services array of the route body", () => {
    // Body of the agent's GET /api/services.
    routeCommandResult("get_services", {
      services: [{ name: "ados-video", state: "running", pid: 42 }],
      systemd_available: true,
      process: { pid: 1, cpu_percent: 0, memory_mb: 10 },
    });
    const services = useAgentSystemStore.getState().services;
    expect(services).toHaveLength(1);
    expect(services[0].name).toBe("ados-video");
  });
});
