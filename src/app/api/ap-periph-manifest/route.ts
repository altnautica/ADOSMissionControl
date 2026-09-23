/**
 * Server-side proxy for the AP_Periph firmware index.
 *
 * The upstream server publishes the AP_Periph build tree as plain
 * Apache mod_autoindex HTML pages and does not return CORS headers,
 * so the browser cannot read them directly. This route forwards a
 * request to `firmware.ardupilot.org/AP_Periph/<path>` and returns
 * the body to the caller. Paths are validated against a strict
 * allow-list of segment characters to prevent traversal.
 *
 * The body is always served as inert bytes (`text/plain` for listings,
 * `application/octet-stream` for files) with `nosniff` and a sandbox CSP.
 * The client parses the listing itself, so third-party HTML never renders
 * as a document on this origin.
 *
 * @license GPL-3.0-only
 */

import { NextRequest, NextResponse } from "next/server";

import {
  fetchWithTimeout,
  readArrayBufferWithLimit,
} from "@/lib/net/fetch-with-timeout";
import { sanitizePath } from "@/lib/protocol/firmware/ap-periph-path";

const UPSTREAM_BASE = "https://firmware.ardupilot.org/AP_Periph";
const MAX_BYTES = 16 * 1024 * 1024; // 16 MiB — covers the largest .hex

export async function GET(request: NextRequest) {
  const rawPath = request.nextUrl.searchParams.get("path") ?? "";
  const path = sanitizePath(rawPath);
  if (path === null) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  const upstream = path === "" ? `${UPSTREAM_BASE}/` : `${UPSTREAM_BASE}/${path}`;

  try {
    const res = await fetchWithTimeout(upstream, {
      upstreamSignal: request.signal,
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Upstream returned ${res.status}` },
        { status: res.status === 404 ? 404 : 502 },
      );
    }

    const body = await readArrayBufferWithLimit(res, MAX_BYTES);
    const isListing = path === "" || path.endsWith("/");
    const etag = res.headers.get("etag");
    const lastModified = res.headers.get("last-modified");

    const headers: Record<string, string> = {
      "Content-Type": isListing ? "text/plain; charset=utf-8" : "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
      "Cache-Control": "public, max-age=900, stale-while-revalidate=3600",
    };
    if (etag) headers["ETag"] = etag;
    if (lastModified) headers["Last-Modified"] = lastModified;

    return new NextResponse(body, { status: 200, headers });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json({ error: "Upstream timeout" }, { status: 504 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
