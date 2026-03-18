import { vi } from 'vitest';

const store = new Map<string, unknown>();

export const get = vi.fn(async (key: string) => store.get(key));
export const set = vi.fn(async (key: string, value: unknown) => { store.set(key, value); });
export const del = vi.fn(async (key: string) => { store.delete(key); });
export const clear = vi.fn(async () => { store.clear(); });
export const keys = vi.fn(async () => Array.from(store.keys()));
export const entries = vi.fn(async () => Array.from(store.entries()));
