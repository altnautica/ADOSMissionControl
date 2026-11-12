/**
 * @license GPL-3.0-only
 *
 * Settings leads to where a setting is changed and uses the drone's words:
 * the Video page opens the selected drone's Cameras page, and the Settings
 * nav calls the flash page "Firmware" under a plain "Settings" header.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../../locales/en.json";

const push = vi.fn();
const dm = { selectedDroneId: "d1" as string | null };
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/config/video" }));
vi.mock("@/stores/drone-manager", () => ({
  useDroneManager: (sel: (s: unknown) => unknown) => sel(dm),
}));
vi.mock("@/stores/node-registry/use-fleet-drones", () => ({
  useFleetDrones: (sel: (drones: unknown[]) => unknown) => sel([{ id: "d1", name: "Hangar Quad" }]),
}));

import { VideoSection } from "@/components/config/VideoSection";
import { ConfigNav } from "@/components/config/ConfigNav";
import { useUiStore } from "@/stores/ui-store";

function wrap(node: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      {node}
    </NextIntlClientProvider>,
  );
}

describe("Settings › Video", () => {
  beforeEach(() => {
    push.mockReset();
    dm.selectedDroneId = "d1";
  });

  it("opens the selected drone's Cameras page", () => {
    wrap(<VideoSection />);
    fireEvent.click(screen.getByRole("button", { name: en.video.openCameras.replace("{drone}", "Hangar Quad") }));
    const ui = useUiStore.getState();
    expect(ui.pendingDetailTab).toBe("agent");
    expect(ui.pendingAgentPanel).toBe("cameras");
    expect(push).toHaveBeenCalledWith("/");
  });

  it("offers no link without a selected drone", () => {
    dm.selectedDroneId = null;
    wrap(<VideoSection />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("Settings nav words", () => {
  it("names the flash page Firmware under a Settings header", () => {
    wrap(<ConfigNav />);
    expect(screen.getByRole("link", { name: new RegExp(en.configNav.firmware) })).toBeTruthy();
    expect(screen.queryByText("Flash Tool")).toBeNull();
    expect(en.configNav.title).toBe("Settings");
  });
});
