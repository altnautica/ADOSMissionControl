/**
 * @module atlas/viewers/decimate-cloud
 * @description Point-budget decimation for a dense point cloud, shared by the LOD
 * cloud viewer and the Cesium geo viewer. A reconstructed `.ply` can carry tens
 * of millions of points; holding all of them on the GPU (one big THREE.Points)
 * or as Cesium point primitives exhausts browser memory. This caps the RETAINED
 * point set to a budget with a single-level voxel-grid pass (one representative
 * point per occupied cell — the base level of an octree, so the kept points stay
 * spatially uniform rather than clumped like a naive head-of-array slice), and a
 * deterministic stride fallback guarantees the result never exceeds the budget.
 *
 * It does NOT stream: the caller has already parsed the whole file into CPU
 * arrays (true out-of-core octree streaming, what Potree does, stays a follow-on
 * — its loader pins an older three than the repo's 0.183). What this removes is
 * the steady-state cost: after decimation the caller disposes the full geometry
 * and keeps only `kept` points, so a 20-million-point cloud renders from a
 * bounded buffer.
 * @license GPL-3.0-only
 */

export interface DecimatedCloud {
  /** Kept positions as xyz triples (own buffer, safe after the source is freed). */
  positions: Float32Array;
  /** Kept colours as rgb triples in 0..1, or null when the cloud has no colour. */
  colors: Float32Array | null;
  /** Original point count. */
  total: number;
  /** Retained point count (always &le; `budget`). */
  kept: number;
  /** Whether any points were dropped (total &gt; budget). */
  decimated: boolean;
}

/** Largest grid resolution per axis; keeps the cell key well inside a safe int. */
const MAX_GRID_RES = 512;

/**
 * Decimate a point cloud to at most `budget` points.
 *
 * @param positions xyz triples (any numeric array; read-only here).
 * @param colors    rgb triples in 0..1 aligned to `positions`, or null.
 * @param budget    target maximum point count (&gt; 0).
 */
export function decimateCloud(
  positions: ArrayLike<number>,
  colors: ArrayLike<number> | null,
  budget: number,
): DecimatedCloud {
  const total = Math.floor(positions.length / 3);

  // Fast path: already within budget — copy through into owned buffers so the
  // caller can dispose the source geometry without dangling the typed arrays.
  if (budget <= 0 || total <= budget) {
    const n = total * 3;
    const pos = new Float32Array(n);
    for (let i = 0; i < n; i++) pos[i] = positions[i];
    let col: Float32Array | null = null;
    if (colors) {
      col = new Float32Array(n);
      for (let i = 0; i < n; i++) col[i] = colors[i];
    }
    return { positions: pos, colors: col, total, kept: total, decimated: false };
  }

  // ── Voxel-grid pass: keep the first point seen in each occupied cell ──
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < total; i++) {
    const b = i * 3;
    const x = positions[b];
    const y = positions[b + 1];
    const z = positions[b + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  // Resolution scaled so occupied cells land near the budget for typical
  // surface-shell occupancy; clamped to keep the integer cell key safe.
  const res = Math.min(
    MAX_GRID_RES,
    Math.max(16, Math.round(Math.cbrt(budget)) * 2),
  );
  const extX = maxX - minX;
  const extY = maxY - minY;
  const extZ = maxZ - minZ;
  const invX = extX > 0 ? (res - 1) / extX : 0;
  const invY = extY > 0 ? (res - 1) / extY : 0;
  const invZ = extZ > 0 ? (res - 1) / extZ : 0;

  // One bit per grid cell (res <= 512, so at most 16 MB) instead of a Set of
  // up to res^3 boxed keys; kept indices go into a typed array that can never
  // outgrow the occupied cells or the point count.
  const cellCount = res * res * res;
  const seen = new Uint8Array(Math.ceil(cellCount / 8));
  const kept = new Uint32Array(Math.min(total, cellCount));
  let keptCount = 0;
  for (let i = 0; i < total; i++) {
    const b = i * 3;
    const ix = Math.floor((positions[b] - minX) * invX);
    const iy = Math.floor((positions[b + 1] - minY) * invY);
    const iz = Math.floor((positions[b + 2] - minZ) * invZ);
    const key = ix + iy * res + iz * res * res;
    const byte = key >>> 3;
    const bit = 1 << (key & 7);
    if ((seen[byte] & bit) === 0) {
      seen[byte] |= bit;
      kept[keptCount++] = i;
    }
  }

  // ── Stride fallback: a near-uniform cloud can occupy more cells than the
  // budget; thin the kept indices deterministically so the cap always holds.
  const stride = keptCount > budget ? Math.ceil(keptCount / budget) : 1;
  const keptN = Math.ceil(keptCount / stride);

  const outPos = new Float32Array(keptN * 3);
  const outCol = colors ? new Float32Array(keptN * 3) : null;
  for (let k = 0; k < keptN; k++) {
    const src = kept[k * stride] * 3;
    const dst = k * 3;
    outPos[dst] = positions[src];
    outPos[dst + 1] = positions[src + 1];
    outPos[dst + 2] = positions[src + 2];
    if (outCol && colors) {
      outCol[dst] = colors[src];
      outCol[dst + 1] = colors[src + 1];
      outCol[dst + 2] = colors[src + 2];
    }
  }

  return {
    positions: outPos,
    colors: outCol,
    total,
    kept: keptN,
    decimated: true,
  };
}
