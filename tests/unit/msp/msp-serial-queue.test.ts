import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ParsedMspFrame } from '@/lib/protocol/msp/msp-parser';

// Mock the MSP codec
vi.mock('@/lib/protocol/msp/msp-codec', () => ({
  encodeMsp: vi.fn((cmd: number, _payload?: Uint8Array) => new Uint8Array([cmd])),
}));

// Import after mock
import { MspSerialQueue } from '@/lib/protocol/msp/msp-serial-queue';

function createMockParser() {
  let frameHandler: ((frame: ParsedMspFrame) => void) | null = null;
  return {
    parser: {
      onFrame: (cb: (frame: ParsedMspFrame) => void) => {
        frameHandler = cb;
        return () => {
          frameHandler = null;
        };
      },
    },
    triggerFrame: (frame: ParsedMspFrame) => frameHandler?.(frame),
  };
}

function makeFrame(command: number): ParsedMspFrame {
  return {
    version: 1,
    command,
    payload: new Uint8Array(0),
    direction: 'response',
  };
}

describe('MspSerialQueue', () => {
  let sendFn: ReturnType<typeof vi.fn<(data: Uint8Array) => void>>;
  let mock: ReturnType<typeof createMockParser>;
  let queue: MspSerialQueue;

  beforeEach(() => {
    vi.useFakeTimers();
    sendFn = vi.fn<(data: Uint8Array) => void>();
    mock = createMockParser();
    // Use 100ms timeout, 2 max retries for tests
    queue = new MspSerialQueue(sendFn, mock.parser as any, 100, 2);
  });

  it('single send + matching response resolves', async () => {
    const promise = queue.send(1);
    // Should have sent immediately
    expect(sendFn).toHaveBeenCalledTimes(1);

    // Trigger matching response
    mock.triggerFrame(makeFrame(1));

    const result = await promise;
    expect(result.command).toBe(1);
  });

  it('sequential sends: second waits for first to complete', async () => {
    const p1 = queue.send(1);
    const p2 = queue.send(2);

    // Only first should be sent
    expect(sendFn).toHaveBeenCalledTimes(1);

    // Complete first request
    mock.triggerFrame(makeFrame(1));
    await p1;

    // Now second should be sent
    expect(sendFn).toHaveBeenCalledTimes(2);

    mock.triggerFrame(makeFrame(2));
    const r2 = await p2;
    expect(r2.command).toBe(2);
  });

  it('timeout: rejects after timeout ms', async () => {
    const promise = queue.send(1);

    // Advance past all retries: initial + 2 retries = 3 timeouts
    vi.advanceTimersByTime(100); // retry 1
    vi.advanceTimersByTime(100); // retry 2
    vi.advanceTimersByTime(100); // final timeout

    await expect(promise).rejects.toThrow('MSP timeout');
  });

  it('retry on timeout: retries up to maxRetries', async () => {
    const promise = queue.send(1);
    expect(sendFn).toHaveBeenCalledTimes(1);

    // First timeout -> retry 1
    vi.advanceTimersByTime(100);
    expect(sendFn).toHaveBeenCalledTimes(2);

    // Second timeout -> retry 2
    vi.advanceTimersByTime(100);
    expect(sendFn).toHaveBeenCalledTimes(3);

    // Now respond
    mock.triggerFrame(makeFrame(1));
    const result = await promise;
    expect(result.command).toBe(1);
  });

  it('retry exhaustion: rejects after maxRetries+1 attempts', async () => {
    const promise = queue.send(1);

    // 3 timeouts: initial send + 2 retries
    vi.advanceTimersByTime(100);
    vi.advanceTimersByTime(100);
    vi.advanceTimersByTime(100);

    await expect(promise).rejects.toThrow('MSP timeout: command 1 after 3 attempts');
  });

  it('flush: rejects all pending with "Disconnected"', async () => {
    // Attach .catch() immediately to avoid unhandled rejection
    const p1 = queue.send(1).catch((e: Error) => e);
    const p2 = queue.send(2).catch((e: Error) => e);
    const p3 = queue.send(3).catch((e: Error) => e);

    queue.flush();

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect((r1 as Error).message).toBe('Disconnected');
    expect((r2 as Error).message).toBe('Disconnected');
    expect((r3 as Error).message).toBe('Disconnected');
  });

  it('destroy: flushes and unsubscribes', async () => {
    const p1 = queue.send(1).catch((e: Error) => e);

    queue.destroy();

    const r1 = await p1;
    expect((r1 as Error).message).toBe('Disconnected');

    // After destroy, triggering a frame should not cause errors
    // (handler was unsubscribed)
    mock.triggerFrame(makeFrame(1));
  });

  it('non-matching command frame ignored', async () => {
    const promise = queue.send(1);

    // Send a frame with wrong command
    mock.triggerFrame(makeFrame(99));

    // Promise should still be pending, so advance timer to cause timeout
    vi.advanceTimersByTime(100);
    vi.advanceTimersByTime(100);
    vi.advanceTimersByTime(100);

    await expect(promise).rejects.toThrow('MSP timeout');
  });

  it('sendNoReply: sends immediately, does not queue', () => {
    queue.sendNoReply(50, new Uint8Array([1, 2, 3]));
    expect(sendFn).toHaveBeenCalledTimes(1);
    expect(queue.pending).toBe(0);
  });

  it('pending count: 0 initially', () => {
    expect(queue.pending).toBe(0);
  });

  it('pending count: increments with queued requests', () => {
    queue.send(1).catch(() => {});
    expect(queue.pending).toBe(1);
    queue.send(2).catch(() => {});
    expect(queue.pending).toBe(2);
    queue.flush(); // cleanup
  });

  it('pending count: decrements on response', async () => {
    const p1 = queue.send(1);
    queue.send(2).catch(() => {});
    expect(queue.pending).toBe(2);

    mock.triggerFrame(makeFrame(1));
    await p1;
    expect(queue.pending).toBe(1);
    queue.flush(); // cleanup remaining
  });

  it('multiple queued requests process sequentially', async () => {
    const order: number[] = [];
    const p1 = queue.send(1).then((f) => {
      order.push(f.command);
      return f;
    });
    const p2 = queue.send(2).then((f) => {
      order.push(f.command);
      return f;
    });
    const p3 = queue.send(3).then((f) => {
      order.push(f.command);
      return f;
    });

    // Complete in order
    mock.triggerFrame(makeFrame(1));
    await p1;
    mock.triggerFrame(makeFrame(2));
    await p2;
    mock.triggerFrame(makeFrame(3));
    await p3;

    expect(order).toEqual([1, 2, 3]);
  });

  it('sendNoReply does not interfere with queued requests', async () => {
    const p1 = queue.send(1);

    // Fire-and-forget in between
    queue.sendNoReply(99);

    // The queued request should still work
    mock.triggerFrame(makeFrame(1));
    const result = await p1;
    expect(result.command).toBe(1);
  });

  it('handles frame arriving after no active request (no-op)', () => {
    // No sends queued. Triggering a frame should not throw
    mock.triggerFrame(makeFrame(42));
  });

  it('processes next request after timeout of current', async () => {
    const p1 = queue.send(1).catch((e: Error) => e);
    const p2 = queue.send(2);

    // Timeout all retries for request 1:
    // initial send (1), retry 1 (2), retry 2 (3), then exhaustion starts req2
    vi.advanceTimersByTime(100);
    vi.advanceTimersByTime(100);
    vi.advanceTimersByTime(100);

    const r1 = await p1;
    expect((r1 as Error).message).toContain('MSP timeout');

    // 3 sends for req1 + 1 for req2 = 4 total
    expect(sendFn).toHaveBeenCalledTimes(4);
    mock.triggerFrame(makeFrame(2));
    const r2 = await p2;
    expect(r2.command).toBe(2);
  });

  it('flush clears timeout', async () => {
    const p = queue.send(1).catch(() => {});
    queue.flush();
    await p;

    // Advancing time after flush should not cause issues
    vi.advanceTimersByTime(1000);
  });
});
