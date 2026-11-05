/**
 * @license GPL-3.0-only
 *
 * The ground-station fleet-key pair: what `pairDrone` sends to
 * `POST /api/v1/ground-station/wfb/pair`, how the store reads the agent's
 * reply, and how a refusal lands with its machine code.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GroundStationApi, type PairResult } from "@/lib/api/ground-station-api";
import { useGroundStationStore } from "@/stores/ground-station-store";
import { INITIAL_PAIR } from "@/stores/ground-station/initial-state";
import en from "../../../../../locales/en.json";
import { pairDrone, pairRequestBody, unpairDrone } from "../wfb";

const CTX = { baseUrl: "http://agent.test", apiKey: null };
const KEY_B64 = btoa(String.fromCharCode(...new Array<number>(64).fill(7)));

/** The agent's reply for a fresh install (`pair.rs` + `pair_state.rs`). */
const REPLY: PairResult = {
  paired: true,
  paired_with_device_id: "drone-0001",
  paired_at: "2026-11-05T10:00:00Z",
  fingerprint: "0011223344556677",
  role: "gs",
  fleet_slot: 2,
  slots: [
    {
      slot: 2,
      device_id: "drone-0001",
      paired_at_ms: 1_700_000_000_000,
      fc_system_id: null,
      system_id_conflict: false,
      video_hero: true,
      relay_credential: "pending",
    },
  ],
};

const DEPRECATED = JSON.stringify({
  detail: {
    error: {
      code: "E_PAIR_KEY_DEPRECATED",
      message: "typed pair_key is no longer supported; pass blob_b64 (base64 of 64-byte wfb-ng key) or use POST /api/wfb/pair/local-bind",
    },
  },
});

function stubFetch(status: number, body: string) {
  const fn = vi.fn(
    async () => new Response(body, { status, headers: { "Content-Type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

function sent(fetch: { mock: { calls: unknown[][] } }): { url: string; init: RequestInit } {
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  return { url, init };
}

afterEach(() => vi.unstubAllGlobals());

describe("pair request body", () => {
  it("sends blob_b64 and drone_device_id and never the retired pair_key", () => {
    const body = pairRequestBody(`${KEY_B64.slice(0, 40)}\n ${KEY_B64.slice(40)}\n`, "  drone-0001 ");
    expect(body).toEqual({ blob_b64: KEY_B64, drone_device_id: "drone-0001" });
    expect(body).not.toHaveProperty("pair_key");
  });

  it("adds shared_key_b64 only when the operator supplied the drone's half", () => {
    expect(pairRequestBody(KEY_B64, "drone-0001", "  ")).not.toHaveProperty("shared_key_b64");
    expect(pairRequestBody(KEY_B64, "drone-0001", ` ${KEY_B64}\n`)).toEqual({
      blob_b64: KEY_B64,
      drone_device_id: "drone-0001",
      shared_key_b64: KEY_B64,
    });
  });

  it("posts that body to the ground-station pair route", async () => {
    const fetch = stubFetch(200, JSON.stringify(REPLY));
    await expect(pairDrone(CTX, KEY_B64, "drone-0001")).resolves.toEqual(REPLY);
    const { url, init } = sent(fetch);
    expect(url).toBe("http://agent.test/api/v1/ground-station/wfb/pair");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      blob_b64: KEY_B64,
      drone_device_id: "drone-0001",
    });
  });

  it("unpairs with DELETE and reads the agent's {paired:false, role} reply", async () => {
    const fetch = stubFetch(200, JSON.stringify({ paired: false, role: "gs" }));
    await expect(unpairDrone(CTX)).resolves.toEqual({ paired: false, role: "gs" });
    expect(sent(fetch).init.method).toBe("DELETE");
  });
});

describe("pair store", () => {
  const api = new GroundStationApi(CTX.baseUrl);

  beforeEach(() => {
    useGroundStationStore.setState({ pair: INITIAL_PAIR });
  });

  it("keeps the reply's device id, fingerprint and fleet slot", async () => {
    stubFetch(200, JSON.stringify(REPLY));
    await useGroundStationStore.getState().startPair(api, KEY_B64, "drone-0001");
    const { pair, status } = useGroundStationStore.getState();
    expect(pair.error).toBeNull();
    expect(pair.result?.paired_with_device_id).toBe("drone-0001");
    expect(pair.result?.fingerprint).toBe("0011223344556677");
    expect(pair.result?.fleet_slot).toBe(2);
    expect(status?.paired_drone).toBe("drone-0001");
  });

  it("lands a 400 refusal with its status, code and message", async () => {
    stubFetch(400, DEPRECATED);
    await useGroundStationStore.getState().startPair(api, KEY_B64, "drone-0001");
    const { pair } = useGroundStationStore.getState();
    expect(pair.result).toBeNull();
    expect(pair.loading).toBe(false);
    expect(pair.errorStatus).toBe(400);
    expect(pair.errorCode).toBe("E_PAIR_KEY_DEPRECATED");
    expect(pair.error).toMatch(/no longer supported/);
  });

  it("explains every refusal code the pair route returns in plain words", () => {
    const errors = en.hardware.pair.errors as Record<string, string>;
    for (const code of [
      "E_PAIR_KEY_DEPRECATED",
      "E_BLOB_REQUIRED",
      "E_BLOB_BASE64",
      "E_INVALID_KEY_BLOB",
      "E_DEVICE_ID_REQUIRED",
      "E_DEVICE_ID_INVALID",
      "E_SHARED_KEY_INVALID",
      "E_FLEET_KEY_MISMATCH",
      "E_FLEET_FULL",
      "E_FLEET_PERSIST_FAILED",
      "E_PAIR_FAILED",
      "E_PROFILE_MISMATCH",
    ]) {
      expect(errors[code], code).toMatch(/\S/);
    }
  });
});
