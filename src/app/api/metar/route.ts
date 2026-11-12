/**
 * @module MetarRoute
 * @description Same-origin proxy for the aviationweather.gov METAR API. The
 * API sends no `Access-Control-Allow-Origin`, so the browser cannot read it
 * directly; the flight-record weather snapshot fetches through here.
 *
 * Only a station id is accepted, and the upstream host is fixed.
 *
 * @license GPL-3.0-only
 */

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const METAR_UPSTREAM_URL = "https://aviationweather.gov/api/data/metar";
const UPSTREAM_TIMEOUT_MS = 8000;
/** ICAO location indicator (4 chars) or a 3-char US identifier. */
const STATION_ID = /^[A-Z0-9]{3,4}$/;

export async function GET(req: NextRequest) {
  const ids = (req.nextUrl.searchParams.get("ids") ?? "").toUpperCase();
  if (!STATION_ID.test(ids)) {
    return NextResponse.json({ error: "bad_station", message: "ids must be one station id" }, { status: 400 });
  }
  const url = `${METAR_UPSTREAM_URL}?ids=${ids}&format=json&hours=2`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      return NextResponse.json({ error: "upstream_error", message: `METAR service answered ${res.status}` }, { status: 502 });
    }
    // An empty 204 (no report for the station) is an empty list.
    const text = await res.text();
    return new NextResponse(text.trim() === "" ? "[]" : text, {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=600" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: "fetch_failed", message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
