/**
 * Plugin `records.*` handlers: the plugin's own cloud records.
 *
 * A plugin lists, reads, writes and deletes small JSON records in its own
 * namespace under the signed-in operator's account (`convex/pluginRecords`).
 * The plugin id is bound from the mount this handler set was built for and
 * never read from the call's args, so one plugin's grant can never reach
 * another plugin's records. The bridge has already checked `cloud.records`.
 *
 * Every refusal answers `{ ok: false, error }` (the SDK rejects with it) with
 * one of: `unavailable` (signed out, demo, or no cloud client), `invalid_args`,
 * `too_large`, `limit_reached`, `not_permitted`, `failed`.
 *
 * @module plugins/handlers/records
 * @license GPL-3.0-only
 */

import { ConvexError } from "convex/values";
import type { ConvexReactClient } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { BridgeHandler } from "@/lib/plugins/bridge";
import { useAuthStore } from "@/stores/auth-store";
import { isDemoMode } from "@/lib/utils";
import { asRecord, readString } from "./args";

/** A record as a plugin sees it. */
export interface PluginRecord {
  collection: string;
  key: string;
  deviceId: string | null;
  data: unknown;
  updatedAt: number;
  writtenBy: "gcs" | "agent";
}

/** The cloud store the handlers write through, one call per bridge method. */
export interface PluginRecordsBackend {
  list(args: {
    pluginId: string;
    collection: string;
    deviceId?: string;
    limit?: number;
  }): Promise<PluginRecord[]>;
  get(args: { pluginId: string; collection: string; key: string }): Promise<PluginRecord | null>;
  put(args: {
    pluginId: string;
    collection: string;
    key: string;
    data: unknown;
    deviceId?: string;
  }): Promise<null>;
  remove(args: { pluginId: string; collection: string; key: string }): Promise<null>;
}

/** Back the records handlers with the app's Convex client. */
export function createConvexRecordsBackend(
  convex: Pick<ConvexReactClient, "query" | "mutation">,
): PluginRecordsBackend {
  return {
    list: (args) => convex.query(api.pluginRecords.list, args),
    get: (args) => convex.query(api.pluginRecords.get, args),
    put: (args) => convex.mutation(api.pluginRecords.put, args),
    remove: (args) => convex.mutation(api.pluginRecords.remove, args),
  };
}

type RecordsRefusal =
  | "unavailable"
  | "invalid_args"
  | "too_large"
  | "limit_reached"
  | "not_permitted"
  | "failed";

const SERVER_CODES: Record<string, RecordsRefusal> = {
  unauthenticated: "unavailable",
  not_permitted: "not_permitted",
  invalid_args: "invalid_args",
  too_large: "too_large",
  limit_reached: "limit_reached",
};

/** Map a failed backend call to the refusal the plugin sees. */
function refusalFor(err: unknown): RecordsRefusal {
  if (err instanceof ConvexError) {
    const code = asRecord(err.data).code;
    if (typeof code === "string" && Object.hasOwn(SERVER_CODES, code)) return SERVER_CODES[code];
  }
  return "failed";
}

/**
 * Build the `records.*` handlers for one plugin. Without a backend, signed
 * out, or in demo mode every call answers `unavailable`.
 */
export function buildRecordsHandlers(
  pluginId: string,
  backend?: PluginRecordsBackend,
): Record<string, BridgeHandler> {
  const run = async (call: (store: PluginRecordsBackend) => Promise<unknown>) => {
    if (!backend || isDemoMode() || !useAuthStore.getState().isAuthenticated) {
      return { ok: false, error: "unavailable" };
    }
    try {
      return { ok: true, result: await call(backend) };
    } catch (err) {
      return { ok: false, error: refusalFor(err) };
    }
  };
  const invalid = { ok: false, error: "invalid_args" } as const;

  return {
    "records.list": (args) => {
      const collection = readString(args, "collection");
      const { deviceId, limit } = asRecord(args);
      if (
        collection === undefined ||
        (deviceId !== undefined && typeof deviceId !== "string") ||
        (limit !== undefined && typeof limit !== "number")
      ) {
        return invalid;
      }
      return run((store) => store.list({ pluginId, collection, deviceId, limit }));
    },
    "records.get": (args) => {
      const collection = readString(args, "collection");
      const key = readString(args, "key");
      if (collection === undefined || key === undefined) return invalid;
      return run((store) => store.get({ pluginId, collection, key }));
    },
    "records.put": (args) => {
      const collection = readString(args, "collection");
      const key = readString(args, "key");
      const { data, deviceId } = asRecord(args);
      if (
        collection === undefined ||
        key === undefined ||
        data === undefined ||
        (deviceId !== undefined && typeof deviceId !== "string")
      ) {
        return invalid;
      }
      return run((store) => store.put({ pluginId, collection, key, data, deviceId }));
    },
    "records.remove": (args) => {
      const collection = readString(args, "collection");
      const key = readString(args, "key");
      if (collection === undefined || key === undefined) return invalid;
      return run((store) => store.remove({ pluginId, collection, key }));
    },
  };
}
