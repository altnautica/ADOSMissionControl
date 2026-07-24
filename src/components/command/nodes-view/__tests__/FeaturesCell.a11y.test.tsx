/**
 * @module command/nodes-view/FeaturesCell.a11y.test
 * @description The Features popover claims a popup, so it honours the contract:
 * the trigger advertises aria-haspopup, opening moves focus into the popover
 * (portaled to document.body), and Escape closes it and returns focus to the
 * trigger. This pins that focus management.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
}));

vi.mock("@/components/features/registry", () => ({
  featuresForProfile: () => [
    {
      id: "vision",
      label: "Vision",
      description: "Onboard vision",
      icon: () => null,
      Row: () => <button type="button">toggle-vision</button>,
    },
  ],
}));

vi.mock("@/stores/node-features-store", () => ({
  useNodeFeaturesStore: (sel: (s: { enabled: Record<string, string[]> }) => unknown) =>
    sel({ enabled: {} }),
}));

vi.mock("@/lib/agent/node-id", () => ({
  nodeIdForDevice: (d: string) => `node:${d}`,
}));

vi.mock("@/components/ui/use-anchored-position", () => ({
  useAnchoredPosition: () => ({ style: {}, compute: vi.fn() }),
}));

vi.mock("../cell-primitives", () => ({
  Chip: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  NEUTRAL_CHIP: "",
  UnknownValue: () => null,
}));

import { FeaturesCell } from "../FeaturesCell";

const node = {
  deviceId: "dev-1",
  name: "Node One",
  profile: "drone",
} as unknown as FleetNodeEntry;

describe("FeaturesCell — popover focus management", () => {
  it("advertises the popup, focuses into it on open, and returns focus on Escape", () => {
    const { container } = render(<FeaturesCell node={node} />);
    const trigger = container.querySelector(
      '[aria-haspopup="dialog"]',
    ) as HTMLButtonElement;

    expect(trigger).toBeTruthy();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    // Open: focus moves into the portaled popover, onto the first toggle.
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).toBeTruthy();
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.textContent).toContain("toggle-vision");

    // Escape closes the popover and returns focus to the trigger.
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
