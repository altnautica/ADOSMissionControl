/**
 * @license GPL-3.0-only
 *
 * Choosing which camera feeds the primary stream is a roster write: the agent
 * refuses the old role-switch route, so the switch reads the roster, promotes
 * the chosen device and writes the leg list back.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { switchPrimaryCamera } from "../agent-client/camera";
import type { CameraLegInput } from "../feature-types";

const CTX = { baseUrl: "http://192.168.1.50:8080", apiKey: "k" };

const ROSTER = {
  cameras: [
    {
      id: "main",
      source: "/dev/video0",
      device_path: "/dev/video0",
      role: "primary",
      purpose: ["feed"],
      enabled: true,
      state: "assigned",
    },
    {
      id: "belly",
      name: "Belly",
      source: "/dev/video2",
      device_path: "/dev/video2",
      role: null,
      purpose: [],
      enabled: false,
      state: "assigned",
    },
  ],
};

function mockAgent() {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = init?.method === "PUT" ? { ok: true } : ROSTER;
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("switchPrimaryCamera", () => {
  it("writes the roster with the chosen device as the enabled primary", async () => {
    const fetchMock = mockAgent();
    await switchPrimaryCamera(CTX, "/dev/video2");

    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(put?.[0]).toBe("http://192.168.1.50:8080/api/video/roster");
    const legs = (JSON.parse(String(put?.[1]?.body)) as { cameras: CameraLegInput[] })
      .cameras;
    const belly = legs.find((l) => l.source === "/dev/video2");
    expect(belly).toMatchObject({ id: "belly", role: "primary", enabled: true });
    // Exactly one primary survives, and the reserved id is not left on a
    // demoted leg.
    expect(legs.filter((l) => l.role === "primary")).toHaveLength(1);
    expect(legs.some((l) => l.id === "main" && l.role !== "primary")).toBe(false);
  });

  it("refuses a device the roster does not list, without writing", async () => {
    const fetchMock = mockAgent();
    await expect(switchPrimaryCamera(CTX, "/dev/video9")).rejects.toThrow(
      /\/dev\/video9/,
    );
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
  });

  it("skips the write when the device already feeds the primary stream", async () => {
    const fetchMock = mockAgent();
    await switchPrimaryCamera(CTX, "/dev/video0");
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
  });
});
