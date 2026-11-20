/**
 * @module httpShared
 * @description The agent-facing HTTP routes every deployment serves.
 *
 * Each deployment's `http.ts` builds its router, adds the auth routes and its
 * own routes, and calls {@link registerSharedRoutes}. Keeping the shared
 * routes in this one file means the two deployments cannot drift on a route
 * an agent calls: the file is copied byte for byte.
 *
 * @license GPL-3.0-only
 */

import type { HttpRouter } from "convex/server";
import type { ObjectType } from "convex/values";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { pushStatusArgs } from "./lib/pushStatusArgs";
import { agentKeyMatches, constantTimeEqual } from "./lib/credentials";
import { sourceBucketKey } from "./lib/rateLimit";
import { buildStatusPayload, readJsonObject } from "./lib/agentStatusPayload";
import { jsonHeaders, numberField, stringField } from "./lib/heartbeatPrimitives";
import { commandResultField, commandStatusField } from "./lib/heartbeatStatusFields";
import { resolvePluginRecordPost } from "./lib/pluginRecordsIngest";

export function registerSharedRoutes(http: HttpRouter): void {
  // ── ADOS Pairing: agent registers its pairing code ──────────

  http.route({
    path: "/pairing/register",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      const body = await readJsonObject(request);
      if (body instanceof Response) return body;
      const deviceId = stringField(body, "deviceId");
      const pairingCode = stringField(body, "pairingCode");
      const apiKey = stringField(body, "apiKey");

      // apiKey is required, not optional. It is the value the paired-device
      // binding in `registerAgent` anchors to, and a blank one persisted a row
      // that could never be authenticated.
      if (!deviceId || !pairingCode || !apiKey) {
        return new Response(
          JSON.stringify({ error: "deviceId, pairingCode and apiKey required" }),
          { status: 400, headers: jsonHeaders }
        );
      }

      const result = await ctx.runMutation(internal.cmdPairingAgent.registerAgent, {
        clientKey: await sourceBucketKey(request),
        deviceId,
        pairingCode,
        apiKey,
        name: stringField(body, "name"),
        version: stringField(body, "version"),
        board: stringField(body, "board"),
        tier: numberField(body, "tier"),
        os: stringField(body, "os"),
        mdnsHost: stringField(body, "mdnsHost"),
        localIp: stringField(body, "localIp"),
        pairingCodeExpiresAt: numberField(body, "pairingCodeExpiresAt"),
      });

      // A lockout is a distinct, temporary, actionable condition. Reporting it
      // as a generic failure would leave an operator unable to tell a throttled
      // beacon from a broken backend, which is the same indistinguishable
      // failure the limiter exists to remove. The mutation returns the refusal
      // (rather than throwing) so the recorded attempt commits.
      if ("retryAfterMs" in result) {
        return new Response(JSON.stringify({ error: "rate_limited" }), {
          status: 429,
          headers: {
            ...jsonHeaders,
            "Retry-After": String(Math.ceil(result.retryAfterMs / 1000)),
          },
        });
      }

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: jsonHeaders,
      });
    }),
  });

  // ── Broker auth sync: mosquitto passwd + ACL regeneration ───
  //
  // The self-host counterpart to the production deployment's route of the same
  // name. Its absence here was invisible to both twin gates -- they compare only
  // functions present in BOTH trees, so a one-sided ABSENCE reads as agreement --
  // and it meant `tools/mqtt-bridge/deploy/scripts/regenerate-passwd.sh` shipped
  // in this repo pointing at an endpoint this repo's own deployment did not
  // serve. Device MQTT auth and operator write grants were therefore dead on
  // every self-host: the script 404s, the passwd file never regenerates, and the
  // broker silently refuses every device.
  http.route({
    path: "/admin/mqtt-auth-entries",
    method: "GET",
    handler: httpAction(async (ctx, request) => {
      const expected = process.env.MQTT_AUTH_RELAY_SECRET;
      if (!expected) {
        return new Response(
          JSON.stringify({ error: "MQTT_AUTH_RELAY_SECRET not configured" }),
          { status: 503, headers: jsonHeaders }
        );
      }
      const header = request.headers.get("Authorization") ?? "";
      const presented = header.startsWith("Bearer ")
        ? header.slice("Bearer ".length)
        : "";
      // Constant-time: this route returns every paired drone's username and API
      // key, so a plain `!==` that returns at the first differing byte is a
      // timing oracle on the one secret guarding the whole set.
      if (!presented || !constantTimeEqual(presented, expected)) {
        return new Response(
          JSON.stringify({ error: "unauthorized" }),
          { status: 401, headers: jsonHeaders }
        );
      }
      // The query returns `{ entries, grants, truncated }`. Spread rather than
      // re-wrap: wrapping would nest it as `{ entries: { entries, ... } }` and
      // the regeneration script reads `.entries[]` directly.
      const payload = await ctx.runQuery(
        internal.cmdPairingAgent.listMqttAuthEntries,
        {},
      );
      return new Response(
        JSON.stringify(payload),
        { status: 200, headers: jsonHeaders }
      );
    }),
  });

  // ── Cloud Relay: agent pushes full status ──────────────────
  //
  // Every key `pushStatus` declares is forwarded once it passes its coercer or
  // its declared scalar type (lib/agentStatusPayload). Undeclared root keys are
  // dropped and named back to the agent as `unknownFields`, so its own log says
  // which field this deployment is too old to store.

  http.route({
    path: "/agent/status",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      const body = await readJsonObject(request);
      if (body instanceof Response) return body;
      const deviceId = stringField(body, "deviceId");
      const version = stringField(body, "version");
      const uptimeSeconds = numberField(body, "uptimeSeconds");
      // The device key travels only in the X-ADOS-Key header.
      const apiKey = request.headers.get("X-ADOS-Key") ?? undefined;

      if (!deviceId || !apiKey || !version || uptimeSeconds === undefined) {
        return new Response(
          JSON.stringify({ error: "deviceId, apiKey, version, and uptimeSeconds required" }),
          { status: 400, headers: jsonHeaders }
        );
      }

      // Validate API key matches the paired drone
      const drone = await ctx.runQuery(internal.cmdDrones.getDroneByDeviceId, { deviceId });
      if (!drone || !agentKeyMatches(drone.apiKey, apiKey)) {
        return new Response(
          JSON.stringify({ error: "Invalid device or API key" }),
          { status: 401, headers: jsonHeaders }
        );
      }

      const { payload, unknownFields } = buildStatusPayload(body);
      // A payload the validator still rejects degrades to a 400 with a stable
      // code, not an unhandled 500: the 500 path stops `lastSeen` advancing, so
      // the node reads OFFLINE with no cause visible in the UI.
      let result: unknown;
      try {
        // buildStatusPayload keeps only declared keys whose values passed their
        // coercer or declared type, and the required identity fields were
        // checked above; the validator re-checks the rest at the boundary.
        result = await ctx.runMutation(
          internal.cmdDroneStatus.pushStatus,
          payload as unknown as ObjectType<typeof pushStatusArgs>,
        );
      } catch (err) {
        console.error("[/agent/status] pushStatus rejected the payload", err);
        return new Response(
          JSON.stringify({ error: "invalid_status_payload" }),
          { status: 400, headers: jsonHeaders },
        );
      }
      const responseBody =
        unknownFields.length > 0
          ? { ...(result as Record<string, unknown>), unknownFields }
          : result;
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: jsonHeaders,
      });
    }),
  });

  // ── Cloud Relay: a plugin's agent half files a plugin-owned record ─────
  //
  // The node forwards a record its plugin wrote through the `cloud.records`
  // host method. Poster auth, subject ownership and field bounds live in
  // lib/pluginRecordsIngest; the plugin's install grant on the posting node and
  // the per-plugin record cap are checked in the write transaction.

  http.route({
    path: "/agent/plugin-records",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      const body = await readJsonObject(request);
      if (body instanceof Response) return body;
      const post = await resolvePluginRecordPost(
        body,
        request.headers.get("X-ADOS-Key") ?? undefined,
        (deviceId) => ctx.runQuery(internal.cmdDrones.getDroneByDeviceId, { deviceId }),
      );
      if (post instanceof Response) return post;
      const outcome = await ctx.runMutation(internal.pluginRecords.ingestFromAgent, post);
      if (outcome === "not_permitted") {
        return new Response(
          JSON.stringify({ error: "plugin has no enabled install with cloud.records on this node" }),
          { status: 403, headers: jsonHeaders },
        );
      }
      if (outcome === "limit_reached") {
        return new Response(JSON.stringify({ error: "plugin record limit reached" }), {
          status: 409,
          headers: jsonHeaders,
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: jsonHeaders,
      });
    }),
  });

  // ── Cloud Relay: agent polls for pending commands ──────────
  //
  // The poll leases the rows the agent may still run (cmdDroneCommands.
  // claimCommands): a leased row is not handed out again while its lease holds,
  // a row past its delivery window is failed instead, and the agent executes and
  // acks each.

  http.route({
    path: "/agent/commands",
    method: "GET",
    handler: httpAction(async (ctx, request) => {
      const url = new URL(request.url);
      const deviceId = url.searchParams.get("deviceId");
      const apiKey = request.headers.get("X-ADOS-Key") ?? undefined;

      if (!deviceId || !apiKey) {
        return new Response(
          JSON.stringify({ error: "deviceId and apiKey required" }),
          { status: 400, headers: jsonHeaders }
        );
      }

      // Validate API key
      const drone = await ctx.runQuery(internal.cmdDrones.getDroneByDeviceId, { deviceId });
      if (!drone || !agentKeyMatches(drone.apiKey, apiKey)) {
        return new Response(
          JSON.stringify({ error: "Invalid device or API key" }),
          { status: 401, headers: jsonHeaders }
        );
      }

      const commands = await ctx.runMutation(internal.cmdDroneCommands.claimCommands, { deviceId });
      return new Response(JSON.stringify({ commands }), {
        status: 200,
        headers: jsonHeaders,
      });
    }),
  });

  // ── Cloud Relay: agent acknowledges command completion ─────

  http.route({
    path: "/agent/commands/ack",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      const body = await readJsonObject(request);
      if (body instanceof Response) return body;
      const commandId = stringField(body, "commandId");
      const deviceId = stringField(body, "deviceId");
      const status = stringField(body, "status");
      const result = commandResultField(body.result);
      const { data } = body;
      const apiKey = request.headers.get("X-ADOS-Key") ?? undefined;

      if (!commandId || !deviceId || !apiKey) {
        return new Response(
          JSON.stringify({ error: "commandId, deviceId, and apiKey required" }),
          { status: 400, headers: jsonHeaders }
        );
      }

      // Validate API key
      const drone = await ctx.runQuery(internal.cmdDrones.getDroneByDeviceId, { deviceId });
      if (!drone || !agentKeyMatches(drone.apiKey, apiKey)) {
        return new Response(
          JSON.stringify({ error: "Invalid device or API key" }),
          { status: 401, headers: jsonHeaders }
        );
      }

      // Only a terminal verdict the agent actually stated is recorded; a missing
      // or unknown status is refused rather than read as success.
      const ackStatus = commandStatusField(status);
      if (!ackStatus) {
        return new Response(
          JSON.stringify({ error: "status must be completed or failed" }),
          { status: 400, headers: jsonHeaders }
        );
      }

      const ackResult = await ctx.runMutation(internal.cmdDroneCommands.ackCommand, {
        commandId: commandId as Id<"cmd_droneCommands">,
        deviceId,
        status: ackStatus,
        result,
        data,
      });
      // A row that is gone (or another device's) is a 404, never a 500: the
      // agent drops that ack instead of resending it on every poll.
      return new Response(JSON.stringify(ackResult), {
        status: "notFound" in ackResult && ackResult.notFound ? 404 : 200,
        headers: jsonHeaders,
      });
    }),
  });

  // ── Explicit log-window export: agent uploads one chosen window ──
  // One authenticated binary POST. Window metadata travels as headers;
  // the body is the raw exported-window blob. Auth mirrors /agent/status
  // (device API key in X-ADOS-Key, validated against the paired drone).
  // The server recomputes the content hash from the stored bytes inside
  // ingestWindow — the agent never sends a hash claim used for storage.

  http.route({
    path: "/agent/logd/window",
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      const apiKey = request.headers.get("X-ADOS-Key") ?? undefined;
      const h = request.headers;
      const deviceId = h.get("X-ADOS-Device") ?? undefined;
      const sessionId = h.get("X-ADOS-Session") ?? "";
      const kind = h.get("X-ADOS-Kind") ?? undefined;
      const format = h.get("X-ADOS-Format") ?? undefined;
      const windowStartUs = Number(h.get("X-ADOS-Window-Start-Us"));
      const windowEndUs = Number(h.get("X-ADOS-Window-End-Us"));
      const rowCount = Number(h.get("X-ADOS-Row-Count"));

      if (
        !deviceId
        || !apiKey
        || !kind
        || !format
        || !Number.isFinite(windowStartUs)
        || !Number.isFinite(windowEndUs)
        || !Number.isFinite(rowCount)
      ) {
        return new Response(
          JSON.stringify({ error: "missing window metadata" }),
          { status: 400, headers: jsonHeaders }
        );
      }

      // Validate API key matches the paired drone
      const drone = await ctx.runQuery(internal.cmdDrones.getDroneByDeviceId, { deviceId });
      if (!drone || !agentKeyMatches(drone.apiKey, apiKey)) {
        return new Response(
          JSON.stringify({ error: "Invalid device or API key" }),
          { status: 401, headers: jsonHeaders }
        );
      }

      const blob = await request.blob();
      const MAX_WINDOW_BYTES = 32 * 1024 * 1024;
      if (blob.size === 0 || blob.size > MAX_WINDOW_BYTES) {
        return new Response(
          JSON.stringify({ error: "window too large or empty" }),
          { status: 413, headers: jsonHeaders }
        );
      }

      const storageId = await ctx.storage.store(blob);
      try {
        const result = await ctx.runAction(internal.cmdLogdWindows.ingestWindow, {
          deviceId,
          sessionId,
          kind,
          windowStartUs,
          windowEndUs,
          format,
          rowCount,
          storageId,
        });
        return new Response(
          JSON.stringify({
            status: result.status,
            windowId: result.windowId,
            contentHash: result.contentHash,
          }),
          { status: 200, headers: jsonHeaders }
        );
      } catch (err) {
        // ingestWindow deletes the blob on every validation failure, so a
        // rejected upload never orphans storage. Surface a 400 with the
        // kernel message for the operator.
        const message = err instanceof Error ? err.message : "ingest failed";
        return new Response(
          JSON.stringify({ error: message }),
          { status: 400, headers: jsonHeaders }
        );
      }
    }),
  });
}
