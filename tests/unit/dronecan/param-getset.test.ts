/**
 * @license GPL-3.0-only
 *
 * `uavcan.protocol.param.GetSet` is bit-packed: the request's uint13 index
 * shares two bytes with the 3-bit Value tag, the response pads each union tag
 * with void5/void6 so every tag sits in the low bits of its own byte, and a
 * string value carries a uint8 length prefix because Value is never the last
 * field. Expected bytes are reference DroneCAN encodings, checked in both
 * directions.
 */

import { describe, expect, it } from "vitest";

import {
  ValueTag,
  decodeParamGetSetRequest,
  decodeParamGetSetResponse,
  encodeParamGetSetRequest,
  encodeParamGetSetResponse,
  type ParamGetSetRequest,
  type ParamGetSetResponse,
} from "@/lib/dronecan/dsdl/param-getset";

const EMPTY = { tag: ValueTag.Empty } as const;

const REQUESTS: Array<{ name: string; req: ParamGetSetRequest; bytes: number[] }> = [
  {
    name: "a bare index walk",
    req: { index: 7, value: EMPTY, name: "" },
    bytes: [0x07, 0x00],
  },
  {
    name: "a uint13 index sharing byte 1 with the Real tag",
    req: { index: 0x1234, value: { tag: ValueTag.Real, value: 0 }, name: "" },
    bytes: [0x34, 0x92, 0x00, 0x00, 0x00, 0x00],
  },
  {
    name: "a named integer set",
    req: { index: 0, value: { tag: ValueTag.Integer, value: BigInt(-42) }, name: "UAVCAN_NODE_ID" },
    bytes: [
      0x00, 0x01, 0xd6, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
      0x55, 0x41, 0x56, 0x43, 0x41, 0x4e, 0x5f, 0x4e, 0x4f, 0x44, 0x45, 0x5f, 0x49, 0x44,
    ],
  },
  {
    name: "a named string set with its length prefix",
    req: { index: 0, value: { tag: ValueTag.String, value: "ab" }, name: "X" },
    bytes: [0x00, 0x04, 0x02, 0x61, 0x62, 0x58],
  },
];

const RESPONSES: Array<{ name: string; res: ParamGetSetResponse; bytes: number[] }> = [
  {
    name: "an integer parameter with limits",
    res: {
      value: { tag: ValueTag.Integer, value: BigInt(10) },
      default_value: { tag: ValueTag.Integer, value: BigInt(0) },
      max_value: { tag: ValueTag.Integer, value: BigInt(127) },
      min_value: { tag: ValueTag.Integer, value: BigInt(0) },
      name: "CAN_NODE",
    },
    bytes: [
      0x01, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x01, 0x7f, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x43, 0x41, 0x4e, 0x5f, 0x4e, 0x4f, 0x44, 0x45,
    ],
  },
  {
    name: "a real parameter with limits",
    res: {
      value: { tag: ValueTag.Real, value: 1.5 },
      default_value: { tag: ValueTag.Real, value: 0.25 },
      max_value: { tag: ValueTag.Real, value: 10 },
      min_value: { tag: ValueTag.Real, value: -10 },
      name: "MOT_PWM_MAX",
    },
    bytes: [
      0x02, 0x00, 0x00, 0xc0, 0x3f, 0x02, 0x00, 0x00, 0x80, 0x3e,
      0x02, 0x00, 0x00, 0x20, 0x41, 0x02, 0x00, 0x00, 0x20, 0xc1,
      0x4d, 0x4f, 0x54, 0x5f, 0x50, 0x57, 0x4d, 0x5f, 0x4d, 0x41, 0x58,
    ],
  },
  {
    name: "a string parameter followed by empty limits and the name",
    res: {
      value: { tag: ValueTag.String, value: "abc" },
      default_value: { tag: ValueTag.String, value: "x" },
      max_value: EMPTY,
      min_value: EMPTY,
      name: "NAME",
    },
    bytes: [0x04, 0x03, 0x61, 0x62, 0x63, 0x04, 0x01, 0x78, 0x00, 0x00, 0x4e, 0x41, 0x4d, 0x45],
  },
  {
    name: "a boolean parameter",
    res: {
      value: { tag: ValueTag.Boolean, value: true },
      default_value: EMPTY,
      max_value: EMPTY,
      min_value: EMPTY,
      name: "B",
    },
    bytes: [0x03, 0x01, 0x00, 0x00, 0x00, 0x42],
  },
  {
    name: "the end-of-list answer (all Empty, no name)",
    res: { value: EMPTY, default_value: EMPTY, max_value: EMPTY, min_value: EMPTY, name: "" },
    bytes: [0x00, 0x00, 0x00, 0x00],
  },
];

describe("param.GetSet request", () => {
  for (const v of REQUESTS) {
    it(`encodes ${v.name}`, () => {
      expect(Array.from(encodeParamGetSetRequest(v.req))).toEqual(v.bytes);
    });
    it(`decodes ${v.name}`, () => {
      expect(decodeParamGetSetRequest(new Uint8Array(v.bytes))).toEqual(v.req);
    });
  }

  it("rejects an index outside uint13 instead of silently truncating it", () => {
    expect(() =>
      encodeParamGetSetRequest({ index: 0x2000, value: EMPTY, name: "" }),
    ).toThrow(/uint13/);
  });
});

describe("param.GetSet response", () => {
  for (const v of RESPONSES) {
    it(`encodes ${v.name}`, () => {
      expect(Array.from(encodeParamGetSetResponse(v.res))).toEqual(v.bytes);
    });
    it(`decodes ${v.name}`, () => {
      expect(decodeParamGetSetResponse(new Uint8Array(v.bytes))).toEqual(v.res);
    });
  }

  it("refuses to encode a Boolean into a NumericValue slot", () => {
    expect(() =>
      encodeParamGetSetResponse({
        value: EMPTY,
        default_value: EMPTY,
        max_value: { tag: ValueTag.Boolean, value: true },
        min_value: EMPTY,
        name: "",
      }),
    ).toThrow(/NumericValue/);
  });

  it("rejects a response that ends inside the padded value fields", () => {
    expect(() => decodeParamGetSetResponse(new Uint8Array([0x00, 0x00]))).toThrow(/truncated/);
  });
});
