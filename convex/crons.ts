import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "sync-changelog-from-github",
  { minutes: 15 },
  internal.changelogSync.syncFromGithub
);

// Cron-only (internal): the sweep walks the by_expiresAt index. A public
// no-auth mutation here would let any client trigger the table scan on demand.
crons.interval(
  "clean-expired-pairing",
  { minutes: 15 },
  internal.cmdPairing.cleanExpiredRequests
);

// Rate-limit buckets and anonymous browser sessions are both written by
// unauthenticated callers, so both grow without a sweep. Settled buckets only:
// the mutation re-checks `lockedUntil` per row, because deleting a bucket that
// is still locked would hand an attacker a free reset.
crons.interval(
  "clean-expired-security-state",
  { minutes: 30 },
  internal.cmdPairing.cleanExpiredSecurityState
);

// Retention: terminal cloud-relay command rows and exported log windows are
// append-mostly tables that otherwise grow without bound. Each sweep deletes
// only rows past its retention window via a bounded indexed range, so the
// hourly tick stays cheap and a backlog drains over successive ticks.
crons.interval(
  "prune-terminal-commands",
  { hours: 1 },
  internal.cmdDroneCommands.pruneTerminalCommands
);

crons.interval(
  "prune-old-logd-windows",
  { hours: 6 },
  internal.cmdLogdWindows.pruneOldWindows
);

export default crons;
