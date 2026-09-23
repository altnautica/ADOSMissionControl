import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  loadPluginBundle,
  PLUGIN_BUNDLE_MAX_BYTES,
} from "@/lib/plugins/bundle-loader";
import { PLUGIN_FRAME_CSP, PLUGIN_FRAME_HEAD } from "@/lib/plugins/iframe-csp";

describe("loadPluginBundle", () => {
  const createSpy = vi.fn((blob: unknown) => {
    minted = blob as Blob;
    return "blob:fake-123";
  });
  const revokeSpy = vi.fn();
  let minted: Blob | null = null;

  beforeEach(() => {
    minted = null;
    createSpy.mockClear();
    revokeSpy.mockClear();
    URL.createObjectURL = createSpy as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeSpy as unknown as typeof URL.revokeObjectURL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(html: string) {
    const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => new Response(html));
    vi.stubGlobal("fetch", fetchSpy);
    return fetchSpy;
  }

  it("fetches the url and returns a blob url + a working revoke", async () => {
    const fetchSpy = stubFetch("<html><head></head><body></body></html>");

    const { blobUrl, revoke } = await loadPluginBundle("https://signed/bundle");

    expect(fetchSpy.mock.calls[0][0]).toBe("https://signed/bundle");
    expect(blobUrl).toBe("blob:fake-123");
    expect(minted?.type).toBe("text/html");

    revoke();
    expect(revokeSpy).toHaveBeenCalledWith("blob:fake-123");
  });

  it("pins connect-src on a stored shell that predates the frame policy", async () => {
    // The cloud path uploads its shell at install time and re-fetches it here.
    // A shell recorded before the policy existed carries no meta tag, and a
    // blob: document inherits the app's permissive connect-src — so the frame
    // would have full outbound network reach unless the policy is added now.
    stubFetch("<html><head></head><body><script>1</script></body></html>");

    await loadPluginBundle("https://signed/legacy-shell");

    const html = await minted!.text();
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain(PLUGIN_FRAME_CSP);
  });

  it("injects the policy even when the bundle text mentions a policy", async () => {
    // A legacy shell with no policy whose inlined bundle carries the literal
    // must still get the frame policy and guard at the start of <head>.
    stubFetch(
      '<html><head></head><body><script type="module">const s = \'http-equiv="Content-Security-Policy"\';</script></body></html>',
    );

    await loadPluginBundle("https://signed/legacy-shell");

    const html = await minted!.text();
    expect(html.startsWith(`<html><head>${PLUGIN_FRAME_HEAD}`)).toBe(true);
  });

  it("aborts the fetch when the caller's signal fires", async () => {
    const fetchSpy = stubFetch("<html><head></head></html>");
    const controller = new AbortController();

    await loadPluginBundle("https://signed/bundle", controller.signal);
    const signal = fetchSpy.mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(false);
    controller.abort();
    expect(signal?.aborted).toBe(true);
  });

  it("refuses a body larger than the bundle cap", async () => {
    stubFetch("x".repeat(PLUGIN_BUNDLE_MAX_BYTES + 1));

    await expect(loadPluginBundle("https://signed/huge")).rejects.toThrow(/exceeds/);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("throws a clear error on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 404, statusText: "Not Found" })),
    );

    await expect(loadPluginBundle("https://signed/missing")).rejects.toThrow(
      /404/,
    );
    expect(createSpy).not.toHaveBeenCalled();
  });
});
