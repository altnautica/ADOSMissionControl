/**
 * @license GPL-3.0-only
 *
 * SSRF guard tests for the LAN-pair proxy host allowlist. The proxy makes
 * plain-HTTP requests on the operator's behalf (including a write-capable
 * config PUT), so `normaliseAndCheckHost` must accept ONLY private / mDNS /
 * loopback targets. The regression these tests pin: the IPv6 private-range
 * check used a leading-substring match (`host.startsWith("fc")`), which let a
 * public DNS name like `fd-cdn.example.com` masquerade as a ULA address.
 */

import { describe, it, expect } from "vitest";

import { normaliseAndCheckHost } from "../host-validation";

/** Narrow the result union to the accepted branch and return the host, or the
 * error code when rejected. Keeps the assertions terse. */
function classify(input: string): { host: string } | { rejected: string } {
  const r = normaliseAndCheckHost(input);
  if ("error" in r && r.error) return { rejected: r.error };
  if ("host" in r && r.host) return { host: r.host };
  throw new Error("unexpected host-validation result shape");
}

describe("normaliseAndCheckHost — private-address allowlist", () => {
  it("accepts RFC1918 IPv4 and defaults the port", () => {
    const r = normaliseAndCheckHost("192.168.1.50");
    expect("error" in r).toBe(false);
    if (!("error" in r)) {
      expect(r.host).toBe("192.168.1.50");
      expect(r.port).toBe(8080);
    }
    expect(classify("10.0.0.1")).toEqual({ host: "10.0.0.1" });
    expect(classify("172.16.5.4")).toEqual({ host: "172.16.5.4" });
    expect(classify("169.254.10.1")).toEqual({ host: "169.254.10.1" });
  });

  it("accepts mDNS .local and loopback", () => {
    expect(classify("agent-node.local")).toEqual({ host: "agent-node.local" });
    expect(classify("localhost")).toEqual({ host: "localhost" });
    expect(classify("127.0.0.1")).toEqual({ host: "127.0.0.1" });
  });

  it("preserves full-URL parsing and honours an explicit port", () => {
    const r = normaliseAndCheckHost("http://192.168.1.50:9000/whatever?x=1");
    expect("error" in r).toBe(false);
    if (!("error" in r)) {
      expect(r.port).toBe(9000);
      expect(r.url).toBe("http://192.168.1.50:9000");
    }
  });

  it("rejects public IPv4 and public DNS names", () => {
    expect(classify("8.8.8.8")).toEqual({ rejected: "host_not_private" });
    expect(classify("172.32.0.1")).toEqual({ rejected: "host_not_private" });
    expect(classify("example.com")).toEqual({ rejected: "host_not_private" });
    expect(classify("http://evil.com:8080")).toEqual({
      rejected: "host_not_private",
    });
  });

  it("rejects userinfo and empty input", () => {
    expect(classify("http://user:pass@192.168.1.50")).toEqual({
      rejected: "userinfo_not_allowed",
    });
    expect(classify("")).toEqual({ rejected: "host_required" });
    // A non-http(s) scheme without `//` is treated as a bare host (`http://` is
    // prepended), so it lands on the private-address check, not a scheme error.
    expect(classify("ftp://192.168.1.50")).toEqual({
      rejected: "host_not_private",
    });
  });

  // The core fix: a public DNS name that merely *starts* with the ULA/link-local
  // hex must not slip past the IPv6 range check.
  it("rejects public DNS names that start with the ULA hex", () => {
    expect(classify("fd-cdn.example.com")).toEqual({
      rejected: "host_not_private",
    });
    expect(classify("fcallback.evil.com")).toEqual({
      rejected: "host_not_private",
    });
    expect(classify("fdcdn.example.com")).toEqual({
      rejected: "host_not_private",
    });
    expect(classify("fe80.attacker.net")).toEqual({
      rejected: "host_not_private",
    });
  });

  it("accepts genuine ULA / link-local IPv6 literals", () => {
    expect(classify("fd00::1")).toEqual({ host: "[fd00::1]" });
    expect(classify("fe80::1")).toEqual({ host: "[fe80::1]" });
    expect(classify("[fc00::1]")).toEqual({ host: "[fc00::1]" });
    expect(classify("http://[fdab:cd12::42]:8080")).toEqual({
      host: "[fdab:cd12::42]",
    });
    // ::1 loopback via IPv6.
    expect(classify("[::1]")).toEqual({ host: "[::1]" });
  });

  it("rejects public / non-private IPv6 literals", () => {
    // 2001:db8::/32 documentation range — public, must be rejected.
    expect(classify("[2001:db8::1]")).toEqual({
      rejected: "host_not_private",
    });
    // Global-unicast 2000::/3.
    expect(classify("[2606:4700:4700::1111]")).toEqual({
      rejected: "host_not_private",
    });
    // febc is inside fe80::/10, but fec0 (site-local, deprecated) is not.
    expect(classify("[fec0::1]")).toEqual({ rejected: "host_not_private" });
  });
});
