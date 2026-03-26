"use client";

import { useTelemetryStore } from "@/stores/telemetry-store";
import type { RingBuffer } from "@/lib/ring-buffer";

/**
 * Extract only the RingBuffer<T> fields from the telemetry store,
 * excluding actions (_version, push*, clear, etc.).
 */
type TelemetryBuffers = {
  [K in keyof ReturnType<typeof useTelemetryStore.getState>]: ReturnType<
    typeof useTelemetryStore.getState
  >[K] extends RingBuffer<infer _T>
    ? K
    : never;
}[keyof ReturnType<typeof useTelemetryStore.getState>];

/**
 * Infer the element type T from a RingBuffer<T> field.
 */
type BufferElement<K extends TelemetryBuffers> = ReturnType<
  typeof useTelemetryStore.getState
>[K] extends RingBuffer<infer T>
  ? T
  : never;

/**
 * Returns the latest value from a telemetry ring buffer channel.
 *
 * Equivalent to `useTelemetryStore((s) => s.position.latest())` but shorter.
 * The selector calls `.latest()` inside Zustand's subscription so re-renders
 * are triggered correctly by the store's `_version` counter.
 *
 * @example
 *   const position = useTelemetryLatest("position");
 *   // position: PositionData | undefined
 */
export function useTelemetryLatest<K extends TelemetryBuffers>(
  field: K,
): BufferElement<K> | undefined {
  return useTelemetryStore(
    (s) => (s[field] as RingBuffer<BufferElement<K>>).latest(),
  );
}
