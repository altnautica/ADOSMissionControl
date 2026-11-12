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

const { openExternal, showMessageBoxSync } = vi.hoisted(() => ({
  openExternal: vi.fn(() => Promise.resolve()),
  showMessageBoxSync: vi.fn(() => 1),
}));

vi.mock("electron", () => ({
  app: { isPackaged: true },
  BrowserWindow: class {
    static fromWebContents() {
      return null;
    }
  },
  dialog: { showMessageBoxSync },
  shell: { openExternal },
}));

// The OS-browser handoff dedupes a repeat URL inside one second; each test
// starts well clear of the previous one.
let clock = 0;
vi.spyOn(Date, "now").mockImplementation(() => clock);
beforeEach(() => {
  clock += 10_000;
});

import { applyNavigationPolicy } from "../../../electron/window";

const PORT = 4123;
const APP = `http://127.0.0.1:${PORT}`;

type OpenHandler = (details: { url: string }) => { action: "allow" | "deny" };
type NavListener = (event: { preventDefault: () => void }, url?: string) => void;

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
    navigate(event: "will-navigate" | "will-redirect" | "will-prevent-unload", url?: string): boolean {
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
    expect(fakeContents().open(`${APP}/simulate`)).toBe("allow");
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

describe("external handoff dedupe", () => {
  beforeEach(() => openExternal.mockClear());

  it("opens a same-window link once when navigate and redirect both fire", () => {
    const c = fakeContents();
    c.navigate("will-navigate", "https://example.com/a");
    c.navigate("will-redirect", "https://example.com/a");
    expect(openExternal).toHaveBeenCalledTimes(1);
  });

  it("opens the same link again after the dedupe window", () => {
    const c = fakeContents();
    c.navigate("will-navigate", "https://example.com/b");
    clock += 1500;
    c.navigate("will-navigate", "https://example.com/b");
    expect(openExternal).toHaveBeenCalledTimes(2);
  });
});

describe("unload prompt", () => {
  beforeEach(() => showMessageBoxSync.mockReset());

  it("lets the page close when the operator picks Leave", () => {
    showMessageBoxSync.mockReturnValue(0);
    expect(fakeContents().navigate("will-prevent-unload")).toBe(true);
    expect(showMessageBoxSync).toHaveBeenCalledTimes(1);
  });

  it("keeps the page when the operator picks Stay", () => {
    showMessageBoxSync.mockReturnValue(1);
    expect(fakeContents().navigate("will-prevent-unload")).toBe(false);
  });
});
