/**
 * @module protocol/command-resend.test
 * @description A command whose repeat is harmless is sent again when no
 * COMMAND_ACK arrives, with the COMMAND_LONG confirmation byte incremented; a
 * command that would act twice is sent once; any ACK stops the resends.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { CommandQueue } from "../command-queue";

/** The confirmation byte of each COMMAND_LONG frame sent. */
const confirmations = (frames: Uint8Array[]) => frames.map((f) => f[10 + 32]);

afterEach(() => {
  vi.useRealTimers();
});

describe("resend on a lost COMMAND_ACK", () => {
  it("resends a mode change with the confirmation incremented until acked", async () => {
    vi.useFakeTimers();
    const q = new CommandQueue(3000);
    const sent: Uint8Array[] = [];
    const result = q.sendCommand(176, [1, 4, 0, 0, 0, 0, 0], (d) => sent.push(d), 1, 1, 255, 190);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(confirmations(sent)).toEqual([0, 1, 2]);
    q.handleAck(176, 0, 1);
    expect((await result).success).toBe(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(sent).toHaveLength(3);
  });

  it("sends a camera trigger once", async () => {
    vi.useFakeTimers();
    const q = new CommandQueue(3000);
    const sent: Uint8Array[] = [];
    const result = q.sendCommand(203, [0, 0, 0, 0, 1, 0, 0], (d) => sent.push(d), 1, 1, 255, 190);
    await vi.advanceTimersByTimeAsync(3000);
    expect(sent).toHaveLength(1);
    expect((await result).success).toBe(false);
  });

  it("stops resending once the vehicle reports progress", async () => {
    vi.useFakeTimers();
    const q = new CommandQueue(3000);
    const sent: Uint8Array[] = [];
    void q.sendCommand(400, [1, 0, 0, 0, 0, 0, 0], (d) => sent.push(d), 1, 1, 255, 190);
    q.handleAck(400, 5, 1); // IN_PROGRESS
    await vi.advanceTimersByTimeAsync(2500);
    expect(sent).toHaveLength(1);
    q.clear();
  });
});
