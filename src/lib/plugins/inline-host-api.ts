"use client";

/**
 * @module plugins/inline-host-api
 * @description Builds the `InlineHostApi` one mounted inline module receives,
 * and owns everything it hands out that must be released when the module
 * unmounts: asset object URLs, sockets, the extension stylesheet.
 *
 * Agent calls target the plugin's own HTTP server behind the agent
 * passthrough on the node the module is mounted for, reached the way every
 * inline load reaches it (`./node-agent-reach`). Navigation targets are this
 * plugin's own pages.
 *
 * @license GPL-3.0-only
 */

import { useDroneManager } from "@/stores/drone-manager";
import { useNodeRegistryStore } from "@/stores/node-registry";
import { useUiStore } from "@/stores/ui-store";
import { usePluginConfigCache } from "./config-cache";
import { resolveFleetRowId } from "@/lib/nodes/fleet-row";
import { pluginPageId } from "@/components/dashboard/node-detail/surface-types";
import {
  InlineHostError,
  type InlineHostApi,
  type InlineNodeSummary,
  type InlinePluginContext,
} from "./inline-host-types";
import type { InlineBundle } from "./inline-loader";
import { isHttpsOrigin, pluginClientForReach, resolveNodeAgentReach } from "./node-agent-reach";
import type { PairedNodeProfile } from "./types";

/** Blob types for the asset extensions a module is likely to load; the type
 * decides whether a worker, a wasm stream or a stylesheet accepts the URL. */
const ASSET_TYPES: Record<string, string> = {
  js: "text/javascript",
  mjs: "text/javascript",
  wasm: "application/wasm",
  css: "text/css",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
  woff2: "font/woff2",
};

/** The companion stylesheet an inline extension may ship beside its module. */
const PLUGIN_STYLESHEET = "gcs/plugin.css";

export interface InlineHostSession {
  api: InlineHostApi;
  /** Release every URL, socket and stylesheet the module was handed. */
  release: () => void;
}

function clientFor(deviceId: string | null) {
  const reach = deviceId ? resolveNodeAgentReach(deviceId) : null;
  if (!reach) {
    throw new InlineHostError("no_node_agent", "Connect to this node to reach its extension");
  }
  return pluginClientForReach(reach);
}

export function createInlineHostSession(input: {
  pluginId: string;
  panelId: string;
  bundle: InlineBundle;
  deviceId: string | null;
  nodeProfile: PairedNodeProfile | null;
  ctx: InlinePluginContext;
}): InlineHostSession {
  const { pluginId, panelId, bundle, deviceId, ctx } = input;
  const objectUrls = new Map<string, Promise<string>>();
  const sockets = new Set<WebSocket>();
  let released = false;
  let stylesheet: HTMLStyleElement | null = null;

  const assetUrl = (path: string): Promise<string> => {
    if (released) return Promise.reject(new InlineHostError("asset_unavailable", "unmounted"));
    const rel = path.replace(/^\/+/, "");
    const cached = objectUrls.get(rel);
    if (cached) return cached;
    const ext = rel.split(".").pop()?.toLowerCase() ?? "";
    const url = bundle.readAsset(rel).then((blob) =>
      URL.createObjectURL(new Blob([blob], { type: ASSET_TYPES[ext] ?? "application/octet-stream" })),
    );
    objectUrls.set(rel, url);
    url.catch(() => objectUrls.delete(rel));
    return url;
  };

  // Injected as a <style> element: the app CSP's style-src admits inline
  // styles but not `blob:` stylesheet links.
  if (bundle.trust.paths.includes(PLUGIN_STYLESHEET)) {
    void bundle
      .readAsset(PLUGIN_STYLESHEET.slice("gcs/".length))
      .then((blob) => blob.text())
      .then(
        (css) => {
          if (released) return;
          stylesheet = document.createElement("style");
          stylesheet.textContent = css;
          stylesheet.dataset.pluginStyle = pluginId;
          document.head.append(stylesheet);
        },
        (err: unknown) => {
          console.warn(`Plugin ${pluginId} stylesheet did not load`, err);
        },
      );
  }

  const api: InlineHostApi = {
    ctx,
    plugin: {
      id: pluginId,
      version: bundle.trust.version,
      panelId,
      signerId: bundle.trust.signerId,
    },
    node: { deviceId, profile: input.nodeProfile },
    agent: {
      fetch: async (path, init) => clientFor(deviceId).pluginHttp(pluginId, path, init),
      websocket: async (path) => {
        if (isHttpsOrigin()) {
          throw new InlineHostError(
            "websocket_unavailable_over_https_proxy",
            "A plugin WebSocket needs Mission Control served over HTTP on the node's network",
          );
        }
        const socket = await clientFor(deviceId).openPluginSocket(pluginId, path);
        if (released) {
          socket.close();
          throw new InlineHostError("no_node_agent", "unmounted");
        }
        sockets.add(socket);
        socket.addEventListener("close", () => sockets.delete(socket));
        return socket;
      },
    },
    assetUrl,
    records: ctx.records,
    nodes: {
      list: (): InlineNodeSummary[] =>
        Object.values(useNodeRegistryStore.getState().nodes)
          .filter((e) => e.nodeId.startsWith("node:"))
          .map((e) => ({
            deviceId: e.presence.deviceId,
            name: e.presence.name,
            profile: e.presence.profile,
            reachable: resolveNodeAgentReach(e.presence.deviceId) !== null,
          })),
      pluginConfig: (target) => ({
        get: () => clientFor(target).getConfig(pluginId),
        set: async (key, value) => {
          await clientFor(target).setConfig(pluginId, key, value);
          usePluginConfigCache.getState().record(target, pluginId, key, value);
        },
      }),
    },
    navigate: ({ nodeId, surface, agentPage }) => {
      if (nodeId) {
        const rowId = resolveFleetRowId(nodeId);
        if (!rowId) throw new InlineHostError("unknown_node", `no node ${nodeId} in the fleet`);
        useDroneManager.getState().selectDrone(rowId);
      }
      const ui = useUiStore.getState();
      if (agentPage) {
        ui.setPendingDetailTab("agent");
        ui.setPendingAgentPanel(pluginPageId(pluginId, agentPage));
      } else if (surface) {
        ui.setPendingDetailTab(pluginPageId(pluginId, surface));
      }
    },
  };

  return {
    api,
    release: () => {
      released = true;
      stylesheet?.remove();
      for (const socket of sockets) socket.close();
      sockets.clear();
      for (const url of objectUrls.values()) {
        void url.then((u) => URL.revokeObjectURL(u), () => {});
      }
      objectUrls.clear();
    },
  };
}
