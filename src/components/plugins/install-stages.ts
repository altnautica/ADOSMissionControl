/**
 * @module install-stages
 * @description The plugin install job's stage machine, and the mapping from
 * the agent's install-job progress frames onto it.
 *
 * @license GPL-3.0-only
 */

/** The six-stage state machine plus the two terminal stages. */
export type InstallStage =
  | "uploading"
  | "queued"
  | "commanded"
  | "downloading"
  | "verifying"
  | "installing"
  | "enabling"
  | "completed"
  | "failed";

export interface InstallJobError {
  code: string;
  message: string;
}

/** Ordered list of every non-terminal stage. UI renders one dot per entry. */
export const INSTALL_STAGES: ReadonlyArray<InstallStage> = [
  "uploading",
  "queued",
  "commanded",
  "downloading",
  "verifying",
  "installing",
  "enabling",
] as const;

/** Stages that the LAN path skips (no upload, no cloud queue). */
export const LAN_SKIPPED_STAGES: ReadonlySet<InstallStage> = new Set([
  "uploading",
  "queued",
  "commanded",
  "downloading",
]);

/** True once the job cannot progress further. */
export function isTerminalStage(stage: InstallStage): boolean {
  return stage === "completed" || stage === "failed";
}

/** Index of `stage` in the canonical order. Terminal stages map past the
 * end so a completed job lights every dot. */
export function stageIndex(stage: InstallStage): number {
  if (isTerminalStage(stage)) return INSTALL_STAGES.length;
  const idx = INSTALL_STAGES.indexOf(stage);
  return idx < 0 ? 0 : idx;
}

/** Human-readable label for the in-progress banner copy. */
export function humanStage(stage: InstallStage): string {
  switch (stage) {
    case "uploading": return "Uploading archive";
    case "queued": return "Queued for agent";
    case "commanded": return "Agent acknowledged";
    case "downloading": return "Agent downloading";
    case "verifying": return "Verifying signature";
    case "installing": return "Installing";
    case "enabling": return "Enabling";
    case "completed": return "Completed";
    case "failed": return "Failed";
  }
}

const AGENT_STAGES: ReadonlySet<string> = new Set<InstallStage>([
  "downloading",
  "verifying",
  "installing",
  "enabling",
  "completed",
  "failed",
]);

/** One stage transition read off the agent's install-job stream. */
export interface AgentJobUpdate {
  stage: InstallStage;
  error?: InstallJobError;
}

/**
 * Map one agent install-job progress frame onto the stage machine, or null
 * when the frame carries no stage this UI knows.
 *
 * The agent writes `{stage}` per transition, `{stage: "failed", detail}` on
 * a refusal, and ends an idle stream with `{stage: "cancelled", reason}`.
 * A cancelled stream means the job stopped reporting, which the operator
 * must see as a failure rather than an install still in progress.
 */
export function parseAgentJobFrame(raw: unknown): AgentJobUpdate | null {
  if (typeof raw !== "object" || raw === null) return null;
  const frame = raw as Record<string, unknown>;
  const text = (v: unknown): string | undefined =>
    typeof v === "string" && v.length > 0 ? v : undefined;
  if (frame.stage === "cancelled") {
    const reason = text(frame.reason) ?? "cancelled";
    return {
      stage: "failed",
      error: {
        code: reason,
        message: "The agent stopped reporting progress for this install.",
      },
    };
  }
  if (typeof frame.stage !== "string" || !AGENT_STAGES.has(frame.stage)) {
    return null;
  }
  const stage = frame.stage as InstallStage;
  if (stage !== "failed") return { stage };
  return {
    stage,
    error: {
      code: "install_failed",
      message: text(frame.detail) ?? "The agent refused the install.",
    },
  };
}
