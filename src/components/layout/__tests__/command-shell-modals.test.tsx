/**
 * The shell's own modals (welcome, disclaimer, What's New) never open over a
 * mounted flight screen or while a vehicle is armed; they wait, then open.
 *
 * @license GPL-3.0-only
 */

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { stub } = vi.hoisted(() => ({ stub: (name: string) => () => ({ [name]: () => null }) }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/" }));
vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@convex-dev/auth/react", () => ({ useAuthActions: () => ({ signOut: vi.fn() }) }));
vi.mock("@/hooks/use-convex-available", () => ({ useConvexAvailable: () => false }));
vi.mock("@/hooks/use-gcs-location", () => ({ useGcsLocation: () => undefined }));
vi.mock("@/hooks/use-skill-input", () => ({ useSkillInput: () => undefined }));
vi.mock("@/hooks/use-skill-toast-bridge", () => ({ useSkillToastBridge: () => undefined }));
vi.mock("@/lib/skills", () => ({ registerBuiltins: vi.fn(), initSkillSubscriptions: vi.fn() }));
vi.mock("@/components/layout/CommandNav", stub("CommandNav"));
vi.mock("@/components/layout/RightRail", stub("RightRail"));
vi.mock("@/components/layout/ShellBridges", stub("ShellBridges"));
vi.mock("@/components/layout/DesktopUpdateBanner", stub("DesktopUpdateBanner"));
vi.mock("@/components/flight/FailsafeAlertBanner", stub("FailsafeAlertBanner"));
vi.mock("@/components/plugins/PluginCrashBanner", stub("PluginCrashBanner"));
vi.mock("@/components/shared/SlcanModeBanner", stub("SlcanModeBanner"));
vi.mock("@/components/shared/AircraftSetupBanner", stub("AircraftSetupBanner"));
vi.mock("@/components/ui/local-storage-banner", stub("LocalStorageBanner"));
vi.mock("@/components/fc/shared/DisconnectGuard", stub("DisconnectGuard"));
vi.mock("@/components/indicators/ArmedWriteConfirmDialog", stub("ArmedWriteConfirmDialog"));
vi.mock("@/components/changelog/ChangelogBadge", stub("ChangelogBadge"));
vi.mock("@/components/command/MeshToastBridge", stub("MeshToastBridge"));
vi.mock("@/components/command/Px4EventsBridge", stub("Px4EventsBridge"));
vi.mock("@/components/command/RoleBadge", stub("RoleBadge"));
vi.mock("@/components/command/SwarmBeaconBridge", stub("SwarmBeaconBridge"));
vi.mock("@/components/cockpit/SkillConfirmHost", stub("SkillConfirmHost"));
vi.mock("@/components/flight/ChecklistAutoRunner", stub("ChecklistAutoRunner"));
vi.mock("@/components/plugins/PluginConfirmHost", stub("PluginConfirmHost"));
vi.mock("@/components/plugins/PluginNotifierHost", stub("PluginNotifierHost"));
vi.mock("@/components/plugins/FleetNotificationChannelHost", stub("FleetNotificationChannelHost"));
vi.mock("@/components/mcp/watch/McpActivityFeed", stub("McpActivityFeed"));
vi.mock("@/components/mcp/watch/McpAutoNavBridge", stub("McpAutoNavBridge"));
// What's New: opens 1.5 s after it mounts with unseen entries, like the real hook.
vi.mock("@/components/changelog/ChangelogNotificationGate", async () => {
  // vi.mock factories are hoisted above the imports, so React loads here.
  const { useEffect, useState } = await import("react");
  return {
    ChangelogNotificationGate: () => {
      const [open, setOpen] = useState(false);
      useEffect(() => {
        const t = setTimeout(() => setOpen(true), 1500);
        return () => clearTimeout(t);
      }, []);
      return open ? <div data-testid="whats-new" /> : null;
    },
  };
});

import { CommandShell } from "../CommandShell";
import { useFlightScreenStore } from "@/stores/flight-screen-store";
import { useNodeRegistryStore } from "@/stores/node-registry/node-registry-store";

function setArmed(armed: boolean) {
  useNodeRegistryStore.setState({
    nodes: { d1: { fc: { armState: armed ? "armed" : "disarmed" } } } as never,
  });
}

describe("shell modals over a flight screen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useFlightScreenStore.setState({ mounted: 0 });
  });
  afterEach(() => {
    vi.useRealTimers();
    useNodeRegistryStore.setState({ nodes: {} });
  });

  it("holds What's New while armed on the flight screen, then opens it after disarm and leaving", () => {
    setArmed(true);
    useFlightScreenStore.setState({ mounted: 1 });
    render(<CommandShell>body</CommandShell>);
    act(() => void vi.advanceTimersByTime(2000));
    expect(screen.queryByTestId("whats-new")).toBeNull();

    act(() => setArmed(false));
    act(() => void vi.advanceTimersByTime(2000));
    expect(screen.queryByTestId("whats-new")).toBeNull();

    act(() => useFlightScreenStore.setState({ mounted: 0 }));
    act(() => void vi.advanceTimersByTime(2000));
    expect(screen.getByTestId("whats-new")).toBeTruthy();
  });

  it("holds it while any vehicle is armed even off the flight screen", () => {
    setArmed(true);
    render(<CommandShell>body</CommandShell>);
    act(() => void vi.advanceTimersByTime(2000));
    expect(screen.queryByTestId("whats-new")).toBeNull();
  });
});
