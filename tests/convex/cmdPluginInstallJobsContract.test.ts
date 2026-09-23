/**
 * Contract tests for the cloud-relay plugin install job state machine.
 *
 * The job carries the install request through:
 *
 *   queued → commanded → downloading → verifying → installing → completed
 *
 * with `failed` and `cancelled` as terminal off-ramps from any stage.
 *
 * These tests pin:
 *   - the createJob / cancelJob contract (asserted against the source
 *     text, since those need a Convex runtime)
 *   - how a `plugin.install` command ACK settles its job (executed
 *     against an in-memory db)
 *   - the schema table shape mirrors the mutation surface
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { cancelInstallJob, settleInstallJobFromAck } from "../../convex/cmdPluginInstallJobs";

const MUTATION_PATH = path.join(process.cwd(), "convex/cmdPluginInstallJobs.ts");
const SCHEMA_PATH = path.join(process.cwd(), "convex/schema.ts");

const EXPECTED_STAGES = [
  "queued",
  "commanded",
  "downloading",
  "verifying",
  "installing",
  "completed",
  "failed",
  "cancelled",
] as const;

describe("createJob mutation contract", () => {
  it("requires deviceId, archiveId, and requestedPermissions", async () => {
    const text = await readFile(MUTATION_PATH, "utf8");
    // Find the createJob args block.
    const exportIdx = text.indexOf("export const createJob");
    expect(exportIdx).toBeGreaterThan(-1);
    const argsBlock = text.slice(exportIdx, exportIdx + 800);
    expect(argsBlock).toContain("deviceId: v.string()");
    expect(argsBlock).toContain('archiveId: v.id("plugin_archives")');
    expect(argsBlock).toContain("requestedPermissions: v.array(v.string())");
  });

  it("enforces ownership of both the drone and the archive", async () => {
    const text = await readFile(MUTATION_PATH, "utf8");
    expect(text).toContain("requireOwnedDroneByDeviceId(ctx, args.deviceId)");
    // The archive must belong to the same caller (userId === userId);
    // a missing archive throws "Archive not found".
    expect(text).toContain('throw new Error("Archive not found")');
  });

  it("auto-includes required permissions and refuses undeclared ones", async () => {
    const text = await readFile(MUTATION_PATH, "utf8");
    // Permission scope guard.
    expect(text).toContain(
      "was not declared in the manifest",
    );
    // Required permissions are folded into the effective set.
    expect(text).toContain(".filter((p) => p.required)");
  });

  it("transitions the job from queued to commanded after enqueue", async () => {
    const text = await readFile(MUTATION_PATH, "utf8");
    // Initial insert uses "queued"...
    expect(text).toContain('stage: "queued"');
    // ...and is patched to "commanded" once cmd_droneCommands row exists.
    expect(text).toContain('stage: "commanded"');
    expect(text).toContain('ctx.db.insert(\n      "plugin_install_jobs"');
    expect(text).toContain('ctx.db.insert(\n      "cmd_droneCommands"');
  });

  it("enforces a 5-minute hard ceiling on the signed download URL", async () => {
    const text = await readFile(MUTATION_PATH, "utf8");
    expect(text).toContain("SIGNED_URL_TTL_MS = 5 * 60 * 1000");
    expect(text).toContain("const signedUrlExpiresAt = now + SIGNED_URL_TTL_MS");
  });
});

describe("settleInstallJobFromAck (agent-facing)", () => {
  type Row = Record<string, unknown> & { _id: string };

  // In-memory stand-in for the mutation db: ids are "<table>:<n>", so
  // normalizeId resolves an id only for the table it belongs to.
  function fakeDb(rows: Row[]) {
    const byId = new Map(rows.map((r) => [r._id, { ...r }]));
    const db = {
      normalizeId: (table: string, id: string) => (id.startsWith(`${table}:`) ? id : null),
      get: async (id: string) => byId.get(id) ?? null,
      patch: async (id: string, patch: Record<string, unknown>) => {
        const row = byId.get(id);
        if (!row) throw new Error("missing row");
        Object.assign(row, patch);
      },
    };
    return { ctx: { db } as never, row: (id: string) => byId.get(id) };
  }

  const JOB = "plugin_install_jobs:1";
  const CMD = "cmd_droneCommands:1";
  const job = (stage: string, cmdId = CMD): Row => ({ _id: JOB, stage, cmdId, attempts: 0 });
  const command = (overrides: Record<string, unknown> = {}) =>
    ({ _id: CMD, command: "plugin.install", args: { jobId: JOB }, ...overrides }) as never;

  it("completes the linked job on a completed ack, recording an install row id", async () => {
    const { ctx, row } = fakeDb([job("commanded")]);
    await settleInstallJobFromAck(ctx, command(), {
      status: "completed",
      result: { success: true, message: "installed" },
      data: { installId: "cmd_pluginInstalls:7" },
    });
    expect(row(JOB)).toMatchObject({ stage: "completed", installId: "cmd_pluginInstalls:7" });
  });

  it("completes without an installId when the ack names no install row", async () => {
    const { ctx, row } = fakeDb([job("commanded")]);
    await settleInstallJobFromAck(ctx, command(), {
      status: "completed",
      data: { installId: JOB },
    });
    expect(row(JOB)?.stage).toBe("completed");
    expect(row(JOB)?.installId).toBeUndefined();
  });

  it("fails the linked job with the agent's code and message", async () => {
    const { ctx, row } = fakeDb([job("commanded")]);
    await settleInstallJobFromAck(ctx, command(), {
      status: "failed",
      result: { success: false, message: "download failed: host not allowed" },
      data: { code: "download_failed" },
    });
    expect(row(JOB)).toMatchObject({
      stage: "failed",
      error: { code: "download_failed", message: "download failed: host not allowed" },
    });
  });

  it("leaves a cancelled job cancelled", async () => {
    const { ctx, row } = fakeDb([job("cancelled")]);
    await settleInstallJobFromAck(ctx, command(), { status: "completed" });
    expect(row(JOB)?.stage).toBe("cancelled");
  });

  it("does not move a job linked to a different command", async () => {
    const { ctx, row } = fakeDb([job("commanded", "cmd_droneCommands:2")]);
    await settleInstallJobFromAck(ctx, command(), { status: "completed" });
    expect(row(JOB)?.stage).toBe("commanded");
  });

  it("ignores other commands and a jobId that is not a job", async () => {
    const { ctx, row } = fakeDb([job("commanded")]);
    await settleInstallJobFromAck(ctx, command({ command: "plugin.enable" }), { status: "completed" });
    await settleInstallJobFromAck(ctx, command({ args: { jobId: "cmd_droneCommands:1" } }), {
      status: "completed",
    });
    expect(row(JOB)?.stage).toBe("commanded");
  });
});

describe("cancelInstallJob", () => {
  type Row = Record<string, unknown> & { _id: string };
  function fakeDb(rows: Row[]) {
    const byId = new Map(rows.map((r) => [r._id, { ...r }]));
    const db = {
      get: async (id: string) => byId.get(id) ?? null,
      patch: async (id: string, patch: Record<string, unknown>) => {
        const row = byId.get(id);
        if (!row) throw new Error("missing row");
        Object.assign(row, patch);
      },
    };
    return { ctx: { db } as never, row: (id: string) => byId.get(id) };
  }
  const JOB = "plugin_install_jobs:1";
  const CMD = "cmd_droneCommands:1";
  const job = (stage: string): Row => ({ _id: JOB, userId: "u1", stage, cmdId: CMD });
  const cmd = (overrides: Record<string, unknown> = {}): Row => ({
    _id: CMD,
    command: "plugin.install",
    status: "pending",
    ...overrides,
  });

  it("fails the still-queued install command so the agent never receives it", async () => {
    const { ctx, row } = fakeDb([job("commanded"), cmd()]);
    await cancelInstallJob(ctx, "u1", JOB as never);
    expect(row(JOB)?.stage).toBe("cancelled");
    expect(row(CMD)).toMatchObject({
      status: "failed",
      result: { success: false, message: "cancelled by operator" },
    });
  });

  it("refuses once the agent has taken the command", async () => {
    const { ctx, row } = fakeDb([job("commanded"), cmd({ status: "delivering", deliveredAt: 1 })]);
    await expect(cancelInstallJob(ctx, "u1", JOB as never)).rejects.toThrow(/already received/);
    expect(row(JOB)?.stage).toBe("commanded");
    expect(row(CMD)?.status).toBe("delivering");
  });

  it("refuses a job already installing and leaves terminal jobs alone", async () => {
    const installing = fakeDb([job("installing"), cmd()]);
    await expect(cancelInstallJob(installing.ctx, "u1", JOB as never)).rejects.toThrow(
      /remove the plugin/,
    );
    const done = fakeDb([job("completed"), cmd({ status: "completed" })]);
    await cancelInstallJob(done.ctx, "u1", JOB as never);
    expect(done.row(JOB)?.stage).toBe("completed");
  });

  it("hides another user's job", async () => {
    const { ctx } = fakeDb([job("commanded"), cmd()]);
    await expect(cancelInstallJob(ctx, "u2", JOB as never)).rejects.toThrow("Job not found");
  });
});

describe("plugin_install_jobs schema parity", () => {
  it("declares deviceId on the table so per-drone install lookup is possible", async () => {
    const text = await readFile(SCHEMA_PATH, "utf8");
    // Every plugin install job MUST carry the target drone's deviceId so
    // per-drone install lookups resolve to the right node. This test pins
    // the presence of that field on the table.
    const tableMatch = text.match(
      /plugin_install_jobs: defineTable\(\{([\s\S]*?)\}\)/,
    );
    expect(tableMatch).toBeTruthy();
    const tableBody = tableMatch ? tableMatch[1] : "";
    expect(tableBody).toContain("deviceId: v.string()");
  });

  it("indexes by deviceId+stage so the GCS can scan one drone's queue", async () => {
    const text = await readFile(SCHEMA_PATH, "utf8");
    expect(text).toContain(
      '.index("by_device_stage", ["deviceId", "stage"])',
    );
  });

  it("snapshots the full plugin_install_jobs field set", async () => {
    const text = await readFile(SCHEMA_PATH, "utf8");
    const tableStart = text.indexOf("plugin_install_jobs: defineTable({");
    expect(tableStart).toBeGreaterThan(-1);
    // Walk to the matching close brace at depth 0 starting from the
    // open paren of `defineTable(`.
    const openParen = text.indexOf("(", tableStart);
    let depth = 0;
    let close = -1;
    for (let i = openParen; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === "(" || ch === "{") depth += 1;
      else if (ch === ")" || ch === "}") {
        depth -= 1;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    expect(close).toBeGreaterThan(-1);
    const tableBody = text.slice(openParen, close + 1);
    // Top-level fields are exactly the lines that, after comment strip
    // and whitespace trim, match `<name>: v.something`. Nested fields
    // inside v.object({...}) (`code`, `message`) are excluded because
    // they live one indent deeper than the top-level entries.
    const topLevelFields: string[] = [];
    for (const rawLine of tableBody.split("\n")) {
      const slash = rawLine.indexOf("//");
      const noComment = slash >= 0 ? rawLine.slice(0, slash) : rawLine;
      // Top-level fields are indented by 4 spaces inside defineTable({.
      const m = noComment.match(/^ {4}([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*v\./);
      if (m) topLevelFields.push(m[1]);
    }
    expect(Array.from(new Set(topLevelFields)).sort()).toMatchInlineSnapshot(`
      [
        "archiveId",
        "attempts",
        "cmdId",
        "createdAt",
        "deviceId",
        "error",
        "installId",
        "operatorId",
        "pluginId",
        "requestedPermissions",
        "stage",
        "updatedAt",
        "userId",
        "version",
      ]
    `);
  });
});
