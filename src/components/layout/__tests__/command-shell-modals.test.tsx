/**
 * The shell's own modals (welcome, disclaimer, What's New) never open over a
 * mounted flight screen or while a vehicle is armed; they wait, then open.
 * The seeded demo fleet does not hold them, and a vehicle whose link drops
 * while armed keeps holding them for the link-lost window.
 *
 * @license GPL-3.0-only
 */

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { stub } = vi.hoisted(() => ({ stub: (name: string) => () => ({ [name]: () => null }) }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/" }));
vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));
// `next/dynamic` loads the real (mocked below) module and renders it once the
// import settles, so each lazily loaded shell piece shows as its own marker.
vi.mock("next/dynamic", async () => {
  // vi.mock factories are hoisted above the imports, so React loads here.
  const { useEffect, useState } = await import("react");
  return {
    default: (load: () => Promise<React.ComponentType<Record<string, unknown>>>) =>
      function Dynamic(props: Record<string, unknown>) {
        const [C, setC] = useState<React.ComponentType<Record<string, unknown>> | null>(null);
        useEffect(() => {
          let live = true;
          void load().then((c) => live && setC(() => c));
          return () => {
            live = false;
          };
        }, []);
        return C ? <C {...props} /> : null;
      },
  };
});
vi.mock("@/components/shared/command-palette", () => ({ CommandPalette: () => <div data-testid="palette" /> }));
vi.mock("@/components/auth/SignInModal", () => ({ SignInModal: () => null }));
vi.mock("@/components/connect/ConnectDialog", () => ({ ConnectDialog: () => null }));
vi.mock("@/components/onboarding/WelcomeModal", () => ({ WelcomeModal: () => <div data-testid="welcome" /> }));
vi.mock("@/components/onboarding/DisclaimerGate", () => ({ DisclaimerGate: () => <div data-testid="disclaimer" /> }));
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

// Load the lazily imported (mocked) modules up front, so a later dynamic
// import of each resolves within the test's act scope.
import "@/components/shared/command-palette";
import "@/components/onboarding/WelcomeModal";
import "@/components/onboarding/DisclaimerGate";
import { CommandShell } from "../CommandShell";
import { inertShellAround } from "@/components/cockpit/flight/inert-shell";
import { DISCLAIMER_VERSION } from "@/components/onboarding/constants";
import { ARMED_LINK_LOST_HOLD_MS } from "@/hooks/use-shell-modals-allowed";
import { clearDemoVehicles } from "@/lib/demo/demo-vehicles";
import { seedDemoNodes } from "@/mock/engine-seed";
import { useFlightScreenStore } from "@/stores/flight-screen-store";
import { useNodeRegistryStore } from "@/stores/node-registry/node-registry-store";
import { useSettingsStore } from "@/stores/settings-store";

function setArmed(armed: boolean) {
  useNodeRegistryStore.setState({
    nodes: { d1: { fc: { armState: armed ? "armed" : "disarmed" } } } as never,
  });
}

function setArmState(armState: "armed" | "unknown", lastHeartbeat: number) {
  useNodeRegistryStore.setState({
    nodes: { d1: { fc: { managedId: "d1", armState, lastHeartbeat } } } as never,
  });
}

/** Hydrated settings: a first run (Welcome) or an onboarded user who has not
 * accepted the current disclaimer. */
function settings(s: "first-run" | "disclaimer-due" | "settled") {
  useSettingsStore.setState({
    _hasHydrated: true,
    onboarded: s !== "first-run",
    disclaimerAccepted: s === "settled",
    disclaimerVersion: s === "settled" ? DISCLAIMER_VERSION : 0,
  });
}

/** Let the lazily loaded modals' imports settle and render. */
async function settle() {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await vi.dynamicImportSettled();
    });
  }
}

describe("shell modals over a flight screen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useFlightScreenStore.setState({ mounted: 0 });
    settings("settled");
  });
  afterEach(() => {
    vi.useRealTimers();
    useNodeRegistryStore.setState({ nodes: {} });
    clearDemoVehicles();
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

  it("leaves Ctrl+K to the cockpit palette while the flight screen is open", async () => {
    useFlightScreenStore.setState({ mounted: 1 });
    const { unmount } = render(<CommandShell>body</CommandShell>);
    await settle();
    expect(screen.queryByTestId("palette")).toBeNull();
    unmount();
    useFlightScreenStore.setState({ mounted: 0 });
    render(<CommandShell>body</CommandShell>);
    await settle();
    expect(screen.getByTestId("palette")).toBeTruthy();
  });

  it("holds Welcome while armed, then shows it once disarmed", async () => {
    settings("first-run");
    setArmed(true);
    render(<CommandShell>body</CommandShell>);
    await settle();
    expect(screen.queryByTestId("welcome")).toBeNull();

    act(() => setArmed(false));
    await settle();
    expect(screen.getByTestId("welcome")).toBeTruthy();
    expect(screen.queryByTestId("disclaimer")).toBeNull();
  });

  it("holds the Disclaimer on the flight screen, then shows it after leaving", async () => {
    settings("disclaimer-due");
    useFlightScreenStore.setState({ mounted: 1 });
    render(<CommandShell>body</CommandShell>);
    await settle();
    expect(screen.queryByTestId("disclaimer")).toBeNull();

    act(() => useFlightScreenStore.setState({ mounted: 0 }));
    await settle();
    expect(screen.getByTestId("disclaimer")).toBeTruthy();
    expect(screen.queryByTestId("welcome")).toBeNull();
  });

  it("waits for settings to hydrate before Welcome", async () => {
    useSettingsStore.setState({ _hasHydrated: false, onboarded: false });
    render(<CommandShell>body</CommandShell>);
    await settle();
    expect(screen.queryByTestId("welcome")).toBeNull();
    // The persisted store's setState returns its storage write; keep it out of act.
    act(() => {
      useSettingsStore.setState({ _hasHydrated: true });
    });
    await settle();
    expect(screen.getByTestId("welcome")).toBeTruthy();
  });

  it("does not let the seeded demo fleet hold Welcome or What's New", async () => {
    settings("first-run");
    seedDemoNodes(Date.now());
    const armed = Object.values(useNodeRegistryStore.getState().nodes).filter((n) => n.fc.armState === "armed");
    expect(armed.length).toBeGreaterThan(0);
    render(<CommandShell>body</CommandShell>);
    await settle();
    act(() => void vi.advanceTimersByTime(2000));
    expect(screen.getByTestId("welcome")).toBeTruthy();
    expect(screen.getByTestId("whats-new")).toBeTruthy();
  });

  it("still holds them for a demo vehicle while its flight screen is open", async () => {
    settings("first-run");
    seedDemoNodes(Date.now());
    useFlightScreenStore.setState({ mounted: 1 });
    render(<CommandShell>body</CommandShell>);
    await settle();
    act(() => void vi.advanceTimersByTime(2000));
    expect(screen.queryByTestId("welcome")).toBeNull();
    expect(screen.queryByTestId("whats-new")).toBeNull();
  });

  it("keeps holding What's New when an armed vehicle's link drops, until the link-lost window ends", async () => {
    const at = Date.now();
    setArmState("armed", at);
    render(<CommandShell>body</CommandShell>);
    // Link loss: the registry writes "unknown" and keeps the last heartbeat.
    act(() => setArmState("unknown", at));
    act(() => void vi.advanceTimersByTime(2000));
    expect(screen.queryByTestId("whats-new")).toBeNull();

    act(() => void vi.advanceTimersByTime(ARMED_LINK_LOST_HOLD_MS));
    act(() => void vi.advanceTimersByTime(2000));
    expect(screen.getByTestId("whats-new")).toBeTruthy();
  });

  it("does not hold for an unknown arm state never seen armed", () => {
    setArmState("unknown", Date.now());
    render(<CommandShell>body</CommandShell>);
    act(() => void vi.advanceTimersByTime(2000));
    expect(screen.getByTestId("whats-new")).toBeTruthy();
  });

  it("makes the real shell inert around a flight screen, including a banner that mounts later", async () => {
    render(
      <CommandShell>
        <div data-testid="frame">flight</div>
      </CommandShell>,
    );
    const frame = screen.getByTestId("frame");
    const restore = inertShellAround(frame);
    expect(document.querySelector("header")?.hasAttribute("inert")).toBe(true);
    expect(frame.hasAttribute("inert")).toBe(false);
    expect(frame.closest("[inert]")).toBeNull();

    const late = document.createElement("div");
    frame.parentElement!.prepend(late);
    await act(async () => {
      vi.useRealTimers();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(late.hasAttribute("inert")).toBe(true);
    restore();
    expect(document.querySelector("header")?.hasAttribute("inert")).toBe(false);
  });
});
