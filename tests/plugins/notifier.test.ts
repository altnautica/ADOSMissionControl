import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PLUGIN_NOTIFY_BURST,
  PLUGIN_NOTIFY_WINDOW_MS,
  pluginNotify,
  setPluginNotifier,
} from "@/lib/plugins/notifier";

afterEach(() => {
  setPluginNotifier(null);
  vi.useRealTimers();
});

describe("plugin notifier", () => {
  it("is a no-op when no notifier is wired", () => {
    expect(() => pluginNotify("com.example.a", "hi", "info")).not.toThrow();
  });

  it("forwards the plugin id with the message and status", () => {
    const spy = vi.fn();
    setPluginNotifier(spy);
    pluginNotify("com.example.a", "done", "success");
    expect(spy).toHaveBeenCalledWith("com.example.a", "done", "success");
  });

  it("stops forwarding after unwire", () => {
    const spy = vi.fn();
    setPluginNotifier(spy);
    setPluginNotifier(null);
    pluginNotify("com.example.a", "x", "error");
    expect(spy).not.toHaveBeenCalled();
  });

  it("drops a plugin's notifications past its burst budget until the window passes", () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    setPluginNotifier(spy);
    for (let i = 0; i < PLUGIN_NOTIFY_BURST; i++) {
      expect(pluginNotify("com.example.loud", `m${i}`, "error")).toBe(true);
    }
    expect(pluginNotify("com.example.loud", "flood", "error")).toBe(false);
    // Another plugin keeps its own budget.
    expect(pluginNotify("com.example.quiet", "hello", "info")).toBe(true);
    expect(spy).toHaveBeenCalledTimes(PLUGIN_NOTIFY_BURST + 1);

    vi.advanceTimersByTime(PLUGIN_NOTIFY_WINDOW_MS);
    expect(pluginNotify("com.example.loud", "later", "info")).toBe(true);
  });
});
