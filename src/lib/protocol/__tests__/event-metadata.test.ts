/**
 * @module protocol/event-metadata.test
 * @description Unit tests for the PX4 events component-metadata (type 2):
 * flattening components × event_groups × events into `fullId -> EventMeta`
 * (fullId = (componentId << 24) | subId), and rendering a message template by
 * substituting arguments decoded from the EVENT frame's packed byte array.
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  parseEventsMetadata,
  renderEventMessage,
  type EventArgMeta,
  type EventEnumMeta,
} from "../param-metadata/px4-event-metadata";
import { usePx4EventsStore } from "@/stores/px4-events-store";

/** Encode a float into a 40-byte argument array (little-endian at offset 0). */
function floatArgs(value: number): Uint8Array {
  const buf = new Uint8Array(40);
  new DataView(buf.buffer).setFloat32(0, value, true);
  return buf;
}

describe("parseEventsMetadata", () => {
  it("flattens components + event groups into (comp<<24)|subId ids", () => {
    const map = parseEventsMetadata({
      version: 1,
      components: {
        "1": {
          namespace: "px4",
          event_groups: {
            default: {
              events: {
                "100": { name: "battery_low", message: "Battery low: {1:.1V}", arguments: [{ type: "float" }] },
              },
            },
            health: {
              events: { "5": { name: "gps_lost", message: "GPS lost" } },
            },
          },
        },
      },
    });
    const batteryId = ((1 << 24) | 100) >>> 0;
    const gpsId = ((1 << 24) | 5) >>> 0;
    expect(map.get(batteryId)?.name).toBe("battery_low");
    expect(map.get(batteryId)?.args).toEqual<EventArgMeta[]>([{ type: "float", name: undefined }]);
    expect(map.get(gpsId)?.message).toBe("GPS lost");
    expect(map.size).toBe(2);
  });

  it("skips malformed entries and falls back message→name", () => {
    const map = parseEventsMetadata({
      components: {
        "0": {
          event_groups: {
            default: {
              events: {
                "1": { name: "no_message" }, // no message → falls back to name
                "2": { message: "orphan with no name" }, // no name → skipped
              },
            },
          },
        },
      },
    });
    expect(map.get(1)?.message).toBe("no_message");
    expect(map.size).toBe(1); // the nameless entry is dropped
  });
});

describe("renderEventMessage", () => {
  it("returns the template unchanged when there are no arguments", () => {
    expect(renderEventMessage("Takeoff detected", new Uint8Array(40), [])).toBe("Takeoff detected");
  });

  it("substitutes a float with decimal places + unit", () => {
    const out = renderEventMessage("Battery low: {1:.1V}", floatArgs(3.7), [{ type: "float" }]);
    expect(out).toBe("Battery low: 3.7V");
  });

  it("substitutes integer arguments read at running offsets", () => {
    const args = new Uint8Array(40);
    const dv = new DataView(args.buffer);
    dv.setUint8(0, 4); // arg 1 (uint8)
    dv.setUint16(1, 1200, true); // arg 2 (uint16)
    const out = renderEventMessage("mode {1} at {2}us", args, [{ type: "uint8_t" }, { type: "uint16_t" }]);
    expect(out).toBe("mode 4 at 1200us");
  });

  it("resolves an enum argument to its entry name", () => {
    const enums: Record<string, EventEnumMeta> = {
      mode_t: { type: "uint8_t", entries: { "4": { name: "HOLD" } } },
    };
    const args = new Uint8Array(40);
    args[0] = 4;
    const out = renderEventMessage("Mode: {1}", args, [{ type: "mode_t" }], enums);
    expect(out).toBe("Mode: HOLD");
  });

  it("leaves a placeholder as-is when its argument is absent", () => {
    expect(renderEventMessage("value {3}", new Uint8Array(40), [{ type: "uint8_t" }])).toBe("value {3}");
  });
});

describe("px4-events-store", () => {
  beforeEach(() => usePx4EventsStore.getState().clear());

  it("decodes a raw event against the metadata and appends it", () => {
    const id = ((1 << 24) | 100) >>> 0;
    usePx4EventsStore.getState().setMetadata(
      new Map([[id, { name: "battery_low", message: "Battery low: {1:.1V}", args: [{ type: "float" }] }]]),
    );
    usePx4EventsStore.getState().pushRaw({
      id,
      logLevels: 0x24, // external nibble = 4 (warning)
      arguments: floatArgs(3.7),
      eventTimeBootMs: 1000,
    });
    const events = usePx4EventsStore.getState().events;
    expect(events).toHaveLength(1);
    expect(events[0].text).toBe("Battery low: 3.7V");
    expect(events[0].name).toBe("battery_low");
    expect(events[0].severity).toBe(4);
  });

  it("falls back honestly for an unknown event id (no fabricated text)", () => {
    usePx4EventsStore.getState().pushRaw({
      id: 999999,
      logLevels: 0x03,
      arguments: new Uint8Array(40),
      eventTimeBootMs: 0,
    });
    const events = usePx4EventsStore.getState().events;
    expect(events[0].text).toBe("Unknown event 999999");
    expect(events[0].severity).toBe(3);
  });
});
