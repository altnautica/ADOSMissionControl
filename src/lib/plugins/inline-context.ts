/**
 * @module plugins/inline-context
 * @description The SDK `PluginContext` an inline module receives as
 * `host.ctx`, served over an in-memory channel into the same envelope
 * dispatcher the iframe bridge uses. Every call therefore passes the same
 * schema, method, token and capability checks as an iframe plugin's; only the
 * postMessage hop is gone. Behaviour mirrors `@altnautica/plugin-sdk`'s
 * `PluginClient` and `createPluginContext` (request deadlines, token stamping
 * from `capability.token`, stream open/close, refusal unwrapping).
 *
 * @license GPL-3.0-only
 */

import type { PluginRpcEnvelope } from "./types";
import type { PluginRecord } from "./handlers/records";
import type { InlinePluginContext, InlineRpcClient } from "./inline-host-types";

/** Default request deadline, as in the SDK client. */
const REQUEST_TIMEOUT_MS = 5_000;
/** Operator-approved calls wait for the operator; the host bounds the wait. */
const OPERATOR_CONFIRMED = { timeoutMs: Number.POSITIVE_INFINITY };

/** A host refusal or RPC error, carrying the wire code (`refused`, `timeout`,
 * `permission_denied`, ...). Named like the SDK's so `err.name` reads alike. */
export class InlineRpcError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "HostError";
    this.code = code;
  }
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: InlineRpcError) => void;
  cancelDeadline: () => void;
}

/** The inline client plus the inbound half the host feeds responses and
 * events into. */
export interface InlineChannel {
  client: InlineRpcClient;
  /** Deliver one host envelope (response or event) to the module. */
  receive: (env: PluginRpcEnvelope) => void;
}

/** Build the module-side client over `send` (the dispatcher's input). */
export function createInlineChannel(send: (env: PluginRpcEnvelope) => void): InlineChannel {
  const pending = new Map<string, Pending>();
  const subscriptions = new Map<string, Set<(args: unknown) => void>>();
  let token: string | null = null;
  let disposed = false;

  const on = <TArgs>(method: string, handler: (args: TArgs) => void): (() => void) => {
    const set = subscriptions.get(method) ?? new Set();
    set.add(handler as (args: unknown) => void);
    subscriptions.set(method, set);
    return () => {
      const live = subscriptions.get(method);
      if (!live) return;
      live.delete(handler as (args: unknown) => void);
      if (live.size === 0) subscriptions.delete(method);
    };
  };

  const request = <TResult>(
    method: string,
    capability: string,
    args: unknown,
    options?: { timeoutMs?: number },
  ): Promise<TResult> => {
    if (disposed) return Promise.reject(new InlineRpcError("disposed", "client disposed"));
    const id = crypto.randomUUID();
    return new Promise<TResult>((resolve, reject) => {
      const slot: Pending = {
        resolve: resolve as (value: unknown) => void,
        reject,
        cancelDeadline: () => {},
      };
      pending.set(id, slot);
      const timeoutMs = options?.timeoutMs ?? REQUEST_TIMEOUT_MS;
      if (timeoutMs > 0 && timeoutMs !== Number.POSITIVE_INFINITY) {
        const timer = setTimeout(() => {
          if (pending.get(id) !== slot) return;
          pending.delete(id);
          reject(new InlineRpcError("timeout", `host did not respond within ${timeoutMs}ms (method=${method})`));
        }, timeoutMs);
        slot.cancelDeadline = () => clearTimeout(timer);
      }
      send({
        id,
        type: "request",
        method,
        capability,
        args,
        version: 1,
        ...(token !== null ? { token } : {}),
      });
    });
  };

  /** Register a stream handler, then open the stream on the host; the close
   * request is best-effort so unmount paths never throw. */
  const openStream = async <TArgs>(
    eventMethod: string,
    handler: (args: TArgs) => void,
    open: () => Promise<unknown>,
    close: () => Promise<unknown>,
  ): Promise<() => void> => {
    const off = on(eventMethod, handler);
    try {
      await open();
    } catch (err) {
      off();
      throw err;
    }
    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      off();
      if (subscriptions.has(eventMethod)) return;
      void close().catch(() => {});
    };
  };

  const client: InlineRpcClient = {
    request,
    on,
    subscribeTelemetry: (topic, handler) =>
      openStream(
        `telemetry.${topic}`,
        handler,
        () => request("telemetry.subscribe", `telemetry.subscribe.${topic}`, { topic }),
        () => request("telemetry.unsubscribe", "", { topic }),
      ),
    subscribePerception: (handler) =>
      openStream(
        "perception.detections",
        handler,
        () => request("perception.subscribe", "perception.subscribe", {}),
        () => request("perception.unsubscribe", "perception.subscribe", {}),
      ),
    dispose: () => {
      disposed = true;
      for (const slot of pending.values()) {
        slot.cancelDeadline();
        slot.reject(new InlineRpcError("disposed", "client disposed"));
      }
      pending.clear();
      subscriptions.clear();
    },
  };

  const receive = (env: PluginRpcEnvelope): void => {
    if (env.type === "response") {
      const slot = pending.get(env.id);
      if (!slot) return;
      pending.delete(env.id);
      slot.cancelDeadline();
      if (env.error) slot.reject(new InlineRpcError(env.error.code, env.error.message));
      else slot.resolve(env.args);
      return;
    }
    if (env.type !== "event") return;
    if (env.method === "capability.token") {
      const next = (env.args as { token?: unknown } | null)?.token;
      token = typeof next === "string" && next.length > 0 ? next : null;
    }
    for (const fn of subscriptions.get(env.method) ?? []) fn(env.args);
  };

  return { client, receive };
}

/** Reject a `{ ok: false, error }` refusal; pass anything else through. */
async function unlessRefused<T>(pendingResult: Promise<T>): Promise<T> {
  const result = await pendingResult;
  if (typeof result === "object" && result !== null && "ok" in result && result.ok === false) {
    const reason = "error" in result ? result.error : undefined;
    throw new InlineRpcError(
      "refused",
      typeof reason === "string" && reason.length > 0 ? reason : "the host refused the request",
    );
  }
  return result;
}

/** Unwrap a `{ ok: true, result }` answer, rejecting a refusal. */
async function hostResult<T>(pendingResult: Promise<unknown>): Promise<T> {
  const answer = await unlessRefused(pendingResult);
  if (typeof answer !== "object" || answer === null || !("result" in answer)) {
    throw new InlineRpcError("refused", "the host answered without a result");
  }
  return answer.result as T;
}

function formatLocale(
  bundle: Readonly<Record<string, string>>,
  key: string,
  params?: Record<string, string | number>,
): string {
  const tpl = bundle[key];
  if (tpl === undefined) return key;
  if (!params) return tpl;
  return tpl.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params[name];
    return value === undefined ? `{${name}}` : String(value);
  });
}

/** The SDK context shape over `client`. */
export function createInlineContext(
  client: InlineRpcClient,
  locale: Readonly<Record<string, string>> = {},
): InlinePluginContext {
  return {
    client,
    telemetry: { subscribe: (topic, handler) => client.subscribeTelemetry(topic, handler) },
    perception: {
      readTier: () => client.request("perception.read", "perception.read", {}),
      subscribeDetections: (handler) => client.subscribePerception(handler),
      readSessionHealth: () => client.request("perception.health", "perception.read", {}),
    },
    command: {
      send: (command, args) =>
        unlessRefused(
          client.request("command.send", "command.send", { command, args }, OPERATOR_CONFIRMED),
        ),
    },
    notifications: {
      publish: (payload) =>
        unlessRefused(
          client.request("notification.publish", "ui.slot.notification-channel", payload),
        ),
    },
    recording: {
      mark: (payload) => unlessRefused(client.request("recording.mark", "recording.write", payload)),
    },
    mission: {
      read: (missionId) => client.request("mission.read", "mission.read", { missionId }),
      write: (update) =>
        unlessRefused(client.request("mission.write", "mission.write", update, OPERATOR_CONFIRMED)),
    },
    config: { onChange: (handler) => client.on("config.changed", handler) },
    events: {
      subscribe: (topic, handler) => client.on(topic, handler),
      listen: async (topic, handler) => {
        // The host delivers bus events with the topic as the method.
        const off = client.on(topic, handler);
        try {
          await client.request("events.subscribe", "event.subscribe", { topic });
        } catch (err) {
          off();
          throw err;
        }
        return () => {
          off();
          void client.request("events.unsubscribe", "", { topic }).catch(() => {});
        };
      },
      publish: (topic, payload) =>
        client.request("events.publish", "event.publish", { topic, payload }),
    },
    records: {
      list: (opts) => hostResult<PluginRecord[]>(client.request("records.list", "cloud.records", opts)),
      get: (collection, key) =>
        hostResult<PluginRecord | null>(
          client.request("records.get", "cloud.records", { collection, key }),
        ),
      put: async (collection, key, data, opts) => {
        await unlessRefused(
          client.request("records.put", "cloud.records", {
            collection,
            key,
            data,
            ...(opts?.deviceId !== undefined ? { deviceId: opts.deviceId } : {}),
          }),
        );
      },
      remove: async (collection, key) => {
        await unlessRefused(client.request("records.remove", "cloud.records", { collection, key }));
      },
    },
    theme: {
      onChange: (handler) => client.on<Record<string, string>>("theme.changed", handler),
    },
    i18n: { t: (key, params) => formatLocale(locale, key, params) },
  };
}
