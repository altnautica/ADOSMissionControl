/**
 * @module plugins/inline-host-types
 * @description The surface a trusted inline GCS module receives when the host
 * mounts it. Mirrors `@altnautica/plugin-sdk/inline` (`InlineHostApi`,
 * `InlinePluginModule`): the SDK types what an extension codes against, these
 * type what the host hands over. The two MUST stay in step.
 *
 * @license GPL-3.0-only
 */

import type { PluginRecord } from "./handlers/records";
import type { PairedNodeProfile } from "./types";

/** Which records `PluginRecordsApi.list` returns. */
export interface PluginRecordListOptions {
  collection: string;
  deviceId?: string;
  limit?: number;
}

/** The plugin's own cloud records (bridge methods `records.*`, capability
 * `cloud.records`). A refusal rejects with code `refused`. */
export interface PluginRecordsApi {
  list(opts: PluginRecordListOptions): Promise<PluginRecord[]>;
  get(collection: string, key: string): Promise<PluginRecord | null>;
  put(collection: string, key: string, data: unknown, opts?: { deviceId?: string }): Promise<void>;
  remove(collection: string, key: string): Promise<void>;
}

/** The request/event client an inline module's `ctx.client` exposes: the
 * public surface of the SDK `PluginClient`, over an in-memory channel. */
export interface InlineRpcClient {
  request<TResult = unknown>(
    method: string,
    capability: string,
    args: unknown,
    options?: { timeoutMs?: number },
  ): Promise<TResult>;
  on<TArgs = unknown>(method: string, handler: (args: TArgs) => void): () => void;
  subscribeTelemetry<TArgs = unknown>(
    topic: string,
    handler: (args: TArgs) => void,
  ): Promise<() => void>;
  subscribePerception<TBatch = unknown>(handler: (batch: TBatch) => void): Promise<() => void>;
  dispose(): void;
}

/** The SDK `PluginContext` shape, served by the host. */
export interface InlinePluginContext {
  client: InlineRpcClient;
  telemetry: {
    subscribe<TArgs = unknown>(topic: string, handler: (args: TArgs) => void): Promise<() => void>;
  };
  perception: {
    readTier(): Promise<unknown>;
    subscribeDetections(handler: (batch: unknown) => void): Promise<() => void>;
    readSessionHealth(): Promise<unknown>;
  };
  command: { send(command: string, args?: unknown): Promise<unknown> };
  notifications: { publish(payload: unknown): Promise<unknown> };
  recording: { mark(payload: unknown): Promise<unknown> };
  mission: {
    read(missionId: string): Promise<unknown>;
    write(update: unknown): Promise<unknown>;
  };
  config: { onChange<T = unknown>(handler: (next: T) => void): () => void };
  events: {
    subscribe<T = unknown>(topic: string, handler: (args: T) => void): () => void;
    listen<T = unknown>(topic: string, handler: (args: T) => void): Promise<() => void>;
    publish(topic: string, payload: unknown): Promise<unknown>;
  };
  records: PluginRecordsApi;
  theme: { onChange(handler: (vars: Record<string, string>) => void): () => void };
  i18n: { t(key: string, params?: Record<string, string | number>): string };
}

/** One paired node as `host.nodes.list()` reports it. */
export interface InlineNodeSummary {
  deviceId: string;
  name: string;
  profile: PairedNodeProfile;
  reachable: boolean;
}

/** The plugin's own HTTP server on one node, behind the agent passthrough
 * (`/api/plugins/{id}/x/<path>`). */
export interface InlineAgentApi {
  fetch(path: string, init?: RequestInit): Promise<Response>;
  /** Unavailable on an HTTPS origin. */
  websocket(path: string): Promise<WebSocket>;
}

export interface InlineHostApi {
  ctx: InlinePluginContext;
  plugin: { id: string; version: string; panelId: string; signerId: string };
  node: { deviceId: string | null; profile: PairedNodeProfile | null };
  /** The plugin's server on the mounted node. */
  agent: InlineAgentApi;
  /** An object URL for a file under the plugin's `gcs/` dir, revoked when the
   * module unmounts. */
  assetUrl(path: string): Promise<string>;
  /** The same file's bytes (an object URL cannot be fetched under the app
   * CSP); rejects `asset_unavailable` once the module has unmounted. */
  readAsset(path: string): Promise<Blob>;
  records: PluginRecordsApi;
  nodes: {
    list(): InlineNodeSummary[];
    /** The plugin's server on another node; rejects `node_unreachable` when
     * this browser has no reach to it. */
    agent(deviceId: string): InlineAgentApi;
    pluginConfig(deviceId: string): {
      get(): Promise<Record<string, unknown>>;
      set(key: string, value: unknown): Promise<void>;
    };
  };
  navigate(target: { nodeId?: string; surface?: string; agentPage?: string }): void;
}

/** What an inline module exports (default export or named `plugin`). */
export interface InlinePluginModule {
  mount(root: HTMLElement, host: InlineHostApi): (() => void) | Promise<() => void>;
}

export type InlineHostErrorCode =
  | "websocket_unavailable_over_https_proxy"
  | "no_node_agent"
  | "node_unreachable"
  | "unknown_node"
  | "asset_unavailable";

/** A host capability the inline module asked for is unavailable here. */
export class InlineHostError extends Error {
  readonly code: InlineHostErrorCode;
  constructor(code: InlineHostErrorCode, message: string) {
    super(message);
    this.name = "InlineHostError";
    this.code = code;
  }
}
