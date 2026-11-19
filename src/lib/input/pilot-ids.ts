// Random ids the pilot stream names its session and surface with.

/**
 * One page load is one stick session. `pilot.v1` carries the session as a
 * non-zero u32, so it is a random integer in 1..2^32-1.
 */
export function newSessionId(): number {
  const word = new Uint32Array(1);
  do {
    if (typeof crypto !== "undefined" && "getRandomValues" in crypto) crypto.getRandomValues(word);
    else word[0] = Math.floor(Math.random() * 0x1_0000_0000);
  } while (word[0] === 0);
  return word[0];
}

/** A surface instance id: 32 lowercase hex digits from 16 random bytes. */
export function newSurfaceSid(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
