/**
 * Tests for useProgrammingStore.
 *
 * Uses minimal fake DroneProtocol implementations that resolve with fixture
 * data so tests run offline without a flight controller.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  useProgrammingStore,
  LOGIC_CONDITION_MAX,
  GVAR_MAX,
  PROGRAMMING_PID_MAX,
  STATUS_POLL_RETRY_MS,
} from "@/stores/programming-store";
import type { DroneProtocol } from "@/lib/protocol/types";
import type {
  INavLogicCondition,
  INavGvarStatus,
  INavProgrammingPid,
  INavProgrammingPidStatus,
} from "@/lib/protocol/msp/msp-decoders-inav";
import { inavDownloadLogicConditions } from "@/lib/protocol/msp-adapter/inav/programming";
import { encodeMspINavSetLogicCondition } from "@/lib/protocol/msp/msp-encoders-inav";

// ── Fixture helpers ───────────────────────────────────────────

function fakeCondition(override: Partial<INavLogicCondition> = {}): INavLogicCondition {
  return {
    enabled: true,
    activatorId: 0,
    operation: 1,
    operandAType: 0,
    operandAValue: 1500,
    operandBType: 0,
    operandBValue: 1000,
    flags: 0,
    ...override,
  };
}

function fakePid(override: Partial<INavProgrammingPid> = {}): INavProgrammingPid {
  return {
    enabled: true,
    setpointType: 0,
    setpointValue: 0,
    measurementType: 2,
    measurementValue: 0,
    gains: { P: 40, I: 10, D: 5, FF: 0 },
    ...override,
  };
}

function makeFakeProtocol(
  conditions: INavLogicCondition[] = [],
  pids: INavProgrammingPid[] = [],
  conditionStatuses: number[] = [],
  gvarStatus: INavGvarStatus = { values: [] },
  pidStatuses: INavProgrammingPidStatus[] = [],
): Partial<DroneProtocol> {
  return {
    downloadLogicConditions: vi.fn().mockResolvedValue(conditions),
    uploadLogicConditions: vi.fn().mockResolvedValue({ success: true, resultCode: 0, message: "ok" }),
    downloadLogicConditionsStatus: vi.fn().mockResolvedValue(conditionStatuses),
    downloadGvarStatus: vi.fn().mockResolvedValue(gvarStatus),
    setGvar: vi.fn().mockResolvedValue({ success: true, resultCode: 0, message: "ok" }),
    downloadProgrammingPids: vi.fn().mockResolvedValue(pids),
    uploadProgrammingPids: vi.fn().mockResolvedValue({ success: true, resultCode: 0, message: "ok" }),
    downloadProgrammingPidStatus: vi.fn().mockResolvedValue(pidStatuses),
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe("useProgrammingStore", () => {
  beforeEach(() => {
    useProgrammingStore.getState().clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    useProgrammingStore.getState().stopPolling();
    vi.useRealTimers();
  });

  // ── Initial state ─────────────────────────────────────────

  it("initialises with 64 disabled logic conditions", () => {
    const { conditions } = useProgrammingStore.getState();
    expect(LOGIC_CONDITION_MAX).toBe(64);
    expect(conditions).toHaveLength(LOGIC_CONDITION_MAX);
    expect(conditions.every((c) => !c.enabled)).toBe(true);
  });

  it("initialises with 4 disabled programming PIDs", () => {
    const { pids } = useProgrammingStore.getState();
    expect(pids).toHaveLength(PROGRAMMING_PID_MAX);
    expect(pids.every((p) => !p.enabled)).toBe(true);
  });

  it("initialises with empty gvarStatus", () => {
    expect(useProgrammingStore.getState().gvarStatus.values).toHaveLength(0);
  });

  // ── setCondition ─────────────────────────────────────────

  it("setCondition updates the slot and marks conditionsDirty", () => {
    useProgrammingStore.getState().setCondition(2, { enabled: true, operation: 3 });
    const { conditions, conditionsDirty } = useProgrammingStore.getState();
    expect(conditions[2].enabled).toBe(true);
    expect(conditions[2].operation).toBe(3);
    expect(conditionsDirty).toBe(true);
  });

  // ── setPid ────────────────────────────────────────────────

  it("setPid updates the slot and marks pidsDirty", () => {
    useProgrammingStore.getState().setPid(1, { enabled: true, gains: { P: 50, I: 20, D: 10, FF: 5 } });
    const { pids, pidsDirty } = useProgrammingStore.getState();
    expect(pids[1].enabled).toBe(true);
    expect(pids[1].gains.P).toBe(50);
    expect(pidsDirty).toBe(true);
  });

  // ── loadFromFc ────────────────────────────────────────────

  it("loadFromFc populates conditions and pids from protocol", async () => {
    const conditions = [fakeCondition(), fakeCondition({ enabled: false, operation: 7 })];
    const pids = [fakePid(), fakePid({ enabled: false })];
    const proto = makeFakeProtocol(conditions, pids);

    await useProgrammingStore.getState().loadFromFc(proto as DroneProtocol);

    const state = useProgrammingStore.getState();
    expect(state.conditions[0].enabled).toBe(true);
    expect(state.conditions[1].operation).toBe(7);
    expect(state.pids[0].gains.P).toBe(40);
    expect(state.conditionsDirty).toBe(false);
    expect(state.pidsDirty).toBe(false);
  });

  it("loadFromFc pads remaining slots to defaults", async () => {
    const proto = makeFakeProtocol([fakeCondition()], [fakePid()]);
    await useProgrammingStore.getState().loadFromFc(proto as DroneProtocol);
    const { conditions, pids } = useProgrammingStore.getState();
    expect(conditions).toHaveLength(LOGIC_CONDITION_MAX);
    expect(pids).toHaveLength(PROGRAMMING_PID_MAX);
    expect(conditions[1].enabled).toBe(false);
    expect(pids[1].enabled).toBe(false);
  });

  it("loadFromFc sets error when protocol methods are missing", async () => {
    const proto = {} as DroneProtocol;
    await useProgrammingStore.getState().loadFromFc(proto);
    expect(useProgrammingStore.getState().error).toBeTruthy();
  });

  // ── uploadConditions ──────────────────────────────────────

  it("uploadConditions writes every slot in one batch", async () => {
    useProgrammingStore.getState().setCondition(0, { enabled: true });
    const proto = makeFakeProtocol();
    expect(await useProgrammingStore.getState().uploadConditions(proto as DroneProtocol)).toBe(true);
    expect(proto.uploadLogicConditions).toHaveBeenCalledTimes(1);
    expect(vi.mocked(proto.uploadLogicConditions!).mock.calls[0][0]).toHaveLength(LOGIC_CONDITION_MAX);
    expect(useProgrammingStore.getState().conditionsDirty).toBe(false);
  });

  it("a failed condition upload stays dirty and reports the failure", async () => {
    useProgrammingStore.getState().setCondition(0, { enabled: true });
    const proto = makeFakeProtocol();
    vi.mocked(proto.uploadLogicConditions!).mockResolvedValue({ success: false, resultCode: -1, message: "not saved" });
    expect(await useProgrammingStore.getState().uploadConditions(proto as DroneProtocol)).toBe(false);
    expect(useProgrammingStore.getState().conditionsDirty).toBe(true);
    expect(useProgrammingStore.getState().error).toBe("not saved");
  });

  it("uploadConditions sets error when method is missing", async () => {
    const proto = {} as DroneProtocol;
    await useProgrammingStore.getState().uploadConditions(proto);
    expect(useProgrammingStore.getState().error).toBeTruthy();
  });

  // ── uploadPids ────────────────────────────────────────────

  it("uploadPids writes every slot in one batch", async () => {
    useProgrammingStore.getState().setPid(0, { enabled: true });
    const proto = makeFakeProtocol();
    expect(await useProgrammingStore.getState().uploadPids(proto as DroneProtocol)).toBe(true);
    expect(proto.uploadProgrammingPids).toHaveBeenCalledTimes(1);
    expect(vi.mocked(proto.uploadProgrammingPids!).mock.calls[0][0]).toHaveLength(PROGRAMMING_PID_MAX);
    expect(useProgrammingStore.getState().pidsDirty).toBe(false);
  });

  // ── placeProgram ──────────────────────────────────────────

  it("a blank slot that is enabled runs unconditionally (no activator)", () => {
    useProgrammingStore.getState().setCondition(3, { enabled: true });
    expect(useProgrammingStore.getState().conditions[3].activatorId).toBe(-1);
  });

  it("placeProgram refuses before the table has been read from the FC", () => {
    const result = useProgrammingStore.getState().placeProgram([fakeCondition()]);
    expect("error" in result).toBe(true);
    expect(useProgrammingStore.getState().conditionsDirty).toBe(false);
  });

  it("placeProgram keeps the FC's conditions and fills only free slots", async () => {
    const inUse = fakeCondition({ operation: 2, operandAType: 1, operandAValue: 6 });
    const switchedOff = fakeCondition({ enabled: false, operation: 3, operandBValue: 1500 });
    await useProgrammingStore.getState().loadFromFc(
      makeFakeProtocol([inUse, inUse, switchedOff]) as DroneProtocol,
    );
    // Program LC1 reads program LC0 (operand type 4 = logic condition).
    const program = [
      fakeCondition({ activatorId: -1, operation: 2, operandAType: 1, operandAValue: 5 }),
      fakeCondition({ activatorId: 0, operation: 18, operandAType: 0, operandAValue: 1, operandBType: 4, operandBValue: 0 }),
    ];
    const result = useProgrammingStore.getState().placeProgram(program);
    expect(result).toMatchObject({ slots: [3, 4] });
    const { conditions, conditionsDirty } = useProgrammingStore.getState();
    expect(conditions[0]).toEqual(inUse);
    expect(conditions[1]).toEqual(inUse);
    expect(conditions[2]).toEqual(switchedOff);
    expect(conditions[3].operandAValue).toBe(5);
    expect(conditions[4].operandBValue).toBe(3);
    expect(conditions[4].activatorId).toBe(3);
    expect(conditionsDirty).toBe(true);
  });

  it("placeProgram changes nothing when the program does not fit", async () => {
    const full = Array.from({ length: LOGIC_CONDITION_MAX - 1 }, () => fakeCondition());
    await useProgrammingStore.getState().loadFromFc(makeFakeProtocol(full) as DroneProtocol);
    const before = useProgrammingStore.getState().conditions;
    const result = useProgrammingStore.getState().placeProgram([fakeCondition(), fakeCondition()]);
    expect(result).toMatchObject({ error: expect.stringMatching(/needs 2 .* only 1/) });
    expect(useProgrammingStore.getState().conditions).toBe(before);
  });

  // ── writeGvar ─────────────────────────────────────────────

  it("initialises GVAR_MAX at 8", () => {
    expect(GVAR_MAX).toBe(8);
  });

  it("writeGvar calls setGvar and reflects the value locally", async () => {
    const proto = makeFakeProtocol();
    await useProgrammingStore.getState().writeGvar(proto as DroneProtocol, 3, 250);
    expect(proto.setGvar).toHaveBeenCalledWith(3, 250);
    expect(useProgrammingStore.getState().gvarStatus.values[3]).toBe(250);
  });

  it("writeGvar sets error when setGvar is missing", async () => {
    const proto = {} as DroneProtocol;
    await useProgrammingStore.getState().writeGvar(proto, 0, 1);
    expect(useProgrammingStore.getState().error).toBeTruthy();
  });

  // ── pollStatus ────────────────────────────────────────────

  it("pollStatus updates conditionsStatus, gvarStatus, pidStatus", async () => {
    const conditionStatuses = [1, 0, 7];
    const gvarStatus: INavGvarStatus = { values: Array.from({ length: GVAR_MAX }, (_, i) => i * 10) };
    const pidStatuses: INavProgrammingPidStatus[] = [{ id: 0, output: 42 }];
    const proto = makeFakeProtocol([], [], conditionStatuses, gvarStatus, pidStatuses);

    const outcome = await useProgrammingStore.getState().pollStatus(proto as DroneProtocol);

    expect(outcome).toEqual({ conditions: "ok", gvars: "ok", pids: "ok" });
    const state = useProgrammingStore.getState();
    expect(state.conditionsStatus[2]).toBe(7);
    expect(state.gvarStatus.values[2]).toBe(20);
    expect(state.pidStatus[0].output).toBe(42);
    expect(state.gvarStatusAt).not.toBeNull();
  });

  it("a failed global-variable read is reported and keeps the old read time", async () => {
    const good = makeFakeProtocol([], [], [], { values: [5, 6, 7, 8, 9, 10, 11, 12] });
    await useProgrammingStore.getState().pollStatus(good as DroneProtocol);
    const readAt = useProgrammingStore.getState().gvarStatusAt;

    vi.advanceTimersByTime(10_000);
    const failing = makeFakeProtocol();
    vi.mocked(failing.downloadGvarStatus!).mockRejectedValue(new Error("timeout"));
    const outcome = await useProgrammingStore.getState().pollStatus(failing as DroneProtocol);

    expect(outcome.gvars).toBe("failed");
    expect(useProgrammingStore.getState().gvarStatusAt).toBe(readAt);
    expect(useProgrammingStore.getState().gvarStatus.values[0]).toBe(5);
  });

  // ── polling timer ─────────────────────────────────────────

  it("startPolling polls on a chain and stopPolling ends it", async () => {
    const proto = makeFakeProtocol([], [], [1]);
    useProgrammingStore.getState().startPolling(proto as DroneProtocol, 500);

    await vi.advanceTimersByTimeAsync(1600);
    // Polls at 500, 1000 and 1500 ms, each scheduled after the last settled.
    expect(proto.downloadLogicConditionsStatus).toHaveBeenCalledTimes(3);

    useProgrammingStore.getState().stopPolling();
    await vi.advanceTimersByTimeAsync(1000);
    expect(proto.downloadLogicConditionsStatus).toHaveBeenCalledTimes(3);
  });

  it("never queues a new poll while the previous one is still in flight", async () => {
    const proto = makeFakeProtocol();
    const pending = Promise.withResolvers<number[]>();
    vi.mocked(proto.downloadLogicConditionsStatus!).mockReturnValue(pending.promise);
    useProgrammingStore.getState().startPolling(proto as DroneProtocol, 500);

    await vi.advanceTimersByTimeAsync(5000);
    expect(proto.downloadLogicConditionsStatus).toHaveBeenCalledTimes(1);

    pending.resolve([0]);
    await vi.advanceTimersByTimeAsync(500);
    expect(proto.downloadLogicConditionsStatus).toHaveBeenCalledTimes(2);
  });

  it("waits the fixed retry delay after a failed poll", async () => {
    const proto = makeFakeProtocol();
    vi.mocked(proto.downloadGvarStatus!).mockRejectedValue(new Error("timeout"));
    useProgrammingStore.getState().startPolling(proto as DroneProtocol, 500);

    await vi.advanceTimersByTimeAsync(500);
    expect(proto.downloadGvarStatus).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(STATUS_POLL_RETRY_MS - 1);
    expect(proto.downloadGvarStatus).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(proto.downloadGvarStatus).toHaveBeenCalledTimes(2);
  });

  it("startPolling does not start a second timer if already running", () => {
    const proto = makeFakeProtocol();
    useProgrammingStore.getState().startPolling(proto as DroneProtocol, 500);
    const timerBefore = useProgrammingStore.getState().pollingTimer;
    useProgrammingStore.getState().startPolling(proto as DroneProtocol, 500);
    const timerAfter = useProgrammingStore.getState().pollingTimer;
    expect(timerBefore).toBe(timerAfter);
  });

  // ── clear ─────────────────────────────────────────────────

  it("clear resets state to defaults and stops polling", () => {
    useProgrammingStore.getState().setCondition(0, { enabled: true });
    useProgrammingStore.getState().setPid(0, { enabled: true });
    useProgrammingStore.getState().clear();

    const state = useProgrammingStore.getState();
    expect(state.conditions.every((c) => !c.enabled)).toBe(true);
    expect(state.pids.every((p) => !p.enabled)).toBe(true);
    expect(state.conditionsDirty).toBe(false);
    expect(state.pidsDirty).toBe(false);
    expect(state.error).toBeNull();
    expect(state.pollingTimer).toBeNull();
  });
});

// ── Adapter: per-index logic-condition read ───────────────────

describe("inavDownloadLogicConditions (adapter)", () => {
  type FakeQueue = Parameters<typeof inavDownloadLogicConditions>[0];

  it("reads all 64 slots via MSP2_INAV_LOGIC_CONDITIONS_SINGLE (0x203b) with the index byte", async () => {
    const send = vi.fn(async (_id: number, payload?: Uint8Array) => {
      const idx = payload?.[0] ?? 0;
      // echo a distinct operandBValue per index so we can assert assembly order
      return { payload: encodeMspINavSetLogicCondition(fakeCondition({ operandBValue: idx })) };
    });
    const queue = { send } as unknown as FakeQueue;

    const result = await inavDownloadLogicConditions(queue);

    expect(result).toHaveLength(64);
    expect(send).toHaveBeenCalledTimes(64);
    // every request uses the single-condition id, not the dead bulk 0x2022
    expect(send.mock.calls.every((c) => c[0] === 0x203b)).toBe(true);
    // index byte increments 0..63
    expect(send.mock.calls.map((c) => c[1]?.[0])).toEqual(Array.from({ length: 64 }, (_, i) => i));
    // decoded values land in slot order
    expect(result[5].operandBValue).toBe(5);
    expect(result[63].operandBValue).toBe(63);
  });

  it("stops early when a slot read throws (shorter-slot firmware)", async () => {
    const send = vi.fn(async (_id: number, payload?: Uint8Array) => {
      const idx = payload?.[0] ?? 0;
      if (idx >= 3) throw new Error("out of range");
      return { payload: encodeMspINavSetLogicCondition(fakeCondition()) };
    });
    const queue = { send } as unknown as FakeQueue;

    const result = await inavDownloadLogicConditions(queue);
    expect(result).toHaveLength(3);
  });

  it("returns empty when the queue is null", async () => {
    expect(await inavDownloadLogicConditions(null)).toEqual([]);
  });
});
