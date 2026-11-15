/**
 * @module mock/mock-pilot-stall
 * @description The demo pilot's mission stall. A demo scenario pins one
 * through `window.__adosDemoPilot.pin`, as the agent sends it:
 *
 *   pin({ mission_stall: { kind: "mission", seq: 3, wp_label: "3", since_ms: Date.now(),
 *         skip_in_s: 45, window_s: 15 }, hold_reason: "mission-stalled" })
 *
 * `skip_in_s: null` holds for the operator; `kind: "return"` (seq and label
 * null, hold reason `return-blocked`) is a blocked return. A countdown runs
 * down from the pin, and at zero the pilot acts on its own as the real one
 * does: a mission stall skips the waypoint, a blocked return lands. The
 * operator's `mission_skip`, `rth` or `land` ends the stall the same way; a
 * skip records the waypoint in `mission.gaps` and shows the skipped banner.
 * @license GPL-3.0-only
 */

import type { Json } from "./mock-pilot-wire";

/** How long the skipped-waypoint banner stays on the wire. */
const SKIPPED_BANNER_MS = 3000;

/** The action the pilot takes on its own when a stall's countdown ends. */
export type StallTimeout = "mission_skip" | "land";

function stallOf(seen: Json): Json | null {
  const s = seen.mission_stall;
  return typeof s === "object" && s !== null ? (s as Json) : null;
}

export class DemoStall {
  /** Epoch ms the pinned stall's countdown ends; null with none or no countdown. */
  private deadlineMs: number | null = null;
  private gaps: Json[] = [];
  private skippedBanner: { banner: Json; untilMs: number } | null = null;

  reset(): void {
    this.deadlineMs = null;
    this.gaps = [];
    this.skippedBanner = null;
  }

  /** A new set of pins: a pinned stall with a countdown starts its clock. */
  pinned(fields: Json, now: number): void {
    const stall = stallOf(fields);
    const inS = stall?.skip_in_s;
    this.deadlineMs = typeof inS === "number" ? now + inS * 1000 : null;
  }

  /** The automatic action due on the stall `seen` shows, or null. */
  due(seen: Json, now: number): StallTimeout | null {
    const stall = stallOf(seen);
    if (!stall || this.deadlineMs === null || now < this.deadlineMs) return null;
    return stall.kind === "return" ? "land" : "mission_skip";
  }

  /** The stall ends by `action`: a skip records its waypoint as a gap and
   *  announces it. Returns false when no stall is up (nothing to skip). */
  resolve(seen: Json, action: string, now: number): boolean {
    const stall = stallOf(seen);
    const timedOut = this.deadlineMs !== null && now >= this.deadlineMs;
    this.deadlineMs = null;
    if (!stall) return false;
    if (action === "mission_skip" && stall.kind === "mission" && typeof stall.seq === "number") {
      const reason = timedOut ? "stall_timeout" : "stall_operator";
      this.gaps.push({ seq: stall.seq, reason, at_ms: now });
      this.skippedBanner = {
        banner: {
          text_key: "pilot.banner.mission_wp_skipped",
          args: { wp: stall.wp_label ?? String(stall.seq) },
          until_ms: now + SKIPPED_BANNER_MS,
        },
        untilMs: now + SKIPPED_BANNER_MS,
      };
    }
    return true;
  }

  /** The wire as the operator sees it: the countdown run down from the pin,
   *  the skipped waypoints on the mission, the skipped banner while it lasts. */
  view(seen: Json, now: number): Json {
    const out: Json = { ...seen };
    const stall = stallOf(seen);
    if (stall && this.deadlineMs !== null) {
      out.mission_stall = { ...stall, skip_in_s: Math.max(0, (this.deadlineMs - now) / 1000) };
    }
    const mission = seen.mission;
    if (this.gaps.length > 0 && typeof mission === "object" && mission !== null) {
      out.mission = { ...(mission as Json), gaps: this.gaps.slice() };
    }
    if (this.skippedBanner && now >= this.skippedBanner.untilMs) this.skippedBanner = null;
    if (this.skippedBanner && !seen.banner) out.banner = this.skippedBanner.banner;
    return out;
  }
}
