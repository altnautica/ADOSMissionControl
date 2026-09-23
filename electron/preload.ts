import { contextBridge, ipcRenderer } from "electron";
import type { UpdateStatus } from "./updater";

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  platform: process.platform,

  // App info
  getVersion: () => ipcRenderer.invoke("app:version"),

  // Window controls (for custom title bar if needed)
  minimize: () => ipcRenderer.invoke("window:minimize"),
  maximize: () => ipcRenderer.invoke("window:maximize"),
  close: () => ipcRenderer.invoke("window:close"),

  // Updates: the main process keeps the latest status, so a page that mounts
  // after the startup check reads it with `status()` and follows `onStatus`.
  updates: {
    status: (): Promise<UpdateStatus> => ipcRenderer.invoke("update:status"),
    onStatus: (callback: (status: UpdateStatus) => void) => {
      const handler = (_e: unknown, status: UpdateStatus) => callback(status);
      ipcRenderer.on("update:status", handler);
      return () => ipcRenderer.removeListener("update:status", handler);
    },
    download: () => ipcRenderer.invoke("update:download"),
    install: () => ipcRenderer.invoke("update:install"),
  },

  // Native UDP/TCP MAVLink sockets (the browser sandbox can't open raw sockets).
  net: {
    open: (spec: {
      proto: "udp" | "tcp";
      host: string;
      port: number;
      mode?: "listen" | "target";
    }) => ipcRenderer.invoke("net:open", spec),
    send: (id: string, data: Uint8Array) =>
      ipcRenderer.invoke("net:send", id, data),
    close: (id: string) => ipcRenderer.invoke("net:close", id),
    onData: (callback: (msg: { id: string; data: Uint8Array }) => void) => {
      const handler = (_e: unknown, msg: { id: string; data: Uint8Array }) =>
        callback(msg);
      ipcRenderer.on("net:data", handler);
      return () => ipcRenderer.removeListener("net:data", handler);
    },
    onClose: (callback: (msg: { id: string; reason?: string }) => void) => {
      const handler = (_e: unknown, msg: { id: string; reason?: string }) =>
        callback(msg);
      ipcRenderer.on("net:close", handler);
      return () => ipcRenderer.removeListener("net:close", handler);
    },
  },
});
