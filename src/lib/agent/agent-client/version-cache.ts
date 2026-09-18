/**
 * @module agent/agent-client/version-cache
 * @description Module-level cache for `/api/version` responses so
 * multiple components hitting `getVersion()` in the same render frame
 * coalesce into a single network call.
 * @license GPL-3.0-only
 */

import type { AgentVersionInfo } from "../types";
import { AgentVersionInfoSchema } from "../schemas";
import { agentRequest, AgentHttpError, type RequestContext } from "./transport";
import type { z } from "zod";

const CAPABILITY_TTL_MS = 5 * 60 * 1000;

/**
 * How long a *durable* negative is cached. A 404/501 means this agent build
 * has no `/api/version`, which will not change until it is upgraded — but
 * five minutes of not re-asking is plenty, and re-asking is one cheap GET.
 */
const ABSENT_TTL_MS = 60 * 1000;

interface CachedVersion {
  info: AgentVersionInfo | null;
  expiresAt: number;
}

const versionCache = new Map<string, CachedVersion>();

/**
 * Fetch the agent's wire-protocol version + capability flags.
 * Returns null when the agent is older than 0.8.6 (does not have
 * the endpoint). Cached for 5 minutes per baseUrl+apiKey to avoid
 * burning requests when multiple components ask in the same frame.
 */
export async function fetchVersionInfo(
  ctx: RequestContext,
  opts?: { force?: boolean },
): Promise<AgentVersionInfo | null> {
  const key = `${ctx.baseUrl}|${ctx.apiKey ?? ""}`;
  const cached = versionCache.get(key);
  if (cached && !opts?.force && Date.now() < cached.expiresAt) {
    return cached.info;
  }
  let info: AgentVersionInfo | null = null;
  try {
    info = await agentRequest<AgentVersionInfo>(ctx, "/api/version", {
      schema: AgentVersionInfoSchema as z.ZodType<AgentVersionInfo>,
    });
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.debug("[agent-client] getVersion failed:", err);
    }
    // A 404/501 is the pre-0.8.6 agent that genuinely has no `/api/version`;
    // that answer is durable enough to cache briefly. ANY OTHER failure —
    // the 6 s deadline firing during bring-up, a refused connection while
    // the agent restarts, a schema mismatch — is transient, and caching it
    // used to pin the node's capability set to empty for five minutes:
    // every `agentSupports()` call returned false, so the GCS silently took
    // legacy code paths on a fully capable agent long after it recovered.
    // Leave the cache untouched so the next caller retries.
    const durable =
      err instanceof AgentHttpError &&
      (err.status === 404 || err.status === 501);
    if (!durable) {
      versionCache.delete(key);
      return null;
    }
    versionCache.set(key, {
      info: null,
      expiresAt: Date.now() + ABSENT_TTL_MS,
    });
    return null;
  }
  versionCache.set(key, {
    info,
    expiresAt: Date.now() + CAPABILITY_TTL_MS,
  });
  return info;
}

/**
 * Capability flag presence check that gracefully handles older agents
 * (where /api/version is absent). Falls back to feature absent.
 */
export function agentSupports(
  info: AgentVersionInfo | null | undefined,
  capability: string,
): boolean {
  if (!info) return false;
  return info.capabilities.includes(capability);
}
