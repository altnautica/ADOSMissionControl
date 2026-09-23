/**
 * Synchronous SHA-256 (FIPS 180-4).
 *
 * MAVLink v2 signing hashes every outbound frame on the send path, which is
 * synchronous and order-sensitive. Web Crypto's digest is async only, so the
 * frame signer uses this incremental implementation instead.
 *
 * @module protocol/sha256
 * @license GPL-3.0-only
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const H0 = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

/** Incremental SHA-256: `update()` any number of times, then `digest()` once. */
export class Sha256 {
  private readonly h = new Uint32Array(H0);
  private readonly block = new Uint8Array(64);
  private readonly w = new Uint32Array(64);
  private blockLen = 0;
  private totalLen = 0;
  private finished = false;

  update(data: Uint8Array): this {
    if (this.finished) throw new Error("Sha256: update after digest");
    let i = 0;
    this.totalLen += data.length;
    while (i < data.length) {
      const take = Math.min(64 - this.blockLen, data.length - i);
      this.block.set(data.subarray(i, i + take), this.blockLen);
      this.blockLen += take;
      i += take;
      if (this.blockLen === 64) {
        this.compress();
        this.blockLen = 0;
      }
    }
    return this;
  }

  digest(): Uint8Array {
    if (this.finished) throw new Error("Sha256: digest called twice");
    this.finished = true;
    const bitLen = this.totalLen * 8;
    this.block[this.blockLen++] = 0x80;
    if (this.blockLen > 56) {
      this.block.fill(0, this.blockLen);
      this.compress();
      this.blockLen = 0;
    }
    this.block.fill(0, this.blockLen, 56);
    // 64-bit big-endian bit length. totalLen stays far below 2^53.
    const hi = Math.floor(bitLen / 0x100000000);
    const lo = bitLen >>> 0;
    const view = new DataView(this.block.buffer);
    view.setUint32(56, hi, false);
    view.setUint32(60, lo, false);
    this.compress();

    const out = new Uint8Array(32);
    const outView = new DataView(out.buffer);
    for (let j = 0; j < 8; j++) outView.setUint32(j * 4, this.h[j], false);
    this.block.fill(0);
    this.w.fill(0);
    return out;
  }

  private compress(): void {
    const w = this.w;
    const b = this.block;
    for (let t = 0; t < 16; t++) {
      w[t] = (b[t * 4] << 24) | (b[t * 4 + 1] << 16) | (b[t * 4 + 2] << 8) | b[t * 4 + 3];
    }
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15];
      const y = w[t - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    let a = this.h[0], bb = this.h[1], c = this.h[2], d = this.h[3];
    let e = this.h[4], f = this.h[5], g = this.h[6], hh = this.h[7];
    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[t] + w[t]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & bb) ^ (a & c) ^ (bb & c);
      const t2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = bb; bb = a; a = (t1 + t2) | 0;
    }
    this.h[0] = (this.h[0] + a) | 0; this.h[1] = (this.h[1] + bb) | 0;
    this.h[2] = (this.h[2] + c) | 0; this.h[3] = (this.h[3] + d) | 0;
    this.h[4] = (this.h[4] + e) | 0; this.h[5] = (this.h[5] + f) | 0;
    this.h[6] = (this.h[6] + g) | 0; this.h[7] = (this.h[7] + hh) | 0;
  }
}

/** One-shot SHA-256 over the concatenation of `parts`. */
export function sha256(...parts: Uint8Array[]): Uint8Array {
  const h = new Sha256();
  for (const p of parts) h.update(p);
  return h.digest();
}
