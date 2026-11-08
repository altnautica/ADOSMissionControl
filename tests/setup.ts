import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { Storage } from 'happy-dom';

// Node 25+ defines its own `localStorage` / `sessionStorage` globals, which are
// undefined unless Node runs with `--localstorage-file`. Vitest's DOM
// environment leaves a global it finds already defined in place, so on those
// Node versions the window's storage is shadowed and every store that persists
// reads undefined. Give the test window working storage there; on older Node
// the environment's own storage is already in place and this does nothing.
if (typeof document !== 'undefined') {
  for (const key of ['localStorage', 'sessionStorage'] as const) {
    if (globalThis[key] == null) {
      Object.defineProperty(globalThis, key, { value: new Storage(), configurable: true, writable: true });
    }
  }
}

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});
