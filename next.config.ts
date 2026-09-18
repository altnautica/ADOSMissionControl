import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Pin tracing root to this package. Without it, repos under paths like
// ~/src/ADOSMissionControl can emit standalone output nested as
// .next/standalone/src/ADOSMissionControl/ — which breaks electron/server.ts
// and electron-builder (they expect server.js at the standalone root).
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: projectRoot,
  // The Electron desktop dev build loads the window from 127.0.0.1 (main.ts /
  // window.ts use 127.0.0.1 to dodge macOS ::1 resolution), while the embedded
  // Turbopack dev server advertises localhost. Next 16 blocks cross-origin
  // access to dev resources (the /_next/webpack-hmr channel) by default, which
  // silently kills Fast Refresh in the desktop window. Allow both loopback
  // spellings so hot reload works in `npm run desktop:dev`.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  env: {
    CESIUM_BASE_URL: "/cesium/",
    NEXT_PUBLIC_BUILD_TARGET: process.env.NEXT_PUBLIC_BUILD_TARGET || "",
  },
  async redirects() {
    return [
      {
        source: "/history",
        destination: "/flight-logs",
        permanent: true,
      },
      {
        source: "/history/:path*",
        destination: "/flight-logs/:path*",
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return [
      // Some bundled CSS (notably Leaflet) emits asset url()s as
      // /static/media/* instead of the served /_next/static/media/*. The
      // standalone server (and the Electron desktop build that runs it) only
      // serves assets under /_next/static, so those requests 404. Map them so
      // the assets resolve wherever they are referenced from.
      {
        source: "/static/media/:path*",
        destination: "/_next/static/media/:path*",
      },
    ];
  },
  async headers() {
    const securityHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(self), usb=(self), serial=(self)",
      },
      {
        key: "Content-Security-Policy",
        value: [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob: https:",
          "font-src 'self' data:",
          // connect-src must include LAN agents reachable over plain
          // HTTP. The browser blocks fetches that aren't in this list
          // BEFORE making them, surfacing as "Failed to fetch" even
          // when the agent is fully reachable.
          //
          // CSP3 source expressions don't support CIDR notation, so
          // allowlisting RFC1918 ranges (`192.168.*`, `10.*`,
          // `172.16-31.*`) needs the bare `http:` / `ws:` scheme
          // sources. That widens the surface beyond LAN — same trade
          // we already accept for `https:` / `wss:`. Adding `'self'`
          // and the loopback specifics first keeps the strictest
          // origins explicit; the bare schemes are the catch-all for
          // mDNS hostnames (`*.local:*`) and direct-IP fetches the
          // GCS needs for paired drone agents.
          "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:* http://localhost:* ws://localhost:* http: ws: https: wss:",
          "worker-src 'self' blob:",
          // The MSE relay lane sets `<video>.src` to a `blob:` URL from
          // `URL.createObjectURL(mediaSource)`, and with no `media-src` the
          // browser falls back to `default-src 'self'` and blocks it — a
          // SILENT, lane-specific black screen, because the WHEP lane uses
          // `srcObject` (a MediaStream, which CSP does not govern) and keeps
          // working.
          "media-src 'self' blob: data:",
          "frame-src 'self' blob:",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
          "frame-ancestors 'self'",
        ].join("; "),
      },
    ];
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
