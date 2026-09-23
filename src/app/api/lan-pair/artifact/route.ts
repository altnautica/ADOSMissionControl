/**
 * @module LanPairArtifactRoute
 * @description Server-side, binary-safe proxy for a compute node's
 * reconstruction ARTIFACTS (the `/artifacts/*` blobs on the engine's own
 * `:8092` listener — a `.ply` splat/point cloud, a `.rrd` Rerun recording).
 *
 * Sibling to the JSON `/api/lan-pair/compute` proxy, but streams the raw body
 * (never `.text()`, which would corrupt a binary blob) and forwards the
 * `Range` request so large recordings can be range-fetched. Exists because the
 * engine stamps its artifact URLs with a drifting mDNS `.local` host the browser
 * cannot resolve (and mixed-content on an HTTPS GCS); routing through this
 * same-origin proxy resolves the paired host to IPv4 server-side and hands the
 * viewers a plain, reachable URL (Rule 39 local-first).
 *
 * GET `?host=<pairedHost>&path=artifacts/<relpath>`.
 *
 * The node's API KEY IS NOT IN THE URL. It used to be (`&key=<apiKey>`), and
 * that key is full command authority over the aircraft: it landed in browser
 * history, in the Next server's and every fronting proxy's access log, in
 * `document.referrer` on any subresource the viewer loads, and in a DOM
 * attribute readable by any extension. A third-party splat loader fetches the
 * URL itself, so a request header is not available to every consumer —
 * instead `POST` to this same path first with `{host, key}` to mint a
 * short-lived, `HttpOnly`, path-scoped, `SameSite=Strict` grant cookie, which
 * the browser then attaches to the viewer's own GET automatically.
 *
 * @license GPL-3.0-only
 */

import { NextRequest, NextResponse } from "next/server";
import {
  agentUrl,
  checkAgentHost,
  isSafeSubPath,
  proxyError,
  readJsonEnvelope,
} from "../_proxy";

export const runtime = "nodejs";

/** Generous budget: an artifact can be tens/hundreds of MB over the LAN. */
const UPSTREAM_TIMEOUT_MS = 120000;
/** The ados-compute engine's own artifact/job port. */
const COMPUTE_JOB_PORT = 8092;

/**
 * The only Content-Types this proxy will echo from a LAN node.
 *
 * Every one is an opaque binary the viewers decode themselves; none is a
 * document type the browser renders. Anything else is served as
 * `application/octet-stream` + `Content-Disposition: attachment`, because
 * this route is SAME-ORIGIN with the GCS and an echoed `text/html` becomes
 * script execution on the origin that holds every paired agent's API key.
 */
const ARTIFACT_CONTENT_TYPES = new Set([
  "application/octet-stream",
  "application/ply",
  "model/ply",
  "application/x-ply",
  "application/vnd.rerun",
  "application/json",
  "image/png",
  "image/jpeg",
  "video/mp4",
]);

/**
 * Cookie carrying `{ <host>: <apiKey> }` for the nodes this tab is viewing
 * artifacts from. `HttpOnly` keeps it out of reach of page script (the whole
 * point — an XSS on this origin must not be able to read it), `Path` scopes
 * it to this one route so it rides no other request, and `SameSite=Strict`
 * keeps a cross-site navigation from carrying it.
 */
const GRANT_COOKIE = "ados_artifact_grant";
/** Long enough to load a large recording, short enough to not be a session. */
const GRANT_TTL_S = 900;

type Grants = Record<string, string>;

function readGrants(req: NextRequest): Grants {
  const raw = req.cookies.get(GRANT_COOKIE)?.value;
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Grants = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * `POST` `{host, key}` → merge one node's key into the grant cookie.
 *
 * Returns no body worth reading; the point is the `Set-Cookie`. Posting a
 * blank/absent `key` REVOKES that host's grant, which is how a node being
 * forgotten drops its artifact authority without waiting out the TTL.
 */
export async function POST(req: NextRequest) {
  // Minting a grant is a state change: same-origin JSON only, so a cross-site
  // form can neither plant nor revoke a key.
  const env = await readJsonEnvelope(req);
  if ("reject" in env) return env.reject;
  const { host: rawHost, key } = env.payload;
  const checked = checkAgentHost(rawHost);
  if ("reject" in checked) return checked.reject;
  const { target } = checked;

  const grants = readGrants(req);
  if (typeof key === "string" && key.trim()) {
    grants[target.host] = key.trim();
  } else {
    delete grants[target.host];
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: GRANT_COOKIE,
    value: Buffer.from(JSON.stringify(grants), "utf8").toString("base64url"),
    httpOnly: true,
    sameSite: "strict",
    path: "/api/lan-pair/artifact",
    maxAge: GRANT_TTL_S,
    secure: req.nextUrl.protocol === "https:",
  });
  return res;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const checked = checkAgentHost(q.get("host") ?? "");
  if ("reject" in checked) return checked.reject;
  const { target } = checked;

  // Only artifact blobs are proxyable here — defence-in-depth over the engine's
  // own path-jail. Plain segments only (no %, dot or empty segment), so the
  // path can never leave artifacts/.
  const path = String(q.get("path") ?? "").replace(/^\/+/, "");
  if (!path.startsWith("artifacts/") || !isSafeSubPath(path)) {
    return proxyError(400, "bad_path", "path must be an artifacts/ blob");
  }

  // From the HttpOnly grant cookie, never the query string. A key in a URL
  // is a key in browser history, in every access log along the path, and in
  // a DOM attribute — and this one is full command authority over the node.
  const apiKey = readGrants(req)[target.host] ?? "";
  const range = req.headers.get("range");

  try {
    // Resolve to IPv4 first so a .local host doesn't stall on the AAAA lookup,
    // then force the engine port.
    const url = await agentUrl(target, `/${path}`, COMPUTE_JOB_PORT);
    if (typeof url !== "string") return url.reject;

    const upstream = await fetch(url, {
      method: "GET",
      headers: {
        ...(apiKey ? { "X-ADOS-Key": apiKey } : {}),
        ...(range ? { Range: range } : {}),
      },
      redirect: "manual",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (upstream.status >= 300 && upstream.status < 400) {
      await upstream.body?.cancel();
      return proxyError(
        502,
        "upstream_redirect",
        "The node answered with a redirect",
      );
    }

    // Stream the body through (200 full or 206 partial), preserving the
    // headers the loaders need — but NEVER the upstream's own Content-Type
    // unless it is one this proxy's viewers actually consume.
    //
    // This is same-origin with the GCS, so a LAN node answering
    // `Content-Type: text/html` yielded attacker HTML on the GCS ORIGIN, and
    // the page CSP allows `'unsafe-inline'` script, so it executes.
    // `local-nodes-store` documents the consequence itself: "any XSS that
    // runs on the GCS origin reads every paired agent's apiKey" — i.e. full
    // command authority over the fleet. `X-Content-Type-Options: nosniff`
    // does not help, because the type was DECLARED rather than sniffed.
    const headers = new Headers();
    for (const h of [
      "content-length",
      "content-range",
      "accept-ranges",
      "last-modified",
      "etag",
    ]) {
      const v = upstream.headers.get(h);
      if (v) headers.set(h, v);
    }

    const upstreamType = (upstream.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (ARTIFACT_CONTENT_TYPES.has(upstreamType)) {
      headers.set("content-type", upstreamType);
    } else {
      // Anything off the list is served as an opaque download, never as a
      // document the browser will render on this origin.
      headers.set("content-type", "application/octet-stream");
      headers.set("content-disposition", "attachment");
    }
    headers.set("x-content-type-options", "nosniff");

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: "upstream_unreachable",
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }
}
