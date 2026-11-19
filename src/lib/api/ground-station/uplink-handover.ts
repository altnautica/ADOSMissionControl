// The radio uplink handover: which ground transmits to the fleet, this box or
// a phone that took the uplink from it.
//
// The agent's `GET /api/v1/ground-station/uplink` answers `{uplink: {...} | null}`
// (null while the radio service is not reporting); `POST` with
// `{op: "take_back"}` makes the box transmit again and answers
// `{ok: true, state, uplink?}` or `{error: "E_…", detail}`.

import { GroundStationApiError, gsRequest, type RequestContext } from "./request";

/** The box's radio uplink, as the radio service last reported it. */
export interface RadioUplink {
  state: "transmitting" | "standby";
  /** The phone holding the uplink; null while the box transmits. */
  holder_device_id: string | null;
  holder_name: string | null;
  /** When the box entered this state, epoch ms. */
  since_ms: number | null;
  /** When the holder's presence beacon was last heard, epoch ms. */
  last_beacon_ms: number | null;
}

/** `POST … {op: "take_back"}`'s success reply. */
export interface RadioUplinkTakeBackResult {
  ok: true;
  state: string | null;
  uplink: RadioUplink | null;
}

type Raw = Record<string, unknown>;

function asObj(v: unknown): Raw | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** The sidecar's `uplink` object, or null when it is absent or names no known
 * state: an unknown state is shown as unknown, never guessed. */
export function normaliseRadioUplink(raw: unknown): RadioUplink | null {
  const o = asObj(raw);
  if (!o || (o.state !== "transmitting" && o.state !== "standby")) return null;
  return {
    state: o.state,
    holder_device_id: str(o.holder_device_id),
    holder_name: str(o.holder_name),
    since_ms: num(o.since_ms),
    last_beacon_ms: num(asObj(o.watcher)?.last_beacon_ms),
  };
}

export async function getRadioUplink(ctx: RequestContext): Promise<RadioUplink | null> {
  const body = await gsRequest<unknown>(ctx, "/api/v1/ground-station/uplink");
  return normaliseRadioUplink(asObj(body)?.uplink);
}

export async function takeBackRadioUplink(ctx: RequestContext): Promise<RadioUplinkTakeBackResult> {
  const body = await gsRequest<unknown>(ctx, "/api/v1/ground-station/uplink", {
    method: "POST",
    body: JSON.stringify({ op: "take_back" }),
  });
  const o = asObj(body) ?? {};
  return { ok: true, state: str(o.state), uplink: normaliseRadioUplink(o.uplink) };
}

/** The one-sentence `detail` of an uplink refusal, or null. */
export function uplinkRefusalDetail(err: unknown): string | null {
  if (!(err instanceof GroundStationApiError)) return null;
  try {
    return str(asObj(JSON.parse(err.body))?.detail);
  } catch {
    return null;
  }
}
