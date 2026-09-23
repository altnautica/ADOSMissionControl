/**
 * @module RegistryArchiveRoute
 * @description Same-origin proxy that streams a published plugin archive
 * (`.adosplug`) back to the browser. The GCS-side install finalizer
 * fetches the archive to extract its built iframe bundle, but the
 * release CDN does not promise cross-origin access from an arbitrary
 * Mission Control origin, so the fetch happens server-side here and the
 * bytes are returned same-origin.
 *
 * The `url` and every redirect hop are allowlisted (an SSRF guard): a
 * GitHub release download (`github.com/<owner>/<repo>/releases/download/…`),
 * GitHub's release-asset CDN hosts, and the official ADOS registry host.
 * Redirects are followed by hand so each Location is re-checked, and the body
 * is read under a byte ceiling so a chunked answer cannot be buffered whole.
 *
 * @license GPL-3.0-only
 */

import { NextRequest, NextResponse } from "next/server";

import { OFFICIAL_PLUGIN_REGISTRY_URL } from "@/lib/config/endpoints";
import { readArrayBufferWithLimit } from "@/lib/net/fetch-with-timeout";

export const runtime = "nodejs";

const UPSTREAM_TIMEOUT_MS = 30_000;
const MAX_BYTES = 64 * 1024 * 1024; // 64 MB ceiling for a plugin archive.
const MAX_REDIRECTS = 5;

/** CDN hosts a GitHub release download redirects to. */
const RELEASE_ASSET_HOSTS: ReadonlySet<string> = new Set([
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);

/** `/<owner>/<repo>/releases/download/<tag>/<asset>` on github.com. */
const GITHUB_RELEASE_PATH = /^\/[^/]+\/[^/]+\/releases\/download\/[^/]+\/[^/]+$/;

/** True when `url` is an https archive location the proxy may fetch. */
function isAllowedArchiveUrl(url: URL): boolean {
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (host === "github.com") return GITHUB_RELEASE_PATH.test(url.pathname);
  if (RELEASE_ASSET_HOSTS.has(host)) return true;
  try {
    return host === new URL(OFFICIAL_PLUGIN_REGISTRY_URL).hostname.toLowerCase();
  } catch {
    return false;
  }
}

function refuse(status: number, error: string, message: string): NextResponse {
  return NextResponse.json({ error, message }, { status });
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url");
  if (!raw) return refuse(400, "missing_url", "url query parameter is required");

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return refuse(400, "bad_url", "url is not a valid absolute URL");
  }

  if (!isAllowedArchiveUrl(target)) {
    return refuse(
      403,
      "host_not_allowed",
      `archive location ${target.hostname} is not on the allowlist`,
    );
  }

  const signal = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
  let upstream: Response;
  try {
    for (let hop = 0; ; hop++) {
      upstream = await fetch(target.toString(), { redirect: "manual", signal });
      if (upstream.status < 300 || upstream.status >= 400) break;
      await upstream.body?.cancel();
      const location = upstream.headers.get("location");
      if (!location || hop >= MAX_REDIRECTS) {
        return refuse(502, "bad_redirect", "archive host redirected too often or without a location");
      }
      target = new URL(location, target);
      if (!isAllowedArchiveUrl(target)) {
        return refuse(
          403,
          "host_not_allowed",
          `archive redirect to ${target.hostname} is not on the allowlist`,
        );
      }
    }
  } catch (err) {
    return refuse(502, "fetch_failed", err instanceof Error ? err.message : String(err));
  }

  if (!upstream.ok) {
    return refuse(
      upstream.status === 404 ? 404 : 502,
      "upstream_error",
      `archive host returned HTTP ${upstream.status}`,
    );
  }

  let buf: ArrayBuffer;
  try {
    buf = await readArrayBufferWithLimit(upstream, MAX_BYTES);
  } catch (err) {
    await upstream.body?.cancel().catch(() => undefined);
    const message = err instanceof Error ? err.message : String(err);
    return message === "Upstream response too large"
      ? refuse(413, "too_large", "archive exceeds the size ceiling")
      : refuse(502, "fetch_failed", message);
  }

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
    },
  });
}
