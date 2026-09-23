/**
 * @module agent-null-readings.test
 * @description The agent sends an explicit `null` for a reading it could not
 * take or a field that has no value. These tests drive the real client calls
 * (schema parse included) with the agent's wire bodies so a null never turns
 * into a measured-looking 0 or a schema rejection.
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { getPairingInfo } from "../agent-client/extras";
import { getServices, getSystemResources } from "../agent-client/system";
import type { RequestContext } from "../agent-client/transport";

const CTX: RequestContext = { baseUrl: "http://192.168.1.50:8080", apiKey: "k" };

function serve(body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getSystemResources with the degraded body", () => {
  // The agent's `/api/system` when its hardware store is unreachable.
  const DEGRADED = {
    cpu_percent: null,
    cpu_count: null,
    memory_total_mb: null,
    memory_used_mb: null,
    memory_available_mb: null,
    memory_cache_mb: null,
    memory_percent: null,
    swap_total_mb: null,
    swap_used_mb: null,
    swap_percent: null,
    disk_total_gb: null,
    disk_used_gb: null,
    disk_percent: null,
    temperatures: {},
    available: false,
  };

  it("reports every unread utilisation and capacity as unknown, not 0", async () => {
    serve(DEGRADED);
    const res = await getSystemResources(CTX);
    expect(res.cpu_percent).toBeUndefined();
    expect(res.memory_percent).toBeUndefined();
    expect(res.memory_used_mb).toBeUndefined();
    expect(res.memory_total_mb).toBeUndefined();
    expect(res.disk_percent).toBeUndefined();
    expect(res.disk_used_gb).toBeUndefined();
    expect(res.disk_total_gb).toBeUndefined();
    expect(res.temperature).toBeNull();
  });
});

describe("getServices with the native body", () => {
  it("keeps metrics the agent did not measure as null", async () => {
    serve([
      {
        name: "ados-control",
        active: true,
        state: "running",
        sub_state: "running",
        pid: null,
        load_state: "loaded",
        memory_mb: null,
      },
    ]);
    const [svc] = await getServices(CTX);
    expect(svc.memory_mb).toBeNull();
    expect(svc.cpu_percent).toBeNull();
    expect(svc.uptime_seconds).toBeNull();
  });
});

describe("getPairingInfo with the full identity body", () => {
  const BASE = {
    device_id: "abc123",
    name: "my-drone",
    version: "0.99.0",
    board: "unknown",
    radio_paired: false,
    radio_peer_device_id: null,
    mdns_host: "ados-abc123.local",
    profile: "drone",
    role: null,
    runtime_mode: "packaged",
    bind_state: null,
    radio: null,
    fc_connected: false,
    fc_port: null,
    fc_baud: null,
  };

  it("parses an unpaired node (owner and pair time null)", async () => {
    serve({
      ...BASE,
      paired: false,
      pairing_code: "K3J9QZ",
      owner_id: null,
      paired_at: null,
    });
    const info = await getPairingInfo(CTX);
    expect(info.paired).toBe(false);
    expect(info.pairing_code).toBe("K3J9QZ");
    expect(info.owner_id).toBeNull();
    expect(info.paired_at).toBeNull();
  });

  it("parses a paired node (pairing code null)", async () => {
    serve({
      ...BASE,
      paired: true,
      pairing_code: null,
      owner_id: "user-1",
      paired_at: 1_750_000_000.5,
    });
    const info = await getPairingInfo(CTX);
    expect(info.paired).toBe(true);
    expect(info.pairing_code).toBeNull();
    expect(info.owner_id).toBe("user-1");
    expect(info.paired_at).toBe(1_750_000_000.5);
  });
});
