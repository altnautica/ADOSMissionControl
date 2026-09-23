import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isDemoMode } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings-store";

describe("isDemoMode", () => {
  const originalEnv = process.env.NEXT_PUBLIC_DEMO_MODE;

  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    useSettingsStore.setState({ _hasHydrated: false, demoMode: false });
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_DEMO_MODE = originalEnv;
    window.history.replaceState({}, "", "/");
  });

  it("follows the settings toggle off once hydrated, even on a demo build", () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    useSettingsStore.setState({ _hasHydrated: true, demoMode: false });
    expect(isDemoMode()).toBe(false);
  });

  it("follows the settings toggle on once hydrated, with no env or URL seed", () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "false";
    useSettingsStore.setState({ _hasHydrated: true, demoMode: true });
    expect(isDemoMode()).toBe(true);
  });

  it("uses the env and URL seeds before the settings store hydrates", () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "false";
    expect(isDemoMode()).toBe(false);
    window.history.replaceState({}, "", "/?demo=true");
    expect(isDemoMode()).toBe(true);
  });
});
