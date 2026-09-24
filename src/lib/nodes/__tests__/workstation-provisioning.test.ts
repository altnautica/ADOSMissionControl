/**
 * @module nodes/workstation-provisioning.test
 * @description Which paired nodes get a workstation credential, and when again.
 * A drone paired alongside a workstation must be provisioned without anyone
 * asking; a re-pair of either node (a new owner key on the workstation
 * invalidates what it issued, a re-flashed drone lost its store) must be
 * provisioned again; a failure retries on a fixed interval; and an operator's
 * revoke is never undone behind their back. The end-to-end act issues on the
 * workstation, installs the issued token on the drone, and records both.
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";

// The link store is persisted; bind a deterministic in-memory localStorage
// before the store module is imported (createJSONStorage resolves it once).
vi.hoisted(() => {
  const mem = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
      key: (i: number) => Array.from(mem.keys())[i] ?? null,
      get length() {
        return mem.size;
      },
    },
  });
});

import {
  planProvisioning,
  provisionAndRecord,
  PROVISION_RETRY_MS,
} from "../workstation-provisioning";
import type { LocalNode } from "@/stores/local-nodes-store";
import {
  useWorkstationLinkStore,
  workstationLinkKey,
  type WorkstationLink,
} from "@/stores/workstation-link-store";

function node(deviceId: string, profile: LocalNode["profile"], pairedAt = 1): LocalNode {
  return {
    deviceId,
    name: deviceId,
    hostname: `http://${deviceId}.example.com:8080`,
    apiKey: `key-${deviceId}`,
    profile,
    pairedAt,
  };
}

const WS = node("ws", "workstation", 10);
const DRONE = node("drone", "drone", 20);
const GS = node("gs", "ground-station", 30);

function link(over: Partial<WorkstationLink>): WorkstationLink {
  return {
    workstationDeviceId: "ws",
    peerDeviceId: "drone",
    state: "provisioned",
    workstationPairedAt: 10,
    peerPairedAt: 20,
    at: 1000,
    ...over,
  };
}

const KEY = workstationLinkKey("ws", "drone");
/** The job-API prefix on the workstation's engine port (and the drone's
 * control front, where the install route lives). */
const COMPUTE_API = "/api/compute/";

describe("planProvisioning", () => {
  it("provisions every drone and ground station against every workstation", () => {
    const plan = planProvisioning([WS, DRONE, GS], {}, {}, 0);
    expect(plan.map((p) => [p.workstation.deviceId, p.peer.deviceId])).toEqual([
      ["ws", "drone"],
      ["ws", "gs"],
    ]);
    // A ground station only relays Atlas events: it gets the ingest lane alone.
    expect(plan[0].lanes).toContain("jobs.submit");
    expect(plan[1].lanes).toEqual(["atlas.ingest"]);
  });

  it("needs a workstation and a peer this GCS holds the keys of", () => {
    expect(planProvisioning([DRONE, GS], {}, {}, 0)).toEqual([]);
    expect(planProvisioning([WS], {}, {}, 0)).toEqual([]);
    expect(planProvisioning([WS, { ...DRONE, apiKey: "" }], {}, {}, 0)).toEqual([]);
  });

  it("leaves a provisioned link alone until either node is re-paired", () => {
    const links = { [KEY]: link({}) };
    expect(planProvisioning([WS, DRONE], links, {}, 99_999)).toEqual([]);
    expect(planProvisioning([{ ...WS, pairedAt: 11 }, DRONE], links, {}, 0)).toHaveLength(1);
    expect(planProvisioning([WS, { ...DRONE, pairedAt: 21 }], links, {}, 0)).toHaveLength(1);
  });

  it("retries a failed link on the fixed interval", () => {
    const links = { [KEY]: link({ state: "failed", at: 1000 }) };
    expect(planProvisioning([WS, DRONE], links, {}, 1000 + PROVISION_RETRY_MS - 1)).toEqual([]);
    expect(planProvisioning([WS, DRONE], links, {}, 1000 + PROVISION_RETRY_MS)).toHaveLength(1);
  });

  it("never re-provisions a revoked link on its own, even after a re-pair", () => {
    const links = { [KEY]: link({ state: "revoked" }) };
    expect(planProvisioning([WS, DRONE], links, {}, 99_999)).toEqual([]);
    expect(planProvisioning([WS, { ...DRONE, pairedAt: 21 }], links, {}, 99_999)).toEqual([]);
  });

  it("skips a link already being provisioned", () => {
    expect(planProvisioning([WS, DRONE], {}, { [KEY]: true }, 0)).toEqual([]);
  });
});

describe("provisionAndRecord", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useWorkstationLinkStore.setState({ links: {}, inFlight: {} });
  });

  function reply(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  it("issues on the workstation, installs the same token on the drone, and records it", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (new URL(url).port === "8092") {
          return reply(201, {
            id: "CRED1",
            peer_device_id: "drone",
            lanes: ["atlas.ingest", "jobs.submit"],
            created_at_ms: 5,
            credential: "nc1.CRED1.SECRET",
            workstation_node_id: "compute-abc",
          });
        }
        return reply(200, { installed: true });
      }),
    );
    const result = await provisionAndRecord({
      workstation: WS,
      peer: DRONE,
      lanes: ["atlas.ingest", "jobs.submit"],
    });
    expect(result.state).toBe("provisioned");
    expect(result.credentialId).toBe("CRED1");

    // Issued with the workstation's own key on its engine port.
    const issuedAt = new URL(calls[0].url);
    expect(issuedAt.host).toBe("ws.example.com:8092");
    expect(issuedAt.pathname).toBe(`${COMPUTE_API}node-credentials`);
    expect(new Headers(calls[0].init?.headers).get("X-ADOS-Key")).toBe("key-ws");
    // Installed on the drone with the drone's key, filed under the id the
    // workstation advertises.
    expect(calls[1].url).toBe("http://drone.example.com:8080/api/compute/workstation-credential");
    expect(new Headers(calls[1].init?.headers).get("X-ADOS-Key")).toBe("key-drone");
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({
      workstation_node_id: "compute-abc",
      credential: "nc1.CRED1.SECRET",
      lanes: ["atlas.ingest", "jobs.submit"],
    });
    expect(useWorkstationLinkStore.getState().links[KEY]?.state).toBe("provisioned");
    expect(useWorkstationLinkStore.getState().inFlight[KEY]).toBeUndefined();
  });

  it("records a refusal with the side that refused, and installs nothing", async () => {
    const fetchMock = vi.fn(async () => reply(409, { error: "this node is not paired" }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await provisionAndRecord({ workstation: WS, peer: DRONE, lanes: ["atlas.ingest"] });
    expect(result.state).toBe("failed");
    expect(result.error).toBe("workstation: this node is not paired");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
