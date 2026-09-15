import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { loadPluginBundle } from "@/lib/plugins/bundle-loader";
import { PLUGIN_FRAME_CSP } from "@/lib/plugins/iframe-csp";

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
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => html,
    }));
    vi.stubGlobal("fetch", fetchSpy);
    return fetchSpy;
  }

  it("fetches the url and returns a blob url + a working revoke", async () => {
    const fetchSpy = stubFetch("<html><head></head><body></body></html>");

    const { blobUrl, revoke } = await loadPluginBundle("https://signed/bundle");

    expect(fetchSpy).toHaveBeenCalledWith("https://signed/bundle");
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
    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain(PLUGIN_FRAME_CSP);
  });

  it("does not add a second policy to a shell that already declares one", async () => {
    stubFetch(
      `<html><head><meta http-equiv="Content-Security-Policy" content="${PLUGIN_FRAME_CSP}"></head><body></body></html>`,
    );

    await loadPluginBundle("https://signed/current-shell");

    const html = await minted!.text();
    expect(html.match(/http-equiv="Content-Security-Policy"/g)).toHaveLength(1);
  });

  it("throws a clear error on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => "",
      })),
    );

    await expect(loadPluginBundle("https://signed/missing")).rejects.toThrow(
      /404/,
    );
    expect(createSpy).not.toHaveBeenCalled();
  });
});
