/**
 * @module lib/credentials
 * @description Timing-safe comparison for agent API keys.
 * @license GPL-3.0-only
 *
 * Lives here rather than in `src/lib` because `convex/` is a separate tsconfig
 * project and cannot import across that boundary. Kept byte-identical between
 * the website superset and the OSS twin.
 */

/**
 * Timing-safe string comparison.
 *
 * Compares every character rather than returning at the first difference, so
 * the time taken does not reveal how much of a guessed key was correct. The
 * length check is deliberate and leaks only the length, which is not secret.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Verify a presented agent key against the stored one.
 *
 * A blank or missing key on EITHER side is refused outright, before any
 * comparison. Pairing used to persist `apiKey: ""` for a drone paired without
 * a key, and a plain `stored !== presented` check then authenticated any caller
 * who simply sent an empty string — `"" !== ""` is false. A row that cannot be
 * authenticated must stay that way rather than become a skeleton key.
 */
export function agentKeyMatches(
  stored: string | undefined | null,
  presented: string | undefined | null
): boolean {
  if (!stored || !presented) return false;
  return constantTimeEqual(stored, presented);
}
