/**
 * Regression net for fMP4 codec negotiation.
 *
 * The bug: the MSE player passed `addSourceBuffer` a hardcoded
 * `video/mp4; codecs="avc1.640029"` — H.264 High 4.1. When the publisher
 * encodes anything else the source buffer is created against a codec the
 * bytes are not, every append is refused, nothing errors, and the operator
 * gets a black pane with a connected badge. It fires on any CSI drone,
 * because the agent's rpicam path publishes Constrained Baseline.
 *
 * The init segment says what the stream is. These tests pin the box walk that
 * reads it, including that it walks rather than scans — the four bytes `avcC`
 * appear in media data often enough that a scan eventually matches sample
 * bytes and produces a plausible, wrong codec string.
 */

import { describe, expect, it } from "vitest";

import {
  codecStringFromInitSegment,
  mseTypeFor,
} from "@/lib/video/fmp4-codec";

/** Build one MP4 box: size, fourcc, payload. */
function box(type: string, payload: number[]): number[] {
  const size = 8 + payload.length;
  return [
    (size >>> 24) & 0xff,
    (size >>> 16) & 0xff,
    (size >>> 8) & 0xff,
    size & 0xff,
    ...[...type].map((c) => c.charCodeAt(0)),
    ...payload,
  ];
}

/**
 * A minimal but structurally real init segment:
 * ftyp + moov > trak > mdia > minf > stbl > stsd > avc1 > avcC.
 */
function initSegment(
  config: number[],
  sampleEntry = "avc1",
  configType = "avcC",
): ArrayBuffer {
  const avcC = box(configType, config);
  // VisualSampleEntry: 78 bytes of fixed fields before the first child box.
  const entryFixed = new Array(78 - 8).fill(0);
  const entry = box(sampleEntry, [...entryFixed, ...avcC]);
  // stsd is a FullBox: version+flags, then entry_count.
  const stsd = box("stsd", [0, 0, 0, 0, 0, 0, 0, 1, ...entry]);
  const stbl = box("stbl", stsd);
  const minf = box("minf", stbl);
  const mdia = box("mdia", minf);
  const trak = box("trak", mdia);
  const moov = box("moov", trak);
  const ftyp = box("ftyp", [...[..."isom"].map((c) => c.charCodeAt(0))]);
  return new Uint8Array([...ftyp, ...moov]).buffer;
}

describe("reading the codec from an init segment", () => {
  it("reads High 4.1, the profile the old hardcoded string assumed", () => {
    // configurationVersion, profile 0x64 (High), compat 0x00, level 0x29.
    const codec = codecStringFromInitSegment(
      initSegment([1, 0x64, 0x00, 0x29, 0xff]),
    );
    expect(codec).toBe("avc1.640029");
    expect(mseTypeFor(codec!)).toBe('video/mp4; codecs="avc1.640029"');
  });

  it("reads Constrained Baseline, which the CSI path actually publishes", () => {
    // profile 0x42 (Baseline), compat 0xe0 (constrained), level 0x1f (3.1).
    // This is the stream the hardcoded High-4.1 string black-screened.
    expect(
      codecStringFromInitSegment(initSegment([1, 0x42, 0xe0, 0x1f, 0xff])),
    ).toBe("avc1.42e01f");
  });

  it("reads Main profile too", () => {
    expect(
      codecStringFromInitSegment(initSegment([1, 0x4d, 0x40, 0x1e, 0xff])),
    ).toBe("avc1.4d401e");
  });

  it("reads an HEVC configuration", () => {
    // hvcC: byte1 = profile_space 0, tier 0, profile_idc 1; bytes 2-5 compat
    // flags; byte 12 level_idc 120 (L4.0).
    const hvcC = [
      1, 0x01, 0x60, 0x00, 0x00, 0x00, 0, 0, 0, 0, 0, 0, 120, 0,
    ];
    expect(
      codecStringFromInitSegment(initSegment(hvcC, "hvc1", "hvcC")),
    ).toBe("hvc1.1.60000000.L120");
  });

  it("returns null for bytes that are not an init segment", () => {
    // A real answer, not a reason to fall back to a guess: the guess is what
    // produced a silent black screen.
    expect(codecStringFromInitSegment(new ArrayBuffer(0))).toBeNull();
    expect(codecStringFromInitSegment(new ArrayBuffer(64))).toBeNull();
    const media = new Uint8Array(128).fill(0x41);
    expect(codecStringFromInitSegment(media.buffer)).toBeNull();
  });

  it("walks the box tree rather than scanning for the fourcc", () => {
    // `avcC` sitting in a box payload that is NOT a codec-configuration
    // position must not be read as one. A byte scan would match it and hand
    // the player a codec string built from unrelated sample bytes.
    const decoy = [
      ...[..."avcC"].map((c) => c.charCodeAt(0)),
      1,
      0x77,
      0x77,
      0x77,
    ];
    const withDecoy = box("free", decoy);
    const segment = new Uint8Array([
      ...withDecoy,
      ...new Uint8Array(initSegment([1, 0x42, 0xe0, 0x1f, 0xff])),
    ]).buffer;
    expect(codecStringFromInitSegment(segment)).toBe("avc1.42e01f");
  });

  it("refuses a box whose declared size runs past the buffer", () => {
    // Untrusted bytes off a WebSocket. An over-long size must not be read as
    // a licence to walk off the end.
    const truncated = new Uint8Array([
      0x00, 0x00, 0xff, 0xff,
      ...[..."moov"].map((c) => c.charCodeAt(0)),
      0, 0, 0, 0, 0, 0, 0, 0,
    ]).buffer;
    expect(codecStringFromInitSegment(truncated)).toBeNull();
  });
});
