/**
 * The desktop navigation policy: what a WebContents may open or navigate to.
 *
 * Only the local app origin and the blank popups the detached HUD and
 * telemetry deck render into stay inside the app. Every other web target is
 * handed to the OS browser, and anything that is not http(s)/mailto is
 * dropped outright.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const { openExternal } = vi.hoisted(() => ({
  openExternal: vi.fn(() => Promise.resolve()),
}));

vi.mock("electron", () => ({
  app: { isPackaged: true },
  BrowserWindow: class {},
  shell: { openExternal },
}));

import { applyNavigationPolicy } from "../../../electron/window";

const PORT = 4123;
const APP = `http://127.0.0.1:${PORT}`;

type OpenHandler = (details: { url: string }) => { action: "allow" | "deny" };
type NavListener = (event: { preventDefault: () => void }, url: string) => void;

/** A WebContents stand-in that records what the policy registers. */
function fakeContents() {
  let openHandler: OpenHandler | null = null;
  const listeners = new Map<string, NavListener>();
  const contents = {
    setWindowOpenHandler: (h: OpenHandler) => {
      openHandler = h;
    },
    on: (event: string, listener: NavListener) => {
      listeners.set(event, listener);
    },
  };
  applyNavigationPolicy(contents as unknown as Electron.WebContents, PORT);

  return {
    open(url: string): "allow" | "deny" {
      if (!openHandler) throw new Error("no window-open handler registered");
      return openHandler({ url }).action;
    },
    /** Fire a navigation event; resolves whether the policy blocked it. */
    navigate(event: "will-navigate" | "will-redirect", url: string): boolean {
      const listener = listeners.get(event);
      if (!listener) throw new Error(`${event} was never registered`);
      let prevented = false;
      listener({ preventDefault: () => (prevented = true) }, url);
      return prevented;
    },
  };
}

describe("window-open policy", () => {
  beforeEach(() => openExternal.mockClear());

  it("allows the blank popup the detached HUD and telemetry deck open", () => {
    expect(fakeContents().open("about:blank")).toBe("allow");
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("allows a popup on the local app origin", () => {
    expect(fakeContents().open(`${APP}/hud`)).toBe("allow");
  });

  it("denies an external page and hands it to the OS browser", () => {
    expect(fakeContents().open("https://example.com/docs")).toBe("deny");
    expect(openExternal).toHaveBeenCalledWith("https://example.com/docs");
  });

  it("denies the app port on another host", () => {
    expect(fakeContents().open(`http://192.168.1.50:${PORT}/`)).toBe("deny");
  });

  it.each(["file:///etc/passwd", "javascript:alert(1)", "about:srcdoc"])(
    "denies %s without opening it anywhere",
    (url) => {
      expect(fakeContents().open(url)).toBe("deny");
      expect(openExternal).not.toHaveBeenCalled();
    },
  );
});

describe("navigation policy", () => {
  beforeEach(() => openExternal.mockClear());

  it.each(["will-navigate", "will-redirect"] as const)(
    "%s keeps a local app route in the app",
    (event) => {
      expect(fakeContents().navigate(event, `${APP}/plan`)).toBe(false);
    },
  );

  it.each(["will-navigate", "will-redirect"] as const)(
    "%s blocks a remote origin and opens it externally",
    (event) => {
      expect(fakeContents().navigate(event, "https://example.com/")).toBe(true);
      expect(openExternal).toHaveBeenCalledWith("https://example.com/");
    },
  );

  it("blocks a file: navigation without opening it", () => {
    expect(fakeContents().navigate("will-navigate", "file:///tmp/x.html")).toBe(true);
    expect(openExternal).not.toHaveBeenCalled();
  });
});
