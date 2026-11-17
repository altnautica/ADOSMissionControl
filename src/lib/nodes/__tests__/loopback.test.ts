/**
 * @module nodes/__tests__/loopback
 * @description The loopback reach decides three behaviours — whether the
 * secure-page block applies, whether a pair call goes through the server-side
 * proxy, and whether the request declares a private address space — so the
 * classifier and the exemption are the contract to pin.
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";

import { isLoopbackHost, loopbackInit } from "../loopback";
describe("isLoopbackHost", () => {
  it("matches localhost, every 127 address and ::1", () => {
    for (const h of [
      "http://localhost:8080",
      "http://127.0.0.1:8080",
      "http://127.1.2.3:8080",
      "http://[::1]:8080",
      "[::1]",
      "localhost",
      "127.0.0.1",
    ]) {
      expect(isLoopbackHost(h), h).toBe(true);
    }
  });

  it("does not match a LAN or public address", () => {
    for (const h of [
      "http://192.168.1.50:8080",
      "http://skynode.local:8080",
      "https://command.altnautica.com",
      "http://10.0.0.2",
      "http://127a.0.0.1",
      "",
      "not a url",
    ]) {
      expect(isLoopbackHost(h), h).toBe(false);
    }
  });
});

describe("loopbackInit", () => {
  it("declares the loopback address space for a loopback target", () => {
    const init = loopbackInit("http://127.0.0.1:8080/api/status", {
      method: "GET",
      headers: { "X-ADOS-Key": "k" },
    });
    expect(init.targetAddressSpace).toBe("loopback");
    // The caller's init survives: the declaration is added, not substituted.
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual({ "X-ADOS-Key": "k" });
  });

  it("leaves a LAN target untouched", () => {
    const init = loopbackInit("http://192.168.1.50:8080/api/status", { method: "GET" });
    expect(init.targetAddressSpace).toBeUndefined();
    expect(init.method).toBe("GET");
  });
});
