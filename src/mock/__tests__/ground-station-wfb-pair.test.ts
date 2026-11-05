/**
 * @license GPL-3.0-only
 *
 * The demo ground station's fleet-key pair client answers with the agent's
 * reply shape and refuses a malformed request with the agent's codes.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { GroundStationApiError } from "@/lib/api/ground-station-api";
import { errorCode } from "@/stores/ground-station/error-handler";
import {
  DEMO_PAIR_DEVICE_ID,
  DEMO_PAIR_KEY_B64,
  demoGroundStationPair as demo,
} from "@/mock/ground-station-wfb-pair";

async function codeOf(p: Promise<unknown>): Promise<[number, string | null]> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(GroundStationApiError);
  return [(err as GroundStationApiError).status, errorCode(err)];
}

beforeEach(() => demo.reset());

describe("demo fleet-key pair", () => {
  it("installs the key and issues the first slot", async () => {
    const reply = await demo.pairDrone(DEMO_PAIR_KEY_B64, DEMO_PAIR_DEVICE_ID);
    expect(reply).toMatchObject({
      paired: true,
      paired_with_device_id: DEMO_PAIR_DEVICE_ID,
      role: "gs",
      fleet_slot: 0,
    });
    expect(reply.paired_at).not.toBeNull();
    expect(reply.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(reply.slots.map((s) => s.device_id)).toEqual([DEMO_PAIR_DEVICE_ID]);
  });

  it("joins a second drone on the same key without a fresh install, and re-pairs idempotently", async () => {
    await demo.pairDrone(DEMO_PAIR_KEY_B64, DEMO_PAIR_DEVICE_ID);
    const second = await demo.pairDrone(DEMO_PAIR_KEY_B64, "demo-drone-02");
    expect(second.fleet_slot).toBe(1);
    expect(second.paired_at).toBeNull();
    const again = await demo.pairDrone(DEMO_PAIR_KEY_B64, DEMO_PAIR_DEVICE_ID);
    expect(again.fleet_slot).toBe(0);
    expect(again.slots).toHaveLength(2);
  });

  it("validates the shared half and reports what became of it", async () => {
    expect(await codeOf(demo.pairDrone(DEMO_PAIR_KEY_B64, DEMO_PAIR_DEVICE_ID, btoa("short")))).toEqual([
      400,
      "E_SHARED_KEY_INVALID",
    ]);
    const first = await demo.pairDrone(DEMO_PAIR_KEY_B64, DEMO_PAIR_DEVICE_ID, DEMO_PAIR_KEY_B64);
    expect(first.shared_key).toBe("installed");
    const again = await demo.pairDrone(DEMO_PAIR_KEY_B64, "demo-drone-02", DEMO_PAIR_KEY_B64);
    expect(again.shared_key).toBe("unchanged");
    const other = btoa(String.fromCharCode(...new Array<number>(64).fill(9)));
    expect((await demo.pairDrone(DEMO_PAIR_KEY_B64, "demo-drone-03", other)).shared_key).toBe("mismatch");
    expect((await demo.pairDrone(DEMO_PAIR_KEY_B64, "demo-drone-04")).shared_key).toBeUndefined();
  });

  it("refuses a malformed key or device id with the agent's codes", async () => {
    expect(await codeOf(demo.pairDrone("", DEMO_PAIR_DEVICE_ID))).toEqual([400, "E_BLOB_REQUIRED"]);
    expect(await codeOf(demo.pairDrone("not base64!", DEMO_PAIR_DEVICE_ID))).toEqual([400, "E_BLOB_BASE64"]);
    expect(await codeOf(demo.pairDrone(btoa("short"), DEMO_PAIR_DEVICE_ID))).toEqual([
      400,
      "E_INVALID_KEY_BLOB",
    ]);
    expect(await codeOf(demo.pairDrone(DEMO_PAIR_KEY_B64, ""))).toEqual([400, "E_DEVICE_ID_REQUIRED"]);
    expect(await codeOf(demo.pairDrone(DEMO_PAIR_KEY_B64, "abc"))).toEqual([400, "E_DEVICE_ID_INVALID"]);
  });

  it("refuses a different fleet key until the station is unpaired", async () => {
    await demo.pairDrone(DEMO_PAIR_KEY_B64, DEMO_PAIR_DEVICE_ID);
    const other = btoa(String.fromCharCode(...new Array<number>(64).fill(9)));
    expect(await codeOf(demo.pairDrone(other, "demo-drone-02"))).toEqual([409, "E_FLEET_KEY_MISMATCH"]);
    expect(await demo.unpairDrone()).toEqual({ paired: false, role: "gs" });
    expect((await demo.pairDrone(other, "demo-drone-02")).fleet_slot).toBe(0);
  });
});
