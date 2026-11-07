/**
 * @module fc-setup/client
 * @description Client for a drone agent's flight-controller setup routes
 * (pairing-key auth, WebSocket ticket scope `fc.setup`):
 *
 *   GET  /api/v1/fc-setup                                    wizards, state, report
 *   POST /api/v1/fc-setup/{wizard}/start                     -> {ok, wizard}
 *   POST /api/v1/fc-setup/{wizard}/steps/{step}/actions/{id} {args?} -> {ok, step}
 *   POST /api/v1/fc-setup/{wizard}/steps/{step}/run          -> {ok, step}
 *   POST /api/v1/fc-setup/{wizard}/abort                     -> {ok, wizard}
 *   POST /api/v1/fc-setup/revert {snapshot}                  -> {ok, restored}
 *   WS   /api/v1/fc-setup/stream                             step/wizard frames while a wizard runs
 *
 * A refusal is HTTP 409/422 (503 with no setup engine) with
 * `{ok:false, err:"<msg_key>"}`. Requests go through a {@link SetupTransport}
 * so demo mode can answer in place of an agent.
 * @license GPL-3.0-only
 */

import { GroundStationApiError, gsRequest, type RequestContext } from "@/lib/api/ground-station/request";
import { WS_TICKET_PROTOCOL, mintWsTicket } from "@/lib/api/ground-station/ws-ticket";
import { openReconnectingSocket } from "@/lib/net/reconnecting-socket";

import { parseFrame, parseStatus, parseStep, parseWizard } from "./parse";
import type { SetupFrame, SetupStatus, SetupStep, SetupValue, Wizard } from "./types";

export const FC_SETUP_BASE = "/api/v1/fc-setup";
export const FC_SETUP_SCOPE = "fc.setup" as const;

const seg = encodeURIComponent;

/** Every fc-setup URL, built in one place. */
export const fcSetupUrls = {
  status: () => FC_SETUP_BASE,
  start: (wizard: string) => `${FC_SETUP_BASE}/${seg(wizard)}/start`,
  action: (wizard: string, step: string, action: string) =>
    `${FC_SETUP_BASE}/${seg(wizard)}/steps/${seg(step)}/actions/${seg(action)}`,
  run: (wizard: string, step: string) => `${FC_SETUP_BASE}/${seg(wizard)}/steps/${seg(step)}/run`,
  abort: (wizard: string) => `${FC_SETUP_BASE}/${seg(wizard)}/abort`,
  revert: () => `${FC_SETUP_BASE}/revert`,
  /** The stream URL on the agent's origin (`ws:` or `wss:`). */
  stream: (loc: { protocol: string; host: string }) =>
    `${loc.protocol === "https:" ? "wss:" : "ws:"}//${loc.host}${FC_SETUP_BASE}/stream`,
};

/** A refused setup request, carrying the engine's message key. */
export class SetupRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly errKey: string | null,
    message: string,
  ) {
    super(message);
    this.name = "SetupRequestError";
  }
}

/** How the setup client reaches one drone: the agent over HTTP, or the demo. */
export interface SetupTransport {
  get: (path: string, signal?: AbortSignal) => Promise<unknown>;
  post: (path: string, body: unknown) => Promise<unknown>;
  /** Hold the stream open; `onOpen` fires on each (re)connect. Returns stop. */
  openStream: (onFrame: (frame: SetupFrame) => void, onOpen?: () => void) => () => void;
}

function toSetupError(err: unknown): unknown {
  if (!(err instanceof GroundStationApiError)) return err;
  let key: string | null = null;
  try {
    const body = JSON.parse(err.body) as { err?: unknown };
    if (typeof body.err === "string") key = body.err;
  } catch {
    // A non-JSON body (a proxy error page) carries no key.
  }
  return new SetupRequestError(err.status, key, err.message);
}

/** The agent transport: pairing key (or dashboard session) on every request,
 *  a fresh `fc.setup` ticket per stream dial. */
export function agentSetupTransport(ctx: RequestContext): SetupTransport {
  const call = async (path: string, init: RequestInit): Promise<unknown> => {
    try {
      return await gsRequest<unknown>(ctx, path, init);
    } catch (err) {
      throw toSetupError(err);
    }
  };
  return {
    get: (path, signal) => call(path, { method: "GET", signal }),
    post: (path, body) => call(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
    openStream: (onFrame, onOpen) => {
      const url = fcSetupUrls.stream(new URL(ctx.baseUrl));
      return openReconnectingSocket<WebSocket>({
        open: async (signal) => {
          const ticket = await mintWsTicket(ctx, FC_SETUP_SCOPE, signal);
          return ticket ? new WebSocket(url, [WS_TICKET_PROTOCOL, ticket]) : new WebSocket(url);
        },
        // The server keeps alive once a second.
        livenessTimeoutMs: 5000,
        onOpen: () => onOpen?.(),
        onMessage: (data) => {
          const frame = typeof data === "string" ? parseFrame(data) : null;
          if (frame) onFrame(frame);
        },
      });
    },
  };
}

/** The engine's message key from a refused request, else null. */
export function setupErrorKey(err: unknown): string | null {
  return err instanceof SetupRequestError ? err.errKey : null;
}

function badBody(path: string): Error {
  return new Error(`unexpected response from ${path}`);
}

export async function fetchSetupStatus(t: SetupTransport, signal?: AbortSignal): Promise<SetupStatus> {
  const path = fcSetupUrls.status();
  const status = parseStatus(await t.get(path, signal));
  if (!status) throw badBody(path);
  return status;
}

async function postWizard(t: SetupTransport, path: string): Promise<Wizard> {
  const body = (await t.post(path, {})) as { wizard?: unknown } | null;
  const wizard = parseWizard(body?.wizard);
  if (!wizard) throw badBody(path);
  return wizard;
}

async function postStep(t: SetupTransport, path: string, body: unknown): Promise<SetupStep> {
  const res = (await t.post(path, body)) as { step?: unknown } | null;
  const step = parseStep(res?.step);
  if (!step) throw badBody(path);
  return step;
}

export function startWizard(t: SetupTransport, wizard: string): Promise<Wizard> {
  return postWizard(t, fcSetupUrls.start(wizard));
}

export function abortWizard(t: SetupTransport, wizard: string): Promise<Wizard> {
  return postWizard(t, fcSetupUrls.abort(wizard));
}

export function runStepAction(
  t: SetupTransport,
  wizard: string,
  step: string,
  action: string,
  args?: Record<string, SetupValue>,
): Promise<SetupStep> {
  return postStep(t, fcSetupUrls.action(wizard, step, action), args && Object.keys(args).length ? { args } : {});
}

export function rerunStep(t: SetupTransport, wizard: string, step: string): Promise<SetupStep> {
  return postStep(t, fcSetupUrls.run(wizard, step), {});
}

export async function revertToSnapshot(t: SetupTransport, snapshot: string): Promise<number> {
  const body = (await t.post(fcSetupUrls.revert(), { snapshot })) as { restored?: unknown } | null;
  return typeof body?.restored === "number" ? body.restored : 0;
}
