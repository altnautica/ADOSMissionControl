/**
 * @license GPL-3.0-only
 *
 * Golden msgpack frames captured from the Drone Agent's own producer
 * (`ados_protocol::atlas`, `rmp_serde::to_vec_named`) rather than re-encoded
 * here. That is the point of them: a fixture built by a local encoder only
 * proves the decoder agrees with itself, while these prove it agrees with the
 * process that actually publishes.
 *
 * They pinned two shapes that would otherwise have been guessed wrong:
 *  - struct fields cross as `snake_case` string keys, and an `Option::None`
 *    without `skip_serializing_if` is the key PRESENT carrying nil;
 *  - `AtlasEvent::payload` (`Vec<u8>`) crosses as a msgpack ARRAY of integers,
 *    not as a `bin` payload — a decoder written for `bin` reads every real
 *    envelope as malformed.
 *
 * Source values, for reference when reading an assertion:
 *   session "atlas-drone-1-1000", generation 7
 *   splat      gaussian_count 1_250_000, step 30_000, lod_levels 4, handle None
 *   cloud      point_count 480_000, bounds [-12.5,-8,0, 31.25,19.5,42.75]
 *   mesh       vertex_count 90_000, face_count 178_000, handle None
 *   occupancy  origin [-16.5,-12,-4], resolution 0.20, dims [240,180,60],
 *              field Esdf, truncation 4.0
 *   event      topic plugin.atlas.splat, device_id "drone-1", payload = splat
 */

/** Hex → bytes, so the fixtures read as the producer printed them. */
export function hexBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export const GOLDEN_SPLAT_HEX =
  "88aa73657373696f6e5f6964b261746c61732d64726f6e652d312d31303030aa67656e65726174696f6e07ae676175737369616e5f636f756e74ce001312d0a473746570cd7530a375726cd932687474703a2f2f3139322e3136382e312e35303a383039322f6172746966616374732f6a6f622d312f73706c61742e706c79a668616e646c65c0ac6d616e69666573745f75726cd936687474703a2f2f3139322e3136382e312e35303a383039322f6172746966616374732f6a6f622d312f6d616e69666573742e6a736f6eaa6c6f645f6c6576656c7304";

export const GOLDEN_CLOUD_HEX =
  "88aa73657373696f6e5f6964b261746c61732d64726f6e652d312d31303030aa67656e65726174696f6e07ab706f696e745f636f756e74ce00075300a6626f756e647396cbc029000000000000cbc020000000000000cb0000000000000000cb403f400000000000cb4033800000000000cb4045600000000000a873686d5f6e616d65c0a4736c6f74c0a3736571c0a375726cd932687474703a2f2f3139322e3136382e312e35303a383039322f6172746966616374732f6a6f622d312f636c6f75642e706c79";

export const GOLDEN_MESH_HEX =
  "86aa73657373696f6e5f6964b261746c61732d64726f6e652d312d31303030aa67656e65726174696f6e07ac7665727465785f636f756e74ce00015f90aa666163655f636f756e74ce0002b750a375726cd931687474703a2f2f3139322e3136382e312e35303a383039322f6172746966616374732f6a6f622d312f6d6573682e676c62a668616e646c65c0";

export const GOLDEN_OCCUPANCY_ESDF_HEX =
  "8baa73657373696f6e5f6964b261746c61732d64726f6e652d312d31303030aa67656e65726174696f6e07a66f726967696e93cbc030800000000000cbc028000000000000cbc010000000000000ac7265736f6c7574696f6e5f6dca3e4ccccda464696d7393ccf0ccb43ca56669656c64a465736466ac7472756e636174696f6e5f6dca40800000a873686d5f6e616d65c0a4736c6f74c0a3736571c0a375726cd934687474703a2f2f3139322e3136382e312e35303a383039322f6172746966616374732f6a6f622d312f657364662d67372e663332";

/** The same grid published as a plain occupancy-probability buffer: `field` is
 * "occupancy", `truncation_m` is the meaningless zero, and `url` is nil. */
export const GOLDEN_OCCUPANCY_PLAIN_HEX =
  "8baa73657373696f6e5f6964b261746c61732d64726f6e652d312d31303030aa67656e65726174696f6e07a66f726967696e93cbc030800000000000cbc028000000000000cbc010000000000000ac7265736f6c7574696f6e5f6dca3e4ccccda464696d7393ccf0ccb43ca56669656c64a96f63637570616e6379ac7472756e636174696f6e5f6dca00000000a873686d5f6e616d65c0a4736c6f74c0a3736571c0a375726cc0";

/** A framed envelope: version 1, splat topic, device "drone-1", the splat
 * descriptor as its payload. */
export const GOLDEN_EVENT_HEX =
  "84a17601a5746f706963b2706c7567696e2e61746c61732e73706c6174a96465766963655f6964a764726f6e652d31a77061796c6f6164dc00d8cc88ccaa73657373696f6e5f6964ccb261746c61732d64726f6e652d312d31303030ccaa67656e65726174696f6e07ccae676175737369616e5f636f756e74ccce001312ccd0cca473746570cccd7530cca375726cccd932687474703a2f2f3139322e3136382e312e35303a383039322f6172746966616374732f6a6f622d312f73706c61742e706c79cca668616e646c65ccc0ccac6d616e69666573745f75726cccd936687474703a2f2f3139322e3136382e312e35303a383039322f6172746966616374732f6a6f622d312f6d616e69666573742e6a736f6eccaa6c6f645f6c6576656c7304";

/** A local-bus envelope: `device_id` is skipped entirely (the only atlas field
 * carrying `skip_serializing_if`), so a decoder must read its absence as null
 * rather than failing the frame. */
export const GOLDEN_EVENT_NO_DEVICE_HEX =
  "83a17601a5746f706963b1706c7567696e2e61746c61732e6d657368a77061796c6f616491ccc0";

/** A capture-status descriptor carrying the honesty fields (`capped`,
 * `anchored`, `pose_tier`, `dropped_keyframes`). */
export const GOLDEN_CAPTURE_STATUS_HEX =
  "8aaa73657373696f6e5f6964b261746c61732d64726f6e652d312d31303030a57374617465a9636170747572696e67a96b65796672616d6573cc92aa76696f5f6865616c7468a86465677261646564ac63616d6572615f636f756e7403ae696e676573745f726174655f687aca411c0000a6636170706564c3a8616e63686f726564c3a9706f73655f74696572ae6f66666c6f616465645f736c616db164726f707065645f6b65796672616d657304";

// --- Test-only encoder ----------------------------------------------------
//
// For the cases no producer emits today: a descriptor missing a required field
// (an older or buggy publisher), a stated zero, and a degenerate bounds box.
// Deliberately test-only — production decodes and never publishes on an atlas
// topic, so a shipped encoder would be a writer with no reader.

type Encodable =
  | null
  | boolean
  | number
  | string
  | Encodable[]
  | { [key: string]: Encodable };

function encodeValue(value: Encodable, out: number[]): void {
  if (value === null) {
    out.push(0xc0);
    return;
  }
  if (typeof value === "boolean") {
    out.push(value ? 0xc3 : 0xc2);
    return;
  }
  if (typeof value === "number") {
    if (Number.isInteger(value) && value >= 0 && value <= 0x7f) {
      out.push(value);
      return;
    }
    if (Number.isInteger(value) && value >= 0 && value <= 0xffffffff) {
      out.push(0xce, (value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
      return;
    }
    const buf = new Uint8Array(8);
    new DataView(buf.buffer).setFloat64(0, value);
    out.push(0xcb, ...buf);
    return;
  }
  if (typeof value === "string") {
    const bytes = new TextEncoder().encode(value);
    if (bytes.length > 31) throw new Error("test encoder: str too long");
    out.push(0xa0 | bytes.length, ...bytes);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 15) throw new Error("test encoder: array too long");
    out.push(0x90 | value.length);
    for (const v of value) encodeValue(v, out);
    return;
  }
  const keys = Object.keys(value);
  if (keys.length > 15) throw new Error("test encoder: map too long");
  out.push(0x80 | keys.length);
  for (const k of keys) {
    encodeValue(k, out);
    encodeValue(value[k], out);
  }
}

/** Encode a small msgpack map for a case the real producer does not emit. */
export function encodeTestMap(map: { [key: string]: Encodable }): Uint8Array {
  const out: number[] = [];
  encodeValue(map, out);
  return new Uint8Array(out);
}

/** Frame a payload as an `AtlasEvent` the way the producer does: named map,
 * version under `v`, and the payload as an ARRAY of byte integers. */
export function encodeTestEvent(
  topic: string,
  deviceId: string | null,
  payload: Uint8Array,
  version = 1,
): Uint8Array {
  const out: number[] = [];
  const entries: [string, Encodable][] = [
    ["v", version],
    ["topic", topic],
  ];
  if (deviceId !== null) entries.push(["device_id", deviceId]);
  out.push(0x80 | (entries.length + 1));
  for (const [k, v] of entries) {
    encodeValue(k, out);
    encodeValue(v, out);
  }
  encodeValue("payload", out);
  // array32 keeps the length field a fixed width regardless of payload size.
  out.push(
    0xdd,
    (payload.length >>> 24) & 0xff,
    (payload.length >>> 16) & 0xff,
    (payload.length >>> 8) & 0xff,
    payload.length & 0xff,
  );
  for (const b of payload) encodeValue(b, out);
  return new Uint8Array(out);
}
