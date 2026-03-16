import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";

const http = httpRouter();
auth.addHttpRoutes(http);

const jsonHeaders = { "Content-Type": "application/json" };

// ── ADOS Pairing: agent registers its pairing code ──────────

http.route({
  path: "/pairing/register",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json();
    const {
      deviceId,
      pairingCode,
      apiKey,
      name,
      version,
      board,
      tier,
      os,
      mdnsHost,
      localIp,
    } = body;

    if (!deviceId || !pairingCode) {
      return new Response(
        JSON.stringify({ error: "deviceId and pairingCode required" }),
        { status: 400, headers: jsonHeaders }
      );
    }

    const result = await ctx.runMutation(api.cmdPairing.registerAgent, {
      deviceId,
      pairingCode,
      apiKey,
      name,
      version,
      board,
      tier,
      os,
      mdnsHost,
      localIp,
    });

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: jsonHeaders,
    });
  }),
});

// ── ADOS Pairing: agent polls for claim status ──────────────

http.route({
  path: "/pairing/status",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const deviceId = url.searchParams.get("deviceId");
    if (!deviceId) {
      return new Response(
        JSON.stringify({ error: "deviceId required" }),
        { status: 400, headers: jsonHeaders }
      );
    }

    const status = await ctx.runQuery(api.cmdPairing.getPairingStatus, {
      deviceId,
    });
    return new Response(JSON.stringify(status), {
      status: 200,
      headers: jsonHeaders,
    });
  }),
});

// ── ADOS Heartbeat: agent sends periodic status ─────────────

http.route({
  path: "/heartbeat",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json();
    const result = await ctx.runMutation(api.cmdDrones.updateHeartbeat, body);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: jsonHeaders,
    });
  }),
});

// ── Cloud Relay: agent pushes full status ──────────────────

http.route({
  path: "/agent/status",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json();
    const { deviceId, apiKey } = body;

    if (!deviceId || !apiKey) {
      return new Response(
        JSON.stringify({ error: "deviceId and apiKey required" }),
        { status: 400, headers: jsonHeaders }
      );
    }

    // Validate API key matches the paired drone
    const drone = await ctx.runQuery(api.cmdDrones.getDroneByDeviceId, { deviceId });
    if (!drone || drone.apiKey !== apiKey) {
      return new Response(
        JSON.stringify({ error: "Invalid device or API key" }),
        { status: 401, headers: jsonHeaders }
      );
    }

    // Strip auth fields and sanitize before passing to mutation
    // Agent sends apiKey + agentVersion (not in schema) and temperature: null
    // (v.float64() rejects null — must be absent or a number)
    const { apiKey: _ak, agentVersion: _av, ...statusPayload } = body;
    if (statusPayload.temperature === null || statusPayload.temperature === undefined) {
      delete statusPayload.temperature;
    }
    const result = await ctx.runMutation(api.cmdDroneStatus.pushStatus, statusPayload);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: jsonHeaders,
    });
  }),
});

// ── Cloud Relay: agent polls for pending commands ──────────

http.route({
  path: "/agent/commands",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const deviceId = url.searchParams.get("deviceId");
    const apiKey = url.searchParams.get("apiKey");

    if (!deviceId || !apiKey) {
      return new Response(
        JSON.stringify({ error: "deviceId and apiKey required" }),
        { status: 400, headers: jsonHeaders }
      );
    }

    // Validate API key
    const drone = await ctx.runQuery(api.cmdDrones.getDroneByDeviceId, { deviceId });
    if (!drone || drone.apiKey !== apiKey) {
      return new Response(
        JSON.stringify({ error: "Invalid device or API key" }),
        { status: 401, headers: jsonHeaders }
      );
    }

    const commands = await ctx.runQuery(api.cmdDroneCommands.getPendingCommands, { deviceId });
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
    const body = await request.json();
    const { commandId, deviceId, apiKey, status, result } = body;

    if (!commandId || !deviceId || !apiKey) {
      return new Response(
        JSON.stringify({ error: "commandId, deviceId, and apiKey required" }),
        { status: 400, headers: jsonHeaders }
      );
    }

    // Validate API key
    const drone = await ctx.runQuery(api.cmdDrones.getDroneByDeviceId, { deviceId });
    if (!drone || drone.apiKey !== apiKey) {
      return new Response(
        JSON.stringify({ error: "Invalid device or API key" }),
        { status: 401, headers: jsonHeaders }
      );
    }

    const ackResult = await ctx.runMutation(api.cmdDroneCommands.ackCommand, {
      commandId,
      status: status || "completed",
      result,
    });
    return new Response(JSON.stringify(ackResult), {
      status: 200,
      headers: jsonHeaders,
    });
  }),
});

export default http;
