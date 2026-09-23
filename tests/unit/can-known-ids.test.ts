/**
 * CAN monitor labels follow the DroneCAN DSDL data type IDs and decode the
 * frame kind first: a service frame's type ID sits in bits 16..23, and an
 * anonymous message cannot be labelled.
 *
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";
import { getCanIdHint } from "@/lib/can/known-ids";

const PRIORITY = 16;
/** 29-bit message frame id: priority, 16-bit type id, message bit 0, source node. */
const messageId = (typeId: number, src: number) =>
  ((PRIORITY << 24) | (typeId << 8) | src) >>> 0;
/** 29-bit service frame id: priority, 8-bit type id, request bit, destination, service bit 1, source node. */
const serviceId = (typeId: number, dst: number, src: number) =>
  ((PRIORITY << 24) | (typeId << 16) | (1 << 15) | (dst << 8) | (1 << 7) | src) >>> 0;

describe("getCanIdHint", () => {
  it("labels the esc, gnss and power message types by their DSDL ids", () => {
    expect(getCanIdHint(messageId(1030, 1))?.label).toBe("ESC RawCommand");
    expect(getCanIdHint(messageId(1034, 10))?.label).toBe("ESC Status");
    expect(getCanIdHint(messageId(1061, 20))?.label).toBe("GNSS Auxiliary");
    expect(getCanIdHint(messageId(1062, 1))?.label).toBe("GNSS RTCMStream");
    expect(getCanIdHint(messageId(1063, 20))?.label).toBe("GNSS Fix2");
    expect(getCanIdHint(messageId(1011, 30))?.label).toBe("Actuator Status");
    expect(getCanIdHint(messageId(1090, 40))?.label).toBe("Primary Power Supply");
    expect(getCanIdHint(messageId(1093, 40))).toBeNull();
  });

  it("decodes service frames from bits 16..23", () => {
    const hint = getCanIdHint(serviceId(1, 10, 127));
    expect(hint?.label).toBe("GetNodeInfo");
    expect(hint?.kind).toBe("service");
    // A message with type id 1 is not GetNodeInfo.
    expect(getCanIdHint(messageId(1, 10))).toBeNull();
  });

  it("does not label anonymous messages", () => {
    expect(getCanIdHint(messageId(1034, 0))).toBeNull();
  });
});
