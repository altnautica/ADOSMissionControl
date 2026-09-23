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
// only rows past its retention window via a bounded indexed range, and
// reschedules itself at once while a batch comes back full, so a backlog
// drains in one pass rather than one batch per tick.
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

// A command the node never picked up is expired hourly rather than left
// `pending` forever: the relay vocabulary includes non-idempotent actions, so a
// stale queued command is a surprise waiting for the node to come back, not
// just a row. Expiry stamps it terminal, which hands it to the sweep above.
crons.interval(
  "expire-stuck-commands",
  { hours: 1 },
  internal.cmdDroneCommands.expireStuckCommands
);

// The two append-only event tables. Both are written at machine cadence
// (plugin lifecycle; one row per MCP tool call) and neither had a sweep, so
// they grew for the lifetime of the deployment. 30-day retention, daily.
crons.interval(
  "prune-old-plugin-events",
  { hours: 24 },
  internal.cmdPlugins.pruneOldEvents
);

crons.interval(
  "prune-old-mcp-audit-events",
  { hours: 24 },
  internal.cmdMcpTokens.pruneOldAuditEvents
);

// Every browser session mints a broker grant per hour; expired rows are swept
// once past their review window.
crons.interval(
  "prune-expired-mqtt-control-grants",
  { hours: 6 },
  internal.cmdMqttControlGrants.pruneExpiredGrants
);

// One usage row per AI call; rows past every weekly quota window are dead.
crons.interval(
  "prune-old-ai-usage",
  { hours: 24 },
  internal.cmdAiUsage.pruneOldUsage
);

export default crons;
