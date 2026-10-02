import { BrowserWindow, ipcMain, safeStorage } from "electron";

/** Longest key or ciphertext accepted over the bridge. Agent keys are short;
 * this only bounds what a misbehaving page can make the main process do. */
const MAX_INPUT_CHARS = 4096;

/** True when the OS offers a real key store. Linux without a secret service
 * falls back to `basic_text`, a fixed key that protects nothing, so it counts
 * as no key store. */
function keyStoreAvailable(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  return process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text";
}

/**
 * Register the paired-node key bridge: `localNodes:encrypt` seals an agent API
 * key with `safeStorage` and answers base64 ciphertext (or null when the OS has
 * no key store, so the renderer keeps its web behaviour), and
 * `localNodes:decrypt` opens it again. Only the main window's own frame may
 * call either.
 */
export function setupLocalNodeKeys(window: BrowserWindow): void {
  const fromMainWindow = (event: Electron.IpcMainInvokeEvent): boolean =>
    !window.isDestroyed() && event.sender === window.webContents;

  ipcMain.handle("localNodes:encrypt", (e, key: unknown): string | null => {
    if (!fromMainWindow(e)) throw new Error("localNodes:encrypt: unauthorized sender");
    if (typeof key !== "string" || key.length === 0 || key.length > MAX_INPUT_CHARS) {
      throw new Error("localNodes:encrypt: invalid key");
    }
    if (!keyStoreAvailable()) return null;
    return safeStorage.encryptString(key).toString("base64");
  });

  ipcMain.handle("localNodes:decrypt", (e, sealed: unknown): string => {
    if (!fromMainWindow(e)) throw new Error("localNodes:decrypt: unauthorized sender");
    if (typeof sealed !== "string" || sealed.length === 0 || sealed.length > MAX_INPUT_CHARS) {
      throw new Error("localNodes:decrypt: invalid value");
    }
    return safeStorage.decryptString(Buffer.from(sealed, "base64"));
  });
}
