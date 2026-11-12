import { describe, it, expect, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import {
  PluginHostProvider,
  type PluginSlotContribution,
} from "@/components/plugins/PluginHostProvider";
import { PluginSlot } from "@/components/plugins/PluginSlot";
import { slotToCapability } from "@/lib/plugins/types";

interface SlottedContribution extends PluginSlotContribution {
  slot: "node.detail.tab" | "hardware.tab" | "fc.tab";  // any subset of PluginSlotName
}

function mkContribution(
  pluginId: string,
  panelId: string,
  slot: SlottedContribution["slot"],
  caps?: ReadonlyArray<string>,
): SlottedContribution {
  // The slot orchestrator drops contributions that lack the slot's
  // matching ui.slot.<id> capability. Default fixtures grant it so
  // each test can opt into denial by passing an explicit empty list.
  const grants = caps ?? [slotToCapability(slot)];
  return {
    pluginId,
    panelId,
    slot,
    bundleUrl: `blob:${pluginId}/${panelId}`,
    grantedCapabilities: new Set(grants),
    handlers: {},
  };
}

describe("PluginHostProvider + PluginSlot", () => {
  it("renders the empty state when no contribution targets the slot", () => {
    const { container } = render(
      <PluginHostProvider contributions={[]}>
        <PluginSlot
          name="node.detail.tab"
          emptyState={<span data-testid="empty">none</span>}
        />
      </PluginHostProvider>,
    );
    expect(container.querySelector('[data-testid="empty"]')).not.toBeNull();
    expect(container.querySelector("[data-plugin-slot]")).toBeNull();
    cleanup();
  });

  it("groups contributions by slot and mounts an iframe per entry", () => {
    const contributions: SlottedContribution[] = [
      mkContribution("com.example.alpha", "main", "node.detail.tab"),
      mkContribution("com.example.beta", "main", "node.detail.tab"),
      mkContribution("com.example.gamma", "tab", "fc.tab"),
    ];
    const { container } = render(
      <PluginHostProvider contributions={contributions}>
        <PluginSlot name="node.detail.tab" />
        <PluginSlot name="fc.tab" />
        <PluginSlot
          name="hardware.tab"
          emptyState={<span data-testid="empty">none</span>}
        />
      </PluginHostProvider>,
    );
    const slots = container.querySelectorAll("[data-plugin-slot]");
    expect(slots.length).toBe(2);
    const left = container.querySelector(
      '[data-plugin-slot="node.detail.tab"]',
    ) as HTMLElement;
    expect(left.querySelectorAll("iframe").length).toBe(2);
    const fc = container.querySelector(
      '[data-plugin-slot="fc.tab"]',
    ) as HTMLElement;
    expect(fc.querySelectorAll("iframe").length).toBe(1);
    expect(container.querySelector('[data-testid="empty"]')).not.toBeNull();
    cleanup();
  });

  it("propagates plugin id and slot to iframe data attributes", () => {
    const contributions: SlottedContribution[] = [
      mkContribution("com.example.alpha", "main", "node.detail.tab"),
    ];
    const { container } = render(
      <PluginHostProvider contributions={contributions}>
        <PluginSlot name="node.detail.tab" />
      </PluginHostProvider>,
    );
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    expect(iframe.getAttribute("data-plugin-id")).toBe("com.example.alpha");
    expect(iframe.getAttribute("data-slot")).toBe("node.detail.tab");
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
    cleanup();
  });

  it("explicit contributions prop overrides the provider", () => {
    const explicit: PluginSlotContribution[] = [
      {
        pluginId: "com.example.explicit",
        panelId: "panel-a",
        bundleUrl: "blob:explicit/a",
        grantedCapabilities: new Set([slotToCapability("node.detail.tab")]),
        handlers: {},
      },
    ];
    const fromProvider: SlottedContribution[] = [
      mkContribution("com.example.alpha", "main", "node.detail.tab"),
    ];
    const { container } = render(
      <PluginHostProvider contributions={fromProvider}>
        <PluginSlot name="node.detail.tab" contributions={explicit} />
      </PluginHostProvider>,
    );
    const ids = Array.from(container.querySelectorAll("iframe")).map((f) =>
      f.getAttribute("data-plugin-id"),
    );
    expect(ids).toEqual(["com.example.explicit"]);
    cleanup();
  });

  it("drops contributions that lack the slot capability", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const contributions: SlottedContribution[] = [
      mkContribution("com.example.granted", "main", "node.detail.tab"),
      mkContribution("com.example.denied", "main", "node.detail.tab", []),
    ];
    const { container } = render(
      <PluginHostProvider contributions={contributions}>
        <PluginSlot name="node.detail.tab" />
      </PluginHostProvider>,
    );
    const ids = Array.from(container.querySelectorAll("iframe")).map((f) =>
      f.getAttribute("data-plugin-id"),
    );
    expect(ids).toEqual(["com.example.granted"]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("com.example.denied"),
    );
    warn.mockRestore();
    cleanup();
  });

  it("PluginSlot without a provider still renders the empty state", () => {
    const { container } = render(
      <PluginSlot
        name="node.detail.tab"
        emptyState={<span data-testid="empty">none</span>}
      />,
    );
    expect(container.querySelector('[data-testid="empty"]')).not.toBeNull();
    cleanup();
  });
});

describe("PluginSlot iframe load state", () => {
  it("shows a loading line instead of an empty iframe while the bundle loads", () => {
    const c = { ...mkContribution("com.example.alpha", "main", "node.detail.tab"), bundleUrl: "", frame: { status: "loading" as const } };
    const { container, getByRole } = render(
      <PluginHostProvider contributions={[c]}>
        <PluginSlot name="node.detail.tab" />
      </PluginHostProvider>,
    );
    expect(container.querySelector("iframe")).toBeNull();
    expect(getByRole("status").textContent).toBe("inlineLoading");
    cleanup();
  });

  it("shows the failure with a retry when the bundle fails", () => {
    const retry = vi.fn();
    const c = {
      ...mkContribution("com.example.alpha", "main", "node.detail.tab"),
      bundleUrl: "",
      frame: { status: "error" as const, message: "timed out", retry },
    };
    const { container, getByRole } = render(
      <PluginHostProvider contributions={[c]}>
        <PluginSlot name="node.detail.tab" />
      </PluginHostProvider>,
    );
    expect(container.querySelector("iframe")).toBeNull();
    const alert = getByRole("alert");
    alert.querySelector("button")!.click();
    expect(retry).toHaveBeenCalledTimes(1);
    cleanup();
  });
});
