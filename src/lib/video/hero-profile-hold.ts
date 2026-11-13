/**
 * @module video/hero-profile-hold
 * @description Holds a LAN-direct drone on the `hero` video profile while a
 * detail surface plays it (the focused drone's Agent-tab feed, the Overview Fly
 * pane, the cockpit canvas), and lets go when the last one closes.
 *
 * A WFB drone boots on `thumbnail` (320x180 at 1 fps) so a fleet powering up
 * together does not flood the shared channel, and waits to be promoted. The
 * hold is a lease on the agent's `POST /api/video/profile`:
 * - this tab takes the lease under one stable holder id, renews it at a third
 *   of the lease, and releases it with `DELETE` when the last surface closes,
 *   so a closed or crashed tab expires on its own and never strands the drone
 *   on hero;
 * - a renewal is checked: one that failed or came back without a live lease is
 *   retried after {@link HERO_RETRY_BACKOFF_MS} (1 s, then 2 s, then every
 *   4 s), so one dropped request never lets the lease lapse to thumbnail;
 * - the surfaces sharing the one session share one lease, counted per agent;
 * - the release waits {@link HERO_RELEASE_GRACE_MS}, so moving between two
 *   detail surfaces does not respawn the encoder twice;
 * - a ground station is never promoted;
 * - a failed promotion is retried for as long as some surface still holds the
 *   drone: a 429 (the request burst while a detail view mounts) after
 *   {@link HERO_RETRY_BACKOFF_MS}, anything else on the next status poll
 *   ({@link HERO_PROMOTE_RETRY_MS}). Only a 404, an agent with no profile
 *   route, ends it.
 * An agent that predates leases answers without a `leases` list; there the
 * hold falls back to a plain set, promoting only a drone it saw on
 * `thumbnail` and demoting only what it promoted.
 * Fleet tiles never take a hold: a grid stays on the fleet's allocation.
 *
 * @license GPL-3.0-only
 */

import type { AgentClient } from "@/lib/agent/client";
import { AgentHttpError } from "@/lib/agent/agent-client/transport";

/** The agent calls a hold makes; the connected `AgentClient` in practice. */
export type HeroProfileClient = Pick<
  AgentClient,
  "getFullStatus" | "setVideoProfile" | "releaseVideoProfile"
>;

/** How long the last released hold waits before releasing the lease. */
export const HERO_RELEASE_GRACE_MS = 5_000;

/** The lease this tab asks for; renewed at a third of it, so two renewals in
 * a row can fail before it lapses. */
export const HERO_LEASE_S = 30;
export const HERO_RENEW_MS = (HERO_LEASE_S * 1000) / 3;

/** The waits before each retry of a failed renewal or a rate-limited (429)
 * promotion; the last one repeats. */
export const HERO_RETRY_BACKOFF_MS: readonly number[] = [1_000, 2_000, 4_000];

/** The wait before retrying a promotion that failed any other way: the
 * agent's status poll cadence. */
export const HERO_PROMOTE_RETRY_MS = 3_000;

const HOLDER_KEY = "ados.heroProfileHolder";

function newHolderId(): string {
  const raw =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
      : Math.random().toString(36).slice(2, 18);
  return `mc:${raw}`;
}

let holderId: string | undefined;

/** One holder id per browser tab, stable across reloads of that tab. */
export function heroHolderId(): string {
  if (holderId) return holderId;
  try {
    const stored = sessionStorage.getItem(HOLDER_KEY);
    if (stored && /^[A-Za-z0-9._:-]{1,64}$/.test(stored)) {
      holderId = stored;
      return stored;
    }
    holderId = newHolderId();
    sessionStorage.setItem(HOLDER_KEY, holderId);
  } catch {
    holderId ??= newHolderId();
  }
  return holderId;
}

/** How this hold ended up holding the drone. */
type Outcome = "lease" | "legacy" | "none";

interface Hold {
  count: number;
  client: HeroProfileClient;
  outcome: Promise<Outcome>;
  /** The promotion gave up because no surface held the drone at a retry;
   * a re-acquire inside the grace starts it again. */
  abandoned: boolean;
  renewTimer: ReturnType<typeof setTimeout> | undefined;
  releaseTimer: ReturnType<typeof setTimeout> | undefined;
}

const holds = new Map<string, Hold>();

async function attemptPromote(client: HeroProfileClient, holder: string): Promise<Outcome> {
  const full = await client.getFullStatus();
  if (!full || full.profile === "ground-station") return "none";
  const observed = full.telemetry?.video_profile;
  // An agent that does not report its profile predates leases too.
  if (observed !== "hero" && observed !== "thumbnail") return "none";
  const applied = await client.setVideoProfile("hero", {
    holder,
    leaseS: HERO_LEASE_S,
  });
  if (Array.isArray(applied?.leases)) return "lease";
  // A pre-lease agent applied a plain set, which was a no-op on a drone
  // already on hero, so only a promotion from thumbnail is ours to undo.
  return observed === "thumbnail" ? "legacy" : "none";
}

function retryDelay(attempt: number): number {
  return HERO_RETRY_BACKOFF_MS[Math.min(attempt, HERO_RETRY_BACKOFF_MS.length - 1)];
}

/** Promote, retrying a failed attempt while `wanted()` holds. */
async function promote(
  client: HeroProfileClient,
  holder: string,
  wanted: () => boolean,
): Promise<Outcome> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await attemptPromote(client, holder);
    } catch (err) {
      // A 404 is an agent with no profile route: nothing to retry. Anything
      // else (a pipeline mid-restart answering 503, a dropped request, a 429
      // for this tab's request budget) is transient, and giving up on it left
      // the drone on thumbnail for as long as the view stayed open.
      if (err instanceof AgentHttpError && err.status === 404) return "none";
      const delay =
        err instanceof AgentHttpError && err.status === 429
          ? retryDelay(attempt)
          : HERO_PROMOTE_RETRY_MS;
      const backoff = Promise.withResolvers<void>();
      setTimeout(backoff.resolve, delay);
      await backoff.promise;
      if (!wanted()) return "none";
    }
  }
}

/** A renewal that came back holding hero under a lease. */
async function renewOnce(client: HeroProfileClient, holder: string): Promise<boolean> {
  try {
    const applied = await client.setVideoProfile("hero", { holder, leaseS: HERO_LEASE_S });
    return applied?.profile === "hero" && Array.isArray(applied.leases);
  } catch {
    return false;
  }
}

/** Promote `hold` and, once it holds a lease, keep renewing it while live. */
function startPromotion(agentUrl: string, hold: Hold, holder: string): void {
  hold.abandoned = false;
  const live = () => holds.get(agentUrl) === hold;
  const outcome = promote(hold.client, holder, () => live() && hold.count > 0).then((o) => {
    if (o === "none" && live() && hold.count === 0) hold.abandoned = true;
    return o;
  });
  hold.outcome = outcome;
  const scheduleRenew = (delay: number, failures: number) => {
    hold.renewTimer = setTimeout(() => {
      void renewOnce(hold.client, holder).then((ok) => {
        if (!live()) return;
        if (ok) scheduleRenew(HERO_RENEW_MS, 0);
        else scheduleRenew(retryDelay(failures), failures + 1);
      });
    }, delay);
  };
  void outcome.then((o) => {
    if (o === "lease" && live()) scheduleRenew(HERO_RENEW_MS, 0);
  });
}

/**
 * Take a hero hold on the agent at `agentUrl`. Returns the release; calling it
 * more than once releases once.
 */
export function acquireHeroProfile(agentUrl: string, client: HeroProfileClient): () => void {
  const holder = heroHolderId();
  let hold = holds.get(agentUrl);
  if (hold) {
    clearTimeout(hold.releaseTimer);
    hold.releaseTimer = undefined;
    hold.count += 1;
    // A promotion that stopped retrying while every surface had let go must
    // resume now one holds the drone again, or it stays on thumbnail.
    if (hold.abandoned) startPromotion(agentUrl, hold, holder);
  } else {
    const created: Hold = {
      count: 1,
      client,
      outcome: Promise.resolve("none"),
      abandoned: false,
      renewTimer: undefined,
      releaseTimer: undefined,
    };
    holds.set(agentUrl, created);
    startPromotion(agentUrl, created, holder);
    hold = created;
  }
  const held = hold;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held.count -= 1;
    if (held.count > 0) return;
    held.releaseTimer = setTimeout(() => {
      if (held.count > 0 || holds.get(agentUrl) !== held) return;
      holds.delete(agentUrl);
      clearTimeout(held.renewTimer);
      void held.outcome
        .then((outcome) => {
          if (outcome === "lease") return held.client.releaseVideoProfile(holder);
          if (outcome === "legacy") return held.client.setVideoProfile("thumbnail");
          return undefined;
        })
        .catch(() => {});
    }, HERO_RELEASE_GRACE_MS);
  };
}
