// @vitest-environment node
/**
 * The local-only route gate: the LAN-pair proxy and the MCP activity feed
 * answer only pages opened on this machine or its local network, never a
 * page served under a public name, a reverse proxy relaying an internet
 * client, or a deployment that turned local routes off.
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it } from "vitest";
import { checkLocalOnlyRoute } from "../local-only-route";

function req(headers: Record<string, string>): Request {
  return new Request("http://localhost:4000/api/lan-pair/probe", { headers });
}

async function refusal(res: Response | null): Promise<unknown> {
  expect(res).not.toBeNull();
  expect(res!.status).toBe(403);
  return res!.json();
}

afterEach(() => {
  delete process.env.ADOS_LOCAL_ROUTES;
  delete process.env.ADOS_LOCAL_ROUTE_HOSTS;
});

describe("checkLocalOnlyRoute", () => {
  it("refuses a page served under a public name", async () => {
    expect(await refusal(checkLocalOnlyRoute(req({ host: "cloud.example.com" })))).toEqual(
      expect.objectContaining({ error: "local_only" }),
    );
  });

  it("allows a page opened at a private LAN address", () => {
    expect(checkLocalOnlyRoute(req({ host: "192.168.1.50:4000" }))).toBeNull();
  });

  it("allows loopback, mDNS and IPv6 local hosts", () => {
    for (const host of ["localhost:4000", "127.0.0.1:4000", "[::1]:4000", "gcs.local", "[fd00::5]:4000"]) {
      expect(checkLocalOnlyRoute(req({ host })), host).toBeNull();
    }
  });

  it("refuses a public forwarded peer", async () => {
    await refusal(
      checkLocalOnlyRoute(req({ host: "192.168.1.50:4000", "x-forwarded-for": "203.0.113.9" })),
    );
  });

  it("refuses when any forwarded hop is public", async () => {
    await refusal(
      checkLocalOnlyRoute(
        req({ host: "localhost:4000", "x-forwarded-for": "127.0.0.1, 203.0.113.9" }),
      ),
    );
  });

  it("allows private and mapped-loopback forwarded peers", () => {
    expect(
      checkLocalOnlyRoute(
        req({ host: "192.168.1.50:4000", "x-forwarded-for": "192.168.1.20, ::ffff:127.0.0.1" }),
      ),
    ).toBeNull();
  });

  it("refuses a public forwarded host even when Host is local", async () => {
    await refusal(
      checkLocalOnlyRoute(req({ host: "localhost:4000", "x-forwarded-host": "cloud.example.com" })),
    );
  });

  it("refuses a public name that merely starts with a private label", async () => {
    await refusal(checkLocalOnlyRoute(req({ host: "192.168.1.50.example.com" })));
  });

  it("refuses everything when local routes are turned off", async () => {
    process.env.ADOS_LOCAL_ROUTES = "off";
    await refusal(checkLocalOnlyRoute(req({ host: "192.168.1.50:4000" })));
    await refusal(checkLocalOnlyRoute(req({ host: "localhost:4000" })));
  });

  it("admits a host the operator listed", () => {
    process.env.ADOS_LOCAL_ROUTE_HOSTS = "gcs.example.com, other.example.com:4000";
    expect(checkLocalOnlyRoute(req({ host: "gcs.example.com:4000" }))).toBeNull();
    expect(checkLocalOnlyRoute(req({ host: "other.example.com" }))).toBeNull();
  });

  it("in loopback mode refuses a LAN host and requires a loopback peer", async () => {
    await refusal(
      checkLocalOnlyRoute(req({ host: "192.168.1.50:4000", "x-forwarded-for": "127.0.0.1" }), {
        loopback: true,
      }),
    );
    await refusal(checkLocalOnlyRoute(req({ host: "localhost:4000" }), { loopback: true }));
    await refusal(
      checkLocalOnlyRoute(req({ host: "localhost:4000", "x-forwarded-for": "192.168.1.20" }), {
        loopback: true,
      }),
    );
    expect(
      checkLocalOnlyRoute(req({ host: "localhost:4000", "x-forwarded-for": "::1" }), {
        loopback: true,
      }),
    ).toBeNull();
  });
});
