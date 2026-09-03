/**
 * @module video/fmp4-codec
 * @description Reads the codec string out of an fMP4 initialisation segment.
 *
 * The MSE player used to hand `addSourceBuffer` a hardcoded
 * `video/mp4; codecs="avc1.640029"` — H.264 High profile, level 4.1. Its
 * failure mode when the publisher encodes anything else is a **silent,
 * permanent black screen**: the source buffer is created against a codec the
 * bytes are not, every append is refused, no error surfaces, and the operator
 * sees a black pane with a connected badge. It fires today on any CSI drone,
 * because the agent's rpicam path publishes Constrained Baseline.
 *
 * The init segment already says what the stream is. `avcC` (H.264) and `hvcC`
 * (H.265) carry the profile, the profile-compatibility flags, and the level,
 * which is exactly the `avc1.PPCCLL` / `hvc1.…` suffix the MSE codec string
 * wants. Reading it is a box walk over a few hundred structured bytes, once
 * per session.
 *
 * A real walk, not a fourcc search: the same four bytes appear in media data
 * often enough that a scan would occasionally match sample bytes and produce
 * a plausible, wrong codec string — which lands back at a black screen with
 * one more layer of indirection in the way.
 *
 * @license GPL-3.0-only
 */

/** Boxes whose payload is a list of child boxes, walked recursively. */
const CONTAINER_BOXES: Record<string, true> = {
  moov: true,
  trak: true,
  mdia: true,
  minf: true,
  stbl: true,
};

/**
 * Sample-entry boxes that hold a codec-configuration child.
 *
 * `avc1`/`avc3` and `hvc1`/`hev1` differ only in whether parameter sets are
 * in-band; both carry the same configuration box, and both are legal MSE
 * codec prefixes.
 */
const SAMPLE_ENTRY_BOXES: Record<string, true> = {
  avc1: true,
  avc3: true,
  hvc1: true,
  hev1: true,
};

/**
 * A `VisualSampleEntry` starts with 78 bytes of fixed fields (the 8-byte
 * `SampleEntry` header plus the visual fields through `depth` and
 * `pre_defined`) before its first child box.
 */
const VISUAL_SAMPLE_ENTRY_HEADER = 78;

/** `stsd` is a `FullBox` with a 4-byte entry count before its entries. */
const STSD_HEADER = 8;

function fourcc(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

function hex2(value: number): string {
  return value.toString(16).padStart(2, "0");
}

/**
 * Walk the boxes in `[start, end)` and return the codec string from the first
 * configuration box found, or `null`.
 *
 * Depth-bounded because the input is untrusted bytes off a WebSocket: a
 * crafted or corrupt segment can otherwise describe a box that contains
 * itself.
 */
function walk(
  view: DataView,
  start: number,
  end: number,
  depth: number,
): string | null {
  if (depth > 8) return null;
  let offset = start;
  while (offset + 8 <= end) {
    let size = view.getUint32(offset);
    const type = fourcc(view, offset + 4);
    let headerSize = 8;
    if (size === 1) {
      // 64-bit `largesize`. Only the low half is usable here; a box larger
      // than 4 GiB is not an init segment.
      if (offset + 16 > end) return null;
      const high = view.getUint32(offset + 8);
      if (high !== 0) return null;
      size = view.getUint32(offset + 12);
      headerSize = 16;
    } else if (size === 0) {
      // "Extends to end of file."
      size = end - offset;
    }
    if (size < headerSize || offset + size > end) return null;

    const bodyStart = offset + headerSize;
    const bodyEnd = offset + size;

    if (type === "avcC") {
      // configurationVersion, AVCProfileIndication, profile_compatibility,
      // AVCLevelIndication.
      if (bodyStart + 4 > bodyEnd) return null;
      const profile = view.getUint8(bodyStart + 1);
      const compat = view.getUint8(bodyStart + 2);
      const level = view.getUint8(bodyStart + 3);
      return `avc1.${hex2(profile)}${hex2(compat)}${hex2(level)}`;
    }

    if (type === "hvcC") {
      // The HEVC codec string is
      // `hvc1.<profile_space><profile_idc>.<compat flags>.<tier><level>`.
      // Enough of the box is fixed-layout to build it: byte 1 holds
      // profile_space (2 bits), tier_flag (1), profile_idc (5); bytes 2-5
      // are the compatibility flags; byte 12 is level_idc.
      if (bodyStart + 13 > bodyEnd) return null;
      const b1 = view.getUint8(bodyStart + 1);
      const profileSpace = (b1 & 0xc0) >> 6;
      const tierFlag = (b1 & 0x20) >> 5;
      const profileIdc = b1 & 0x1f;
      const compatFlags = view.getUint32(bodyStart + 2);
      const levelIdc = view.getUint8(bodyStart + 12);
      const space = ["", "A", "B", "C"][profileSpace];
      const tier = tierFlag === 0 ? "L" : "H";
      return `hvc1.${space}${profileIdc}.${compatFlags.toString(16).toUpperCase()}.${tier}${levelIdc}`;
    }

    if (CONTAINER_BOXES[type]) {
      const found = walk(view, bodyStart, bodyEnd, depth + 1);
      if (found) return found;
    } else if (type === "stsd") {
      if (bodyStart + STSD_HEADER <= bodyEnd) {
        const found = walk(view, bodyStart + STSD_HEADER, bodyEnd, depth + 1);
        if (found) return found;
      }
    } else if (SAMPLE_ENTRY_BOXES[type]) {
      const childStart = offset + VISUAL_SAMPLE_ENTRY_HEADER;
      if (childStart < bodyEnd) {
        const found = walk(view, childStart, bodyEnd, depth + 1);
        if (found) return found;
      }
    }

    offset = bodyEnd;
  }
  return null;
}

/**
 * The MSE codec string for the track in `segment`, or `null` when the bytes
 * carry no configuration box this understands.
 *
 * `null` is a real answer and must not be papered over with the old
 * hardcoded string: it means "this is not an fMP4 init segment, or it is one
 * whose codec we cannot name", and both call for a named failure rather than
 * a guess that silently produces a black screen.
 */
export function codecStringFromInitSegment(
  segment: ArrayBuffer,
): string | null {
  if (segment.byteLength < 16) return null;
  const view = new DataView(segment);
  try {
    return walk(view, 0, segment.byteLength, 0);
  } catch {
    // A truncated or malformed segment. Same answer as an unrecognised one.
    return null;
  }
}

/** The full MSE type string for a codec suffix. */
export function mseTypeFor(codec: string): string {
  return `video/mp4; codecs="${codec}"`;
}
