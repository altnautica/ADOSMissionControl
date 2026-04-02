import { cronJobs } from "convex/server";
import { internal, api } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "sync-changelog-from-github",
  { minutes: 15 },
  internal.changelogSync.syncFromGithub
);

crons.interval(
  "clean-expired-pairing",
  { minutes: 15 },
  api.cmdPairing.cleanExpiredRequests
);

export default crons;
