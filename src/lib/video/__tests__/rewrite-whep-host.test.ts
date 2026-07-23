import { describe, it, expect } from "vitest";
import { rewriteWhepHost, resolveAgentWhepUrl } from "../rewrite-whep-host";

describe("rewriteWhepHost", () => {
  it("swaps the WHEP hostname to the agent base host, keeping port + path", () => {
    expect(
      rewriteWhepHost(
        "http://drone.local:8889/main/whep",
        "http://192.168.2.11:8080",
      ),
    ).toBe("http://192.168.2.11:8889/main/whep");
  });

  it("preserves a non-default WHEP port", () => {
    expect(
      rewriteWhepHost(
        "http://drone.local:9000/cam/whep",
        "http://10.0.0.5:8080",
      ),
    ).toBe("http://10.0.0.5:9000/cam/whep");
  });

  it("rewrites when the agent base is itself a hostname", () => {
    expect(
      rewriteWhepHost(
        "http://192.168.200.200:8889/main/whep",
        "http://drone.local:8080",
      ),
    ).toBe("http://drone.local:8889/main/whep");
  });

  it("is a no-op when the hosts already match", () => {
    const url = "http://192.168.2.11:8889/main/whep";
    expect(rewriteWhepHost(url, "http://192.168.2.11:8080")).toBe(url);
  });

  it("returns the WHEP url unchanged when the agent base is missing", () => {
    const url = "http://drone.local:8889/main/whep";
    expect(rewriteWhepHost(url, null)).toBe(url);
    expect(rewriteWhepHost(url, "")).toBe(url);
  });

  it("returns the WHEP url unchanged when it is unparseable", () => {
    expect(rewriteWhepHost("not a url", "http://192.168.2.11:8080")).toBe(
      "not a url",
    );
  });

  it("passes null/empty WHEP through untouched", () => {
    expect(rewriteWhepHost(null, "http://192.168.2.11:8080")).toBeNull();
    expect(rewriteWhepHost("", "http://192.168.2.11:8080")).toBe("");
  });
});

describe("resolveAgentWhepUrl", () => {
  it("rewrites a supplied whep_url onto the reachable connected host", () => {
    expect(
      resolveAgentWhepUrl(
        "http://127.0.0.1:8889/main/whep",
        "running",
        "http://192.168.200.200:8080",
      ),
    ).toBe("http://192.168.200.200:8889/main/whep");
  });

  it("synthesizes a WHEP url from the connected host when the agent omits it", () => {
    // The drone-profile status returns state=running but no whep_url on a
    // transient mediamtx-readiness miss — synthesize instead of null so the
    // cascade has a reachable URL to dial.
    expect(
      resolveAgentWhepUrl(null, "running", "http://192.168.200.200:8080"),
    ).toBe("http://192.168.200.200:8889/main/whep");
  });

  it("synthesizes for not_initialized / connecting (pipeline may be coming up)", () => {
    expect(
      resolveAgentWhepUrl(null, "not_initialized", "http://192.168.200.200:8080"),
    ).toBe("http://192.168.200.200:8889/main/whep");
    expect(
      resolveAgentWhepUrl(undefined, "connecting", "http://drone.local:8080"),
    ).toBe("http://drone.local:8889/main/whep");
  });

  it("returns null for hard-off states (stopped/disabled/error/absent)", () => {
    for (const s of ["stopped", "disabled", "error", "absent"]) {
      expect(
        resolveAgentWhepUrl(null, s, "http://192.168.200.200:8080"),
      ).toBeNull();
    }
  });

  it("returns null when there is no base URL to synthesize from", () => {
    expect(resolveAgentWhepUrl(null, "running", null)).toBeNull();
    expect(resolveAgentWhepUrl(null, "running", "")).toBeNull();
  });
});
