import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@/lib/protocol/mavlink-encoder', () => ({
  encodeCommandLong: vi.fn(() => new Uint8Array(42)),
}));

import { CommandQueue, MAV_RESULT } from '@/lib/protocol/command-queue';

describe('CommandQueue', () => {
  let queue: CommandQueue;
  let sendFn: ReturnType<typeof vi.fn>;
  const params: [number, number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0, 0];

  beforeEach(() => {
    vi.useFakeTimers();
    queue = new CommandQueue(3000);
    sendFn = vi.fn();
  });

  afterEach(() => {
    queue.clear();
    vi.useRealTimers();
  });

  // ── Happy path ──

  it('resolves with success on ACCEPTED ACK', async () => {
    const promise = queue.sendCommand(400, params, sendFn, 1, 1, 255, 190);
    queue.handleAck(400, MAV_RESULT.ACCEPTED);
    const result = await promise;
    expect(result.success).toBe(true);
    expect(result.resultCode).toBe(0);
    expect(result.message).toBe('Command accepted');
  });

  it('calls sendFn with encoded frame', async () => {
    const promise = queue.sendCommand(400, params, sendFn, 1, 1, 255, 190);
    expect(sendFn).toHaveBeenCalledOnce();
    expect(sendFn).toHaveBeenCalledWith(expect.any(Uint8Array));
    queue.handleAck(400, MAV_RESULT.ACCEPTED);
    await promise;
  });

  // ── Failure ACK codes ──

  it('resolves failure on DENIED (2)', async () => {
    const promise = queue.sendCommand(400, params, sendFn, 1, 1, 255, 190);
    queue.handleAck(400, MAV_RESULT.DENIED);
    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.resultCode).toBe(2);
    expect(result.message).toBe('Command denied');
  });

  it('resolves failure on UNSUPPORTED (3)', async () => {
    const promise = queue.sendCommand(400, params, sendFn, 1, 1, 255, 190);
    queue.handleAck(400, MAV_RESULT.UNSUPPORTED);
    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.resultCode).toBe(3);
    expect(result.message).toBe('Command unsupported');
  });

  it('resolves failure on FAILED (4)', async () => {
    const promise = queue.sendCommand(400, params, sendFn, 1, 1, 255, 190);
    queue.handleAck(400, MAV_RESULT.FAILED);
    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.resultCode).toBe(4);
    expect(result.message).toBe('Command failed');
  });

  it('resolves failure on CANCELLED (6)', async () => {
    const promise = queue.sendCommand(400, params, sendFn, 1, 1, 255, 190);
    queue.handleAck(400, MAV_RESULT.CANCELLED);
    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.resultCode).toBe(6);
    expect(result.message).toBe('Command cancelled');
  });

  // ── Timeout ──

  it('resolves failure after timeout', async () => {
    const promise = queue.sendCommand(400, params, sendFn, 1, 1, 255, 190);
    vi.advanceTimersByTime(3000);
    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.resultCode).toBe(-1);
    expect(result.message).toContain('timed out');
    expect(result.message).toContain('3000');
  });

  it('uses custom timeout per command', async () => {
    const promise = queue.sendCommand(400, params, sendFn, 1, 1, 255, 190, 500);
    vi.advanceTimersByTime(499);
    expect(queue.pendingCount).toBe(1);
    vi.advanceTimersByTime(2);
    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.message).toContain('500ms');
  });

  // ── IN_PROGRESS ──

  it('IN_PROGRESS resets timeout and keeps pending', async () => {
    const promise = queue.sendCommand(400, params, sendFn, 1, 1, 255, 190);
    vi.advanceTimersByTime(2500);
    queue.handleAck(400, MAV_RESULT.IN_PROGRESS);
    // Timer reset, should still be pending after another 2500ms
    vi.advanceTimersByTime(2500);
    expect(queue.pendingCount).toBe(1);
    // Now accept it
    queue.handleAck(400, MAV_RESULT.ACCEPTED);
    const result = await promise;
    expect(result.success).toBe(true);
  });

  it('IN_PROGRESS times out after reset timeout', async () => {
    const promise = queue.sendCommand(400, params, sendFn, 1, 1, 255, 190);
    queue.handleAck(400, MAV_RESULT.IN_PROGRESS);
    vi.advanceTimersByTime(3000);
    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.message).toContain('IN_PROGRESS');
  });

  // ── Superseding ──

  it('superseding: duplicate command ID rejects old, replaces', async () => {
    const promise1 = queue.sendCommand(400, params, sendFn, 1, 1, 255, 190);
    const promise2 = queue.sendCommand(400, params, sendFn, 1, 1, 255, 190);
    const result1 = await promise1;
    expect(result1.success).toBe(false);
    expect(result1.message).toContain('Superseded');
    queue.handleAck(400, MAV_RESULT.ACCEPTED);
    const result2 = await promise2;
    expect(result2.success).toBe(true);
  });

  // ── TEMPORARILY_REJECTED auto-retry ──

  it('TEMPORARILY_REJECTED retries with 1s delay', async () => {
    const promise = queue.sendCommand(400, params, sendFn, 1, 1, 255, 190);
    expect(sendFn).toHaveBeenCalledTimes(1);
    queue.handleAck(400, MAV_RESULT.TEMPORARILY_REJECTED);
    vi.advanceTimersByTime(1000);
    expect(sendFn).toHaveBeenCalledTimes(2);
    queue.handleAck(400, MAV_RESULT.ACCEPTED);
    const result = await promise;
    expect(result.success).toBe(true);
  });

  it('TEMPORARILY_REJECTED retries up to 3 times', async () => {
    const promise = queue.sendCommand(400, params, sendFn, 1, 1, 255, 190);
    // Retry 1
    queue.handleAck(400, MAV_RESULT.TEMPORARILY_REJECTED);
    vi.advanceTimersByTime(1000);
    // Retry 2
    queue.handleAck(400, MAV_RESULT.TEMPORARILY_REJECTED);
    vi.advanceTimersByTime(1000);
    // Retry 3
    queue.handleAck(400, MAV_RESULT.TEMPORARILY_REJECTED);
    vi.advanceTimersByTime(1000);
    // 4th rejection should resolve as failure (retryCount is already 3)
    queue.handleAck(400, MAV_RESULT.TEMPORARILY_REJECTED);
    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.resultCode).toBe(MAV_RESULT.TEMPORARILY_REJECTED);
    expect(result.message).toContain('temporarily rejected');
  });

  it('retry exhaustion: resolves failure after 3 retries', async () => {
    const promise = queue.sendCommand(400, params, sendFn, 1, 1, 255, 190);
    for (let i = 0; i < 3; i++) {
      queue.handleAck(400, MAV_RESULT.TEMPORARILY_REJECTED);
      vi.advanceTimersByTime(1000);
    }
    // 4th rejection is the terminal one
    queue.handleAck(400, MAV_RESULT.TEMPORARILY_REJECTED);
    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.message).toContain('3 retries');
  });

  // ── clear() ──

  it('clear() resolves all pending with "Connection closed"', async () => {
    const promise1 = queue.sendCommand(400, params, sendFn, 1, 1, 255, 190);
    const promise2 = queue.sendCommand(401, params, sendFn, 1, 1, 255, 190);
    queue.clear();
    const [r1, r2] = await Promise.all([promise1, promise2]);
    expect(r1.success).toBe(false);
    expect(r1.message).toBe('Connection closed');
    expect(r2.success).toBe(false);
    expect(r2.message).toBe('Connection closed');
    expect(queue.pendingCount).toBe(0);
  });

  // ── Multiple concurrent commands ──

  it('tracks multiple concurrent commands with different IDs independently', async () => {
    const p1 = queue.sendCommand(400, params, sendFn, 1, 1, 255, 190);
    const p2 = queue.sendCommand(401, params, sendFn, 1, 1, 255, 190);
    const p3 = queue.sendCommand(402, params, sendFn, 1, 1, 255, 190);
    expect(queue.pendingCount).toBe(3);

    queue.handleAck(401, MAV_RESULT.ACCEPTED);
    const r2 = await p2;
    expect(r2.success).toBe(true);
    expect(queue.pendingCount).toBe(2);

    queue.handleAck(400, MAV_RESULT.DENIED);
    const r1 = await p1;
    expect(r1.success).toBe(false);

    queue.handleAck(402, MAV_RESULT.ACCEPTED);
    const r3 = await p3;
    expect(r3.success).toBe(true);
    expect(queue.pendingCount).toBe(0);
  });

  // ── Unknown ACK ──

  it('ACK for unknown command is silently ignored', () => {
    queue.handleAck(999, MAV_RESULT.ACCEPTED);
    expect(queue.pendingCount).toBe(0);
  });

  // ── sendCommandNoAck ──

  it('sendCommandNoAck fires and forgets', () => {
    queue.sendCommandNoAck(246, params, sendFn, 1, 1, 255, 190);
    expect(sendFn).toHaveBeenCalledOnce();
    expect(queue.pendingCount).toBe(0);
  });

  // ── pendingCount ──

  it('pendingCount reflects current state', async () => {
    expect(queue.pendingCount).toBe(0);
    const p1 = queue.sendCommand(400, params, sendFn, 1, 1, 255, 190);
    expect(queue.pendingCount).toBe(1);
    const p2 = queue.sendCommand(401, params, sendFn, 1, 1, 255, 190);
    expect(queue.pendingCount).toBe(2);
    queue.handleAck(400, MAV_RESULT.ACCEPTED);
    await p1;
    expect(queue.pendingCount).toBe(1);
    queue.handleAck(401, MAV_RESULT.ACCEPTED);
    await p2;
    expect(queue.pendingCount).toBe(0);
  });

  // ── getSnapshot ──

  it('getSnapshot returns pending command info', () => {
    queue.sendCommand(400, params, sendFn, 1, 1, 255, 190);
    queue.sendCommand(401, params, sendFn, 1, 1, 255, 190);
    const snapshot = queue.getSnapshot();
    expect(snapshot).toHaveLength(2);
    expect(snapshot[0].command).toBe(400);
    expect(snapshot[0].retryCount).toBe(0);
    expect(snapshot[0].timestamp).toBeGreaterThan(0);
    expect(snapshot[1].command).toBe(401);
  });

  it('getSnapshot returns empty array when no pending commands', () => {
    expect(queue.getSnapshot()).toEqual([]);
  });

  // ── Constructor default timeout ──

  it('uses default timeout of 3000ms', async () => {
    const defaultQueue = new CommandQueue();
    const promise = defaultQueue.sendCommand(400, params, sendFn, 1, 1, 255, 190);
    vi.advanceTimersByTime(3000);
    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.message).toContain('3000');
  });

  // ── Unknown result code message ──

  it('handles unknown result code with descriptive message', async () => {
    const promise = queue.sendCommand(400, params, sendFn, 1, 1, 255, 190);
    queue.handleAck(400, 99);
    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.resultCode).toBe(99);
    expect(result.message).toContain('Unknown result code: 99');
  });

  // ── Retry cleared during delay ──

  it('TEMPORARILY_REJECTED retry skips resend if cleared during delay', async () => {
    const promise = queue.sendCommand(400, params, sendFn, 1, 1, 255, 190);
    queue.handleAck(400, MAV_RESULT.TEMPORARILY_REJECTED);
    // Clear before the 1s retry delay fires
    queue.clear();
    const result = await promise;
    expect(result.message).toBe('Connection closed');
    // Advance past the retry delay
    vi.advanceTimersByTime(1000);
    // sendFn should only have been called once (initial send)
    expect(sendFn).toHaveBeenCalledTimes(1);
  });
});
