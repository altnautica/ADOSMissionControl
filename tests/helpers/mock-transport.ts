/**
 * Reusable mock Transport for protocol testing.
 * Provides send() as vi.fn(), isConnected, on/off event handling,
 * and triggerReceive() to simulate incoming data.
 */

import { vi } from 'vitest';

type Listener = (data: Uint8Array) => void;

export interface MockTransport {
  send: ReturnType<typeof vi.fn>;
  isConnected: boolean;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  triggerReceive: (data: Uint8Array) => void;
  listeners: Map<string, Set<Listener>>;
}

export function createMockTransport(connected = true): MockTransport {
  const listeners = new Map<string, Set<Listener>>();

  const transport: MockTransport = {
    send: vi.fn(),
    isConnected: connected,
    on: vi.fn((event: string, handler: Listener) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    }),
    off: vi.fn((event: string, handler: Listener) => {
      listeners.get(event)?.delete(handler);
    }),
    close: vi.fn(() => {
      transport.isConnected = false;
    }),
    triggerReceive: (data: Uint8Array) => {
      const cbs = listeners.get('data');
      if (cbs) for (const cb of cbs) cb(data);
    },
    listeners,
  };

  return transport;
}
