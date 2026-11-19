/**
 * @license GPL-3.0-only
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NodeSensorsApi } from "@/lib/api/agent/sensors";
import { useNodeSensorsStore } from "@/stores/node-sensors-store";
import { DEMO_VISOR_CLOCK, DEMO_VISOR_SENSORS } from "@/mock/demo-seed/visor";

const BASE = "http://192.168.1.50:8080";

function respond(routes: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      const r = routes[path] ?? { status: 404, body: { error: "not found" } };
      return new Response(JSON.stringify(r.body), { status: r.status });
    }),
  );
}

beforeEach(() => useNodeSensorsStore.getState().clear());
afterEach(() => vi.unstubAllGlobals());

describe("node-sensors store load", () => {
  it("keeps every route that answered and reads an absent capture extension as null", async () => {
    respond({
      "/api/v1/sensors": { status: 200, body: DEMO_VISOR_SENSORS },
      "/api/v1/clock": { status: 200, body: DEMO_VISOR_CLOCK },
      "/api/v1/storage": { status: 500, body: { error: "boom" } },
    });
    await useNodeSensorsStore.getState().load("visor-1", new NodeSensorsApi(BASE, "k"));
    const s = useNodeSensorsStore.getState();
    expect(s.nodeId).toBe("visor-1");
    expect(s.sensors?.rig_id).toBe("visor-pro-01");
    expect(s.clock?.timebase).toBe("hub_freerun");
    expect(s.storage).toBeNull();
    // 404 on the extension's route: not installed, which is a reading.
    expect(s.sessions).toBeNull();
    expect(s.error).toBe("refused");
  });

  it("drops a late answer from a node the operator has left", async () => {
    // The old node's sensor read is held open until the new node's load lands.
    let releaseOld: () => void = () => {};
    const oldGate = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    const fakeApi = (rigId: string, gate: Promise<void>) =>
      ({
        getSensors: async () => {
          await gate;
          return { ...DEMO_VISOR_SENSORS, rig_id: rigId };
        },
        getClock: async () => DEMO_VISOR_CLOCK,
        getStorage: async () => null,
        getBattery: async () => null,
        listCaptureSessions: async () => null,
      }) as unknown as NodeSensorsApi;
    const store = useNodeSensorsStore.getState();
    const oldLoad = store.load("visor-1", fakeApi("old-rig", oldGate));
    await store.load("visor-2", fakeApi("new-rig", Promise.resolve()));
    releaseOld();
    await oldLoad;
    expect(useNodeSensorsStore.getState().nodeId).toBe("visor-2");
    expect(useNodeSensorsStore.getState().sensors?.rig_id).toBe("new-rig");
  });

  it("keeps a failed route's last good value with its original read time, never a fresh one", async () => {
    const api = (sensorsFail: boolean) =>
      ({
        getSensors: async () => {
          if (sensorsFail) throw new TypeError("Failed to fetch");
          return DEMO_VISOR_SENSORS;
        },
        getClock: async () => DEMO_VISOR_CLOCK,
        getStorage: async () => null,
        getBattery: async () => null,
        listCaptureSessions: async () => null,
      }) as unknown as NodeSensorsApi;
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000);
      await useNodeSensorsStore.getState().load("visor-1", api(false));
      vi.setSystemTime(9_000);
      await useNodeSensorsStore.getState().load("visor-1", api(true));
    } finally {
      vi.useRealTimers();
    }
    const s = useNodeSensorsStore.getState();
    expect(s.sensors?.rig_id).toBe(DEMO_VISOR_SENSORS.rig_id);
    expect(s.readAt.sensors).toBe(1_000);
    expect(s.readAt.clock).toBe(9_000);
    expect(s.fetchedAt).toBe(9_000);
    expect(s.error).toBe("unreachable");
  });

  it("reports an unanswered read as unreachable, never raw error text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    await useNodeSensorsStore.getState().load("visor-1", new NodeSensorsApi(BASE));
    expect(useNodeSensorsStore.getState().error).toBe("unreachable");
  });

  it("lists capture sessions newest first through the plugin passthrough", async () => {
    const session = (id: string, at: string) => ({ session_id: id, started_at_utc: at });
    respond({
      "/api/plugins/com.altnautica.capture/x/capture/sessions": {
        status: 200,
        body: { sessions: [session("a", "2026-10-18T10:00:00Z"), session("b", "2026-10-19T10:00:00Z")] },
      },
    });
    const list = await new NodeSensorsApi(BASE).listCaptureSessions();
    expect(list?.map((x) => x.session_id)).toEqual(["b", "a"]);
  });

  it("sends a rig document as the PUT body", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, rig_id: "r", calib_version: "c" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const rig = { rig_id: "r", calib_version: "c", sensors: [] };
    await new NodeSensorsApi(BASE, "k").putRig(rig);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/v1/sensors/rig`);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual(rig);
  });
});
