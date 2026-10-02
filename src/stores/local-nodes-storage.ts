/**
 * @module LocalNodesStorage
 * @description Persistence for the browser-local node registry
 * (`local-nodes-store`): where each paired node's API key is kept at rest,
 * and how one tab learns what another tab wrote.
 *
 * Key at rest:
 *   - Desktop app: every `apiKey` is sealed by the main process with the OS
 *     key store (Electron `safeStorage`, reached over the preload's
 *     `localNodes.encrypt` / `localNodes.decrypt` IPC pair) and persisted as
 *     `safestorage:<base64>`. A copy of the profile directory, or script that
 *     reads localStorage, sees ciphertext. Where the OS offers no key store
 *     (`encrypt` answers null) the key is stored as the web build stores it.
 *   - Web: localStorage, plaintext. Any script running on the Mission Control
 *     origin can read it.
 *
 * Cross-tab: `persistedNodesIfChanged` reports the registry another tab
 * wrote since this tab last wrote it, so a mutation can build on the newest
 * list instead of overwriting it with a stale one.
 *
 * @license GPL-3.0-only
 */

import type { PersistStorage, StorageValue } from "zustand/middleware";
import type { LocalNode } from "./local-nodes-store";

export const LOCAL_NODES_STORE_KEY = "altcmd:local-nodes";

/** The part of the registry that is persisted. */
export interface PersistedLocalNodes {
  nodes: LocalNode[];
}

/** The desktop app's key-sealing bridge (absent in browsers). */
type KeyCodec = NonNullable<NonNullable<Window["electronAPI"]>["localNodes"]>;

const SEALED_PREFIX = "safestorage:";

/** sealed value → plaintext key, and the reverse, for every key this window
 * sealed or opened. Lets a synchronous read resolve a sealed key and keeps a
 * re-write from sealing the same key twice. */
const openedBySealed = new Map<string, string>();
const sealedByKey = new Map<string, string>();

/** The serialised value this tab last wrote, and how many writes are still
 * being sealed. */
let ownRaw: string | null = null;
let pendingWrites = 0;
let writeChain: Promise<void> = Promise.resolve();

function backingStore(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function keyCodec(): KeyCodec | null {
  return typeof window !== "undefined" ? (window.electronAPI?.localNodes ?? null) : null;
}

function parse(raw: string): StorageValue<PersistedLocalNodes> | null {
  try {
    const value = JSON.parse(raw) as { state?: { nodes?: unknown }; version?: unknown };
    const nodes = value.state?.nodes;
    if (!Array.isArray(nodes)) return null;
    const valid = nodes.filter(
      (n: unknown): n is LocalNode =>
        typeof n === "object" &&
        n !== null &&
        "deviceId" in n &&
        typeof n.deviceId === "string" &&
        "apiKey" in n &&
        typeof n.apiKey === "string",
    );
    return {
      state: { nodes: valid },
      version: typeof value.version === "number" ? value.version : undefined,
    };
  } catch {
    return null;
  }
}

/** The plaintext of a stored key when this window already knows it; a sealed
 * value it has not opened yet is returned as is (rehydration opens it). */
function openKnown(stored: string): string {
  return stored.startsWith(SEALED_PREFIX) ? (openedBySealed.get(stored) ?? stored) : stored;
}

async function openKey(stored: string, codec: KeyCodec): Promise<string> {
  if (!stored.startsWith(SEALED_PREFIX)) return stored;
  const known = openedBySealed.get(stored);
  if (known !== undefined) return known;
  try {
    const key = await codec.decrypt(stored.slice(SEALED_PREFIX.length));
    openedBySealed.set(stored, key);
    sealedByKey.set(key, stored);
    return key;
  } catch {
    // Sealed under a key store this profile can no longer open. Keep the
    // sealed value: the node refuses it, and its card offers a re-pair.
    return stored;
  }
}

async function sealKey(key: string, codec: KeyCodec): Promise<string> {
  if (key === "" || key.startsWith(SEALED_PREFIX)) return key;
  const known = sealedByKey.get(key);
  if (known !== undefined) return known;
  const cipher = await codec.encrypt(key).catch(() => null);
  if (cipher === null) return key;
  const sealed = `${SEALED_PREFIX}${cipher}`;
  sealedByKey.set(key, sealed);
  openedBySealed.set(sealed, key);
  return sealed;
}

function withKeys(
  value: StorageValue<PersistedLocalNodes>,
  nodes: LocalNode[],
): StorageValue<PersistedLocalNodes> {
  return { ...value, state: { ...value.state, nodes } };
}

/**
 * The persist adapter. Synchronous on the web, so the registry hydrates
 * before the first render; asynchronous only when the desktop app has keys to
 * open or seal. Writes are serialised, so a later state never lands before an
 * earlier one.
 */
export const localNodesStorage: PersistStorage<PersistedLocalNodes> = {
  getItem(name) {
    const raw = backingStore()?.getItem(name) ?? null;
    if (raw === null) return null;
    const value = parse(raw);
    if (!value) return null;
    const codec = keyCodec();
    // A registry written before keys were sealed (or while the OS key store
    // was unavailable) is re-written now, so plaintext does not wait on disk
    // for the next unrelated change. The write is queued, so it lands before
    // any later one.
    if (codec && value.state.nodes.some((n) => n.apiKey !== "" && !n.apiKey.startsWith(SEALED_PREFIX))) {
      void localNodesStorage.setItem(name, value);
    }
    const unopened = value.state.nodes.some(
      (n) => n.apiKey.startsWith(SEALED_PREFIX) && !openedBySealed.has(n.apiKey),
    );
    if (!codec || !unopened) {
      return withKeys(value, value.state.nodes.map((n) => ({ ...n, apiKey: openKnown(n.apiKey) })));
    }
    return Promise.all(
      value.state.nodes.map(async (n) => ({ ...n, apiKey: await openKey(n.apiKey, codec) })),
    ).then((nodes) => withKeys(value, nodes));
  },
  setItem(name, value) {
    const codec = keyCodec();
    if (!codec) {
      const raw = JSON.stringify(value);
      ownRaw = raw;
      backingStore()?.setItem(name, raw);
      return;
    }
    pendingWrites += 1;
    writeChain = writeChain
      .then(async () => {
        const nodes = await Promise.all(
          value.state.nodes.map(async (n) => ({ ...n, apiKey: await sealKey(n.apiKey, codec) })),
        );
        const raw = JSON.stringify(withKeys(value, nodes));
        ownRaw = raw;
        backingStore()?.setItem(name, raw);
      })
      .catch((err: unknown) => {
        console.warn("[local-nodes] could not save the paired-node registry", err);
      })
      .finally(() => {
        pendingWrites -= 1;
      });
    return writeChain;
  },
  removeItem(name) {
    ownRaw = null;
    backingStore()?.removeItem(name);
  },
};

/**
 * The persisted node list when another tab wrote it after this tab's last
 * write, or null when the stored list is this tab's own (or a write of ours is
 * still being sealed, or the stored value is from another schema version).
 */
export function persistedNodesIfChanged(version: number): LocalNode[] | null {
  if (pendingWrites > 0) return null;
  const raw = backingStore()?.getItem(LOCAL_NODES_STORE_KEY) ?? null;
  if (raw === null || raw === ownRaw) return null;
  const value = parse(raw);
  if (!value || value.version !== version) return null;
  return value.state.nodes.map((n) => ({ ...n, apiKey: openKnown(n.apiKey) }));
}
