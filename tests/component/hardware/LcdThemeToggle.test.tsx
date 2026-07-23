/**
 * @module LcdThemeToggle.test
 * @description Verifies the LCD dark / light toggle: store-bound
 * active state, agent client invocation, sync button enable
 * behavior.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "../../helpers/intl-wrapper";

vi.mock("idb-keyval", () => {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn(async (key: string) => store.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(async () => {
      store.clear();
    }),
    keys: vi.fn(async () => Array.from(store.keys())),
    entries: vi.fn(async () => Array.from(store.entries())),
  };
});

vi.mock("lucide-react", () => {
  function makeStub(name: string) {
    function StubIcon(props: Record<string, unknown>) {
      return <span data-testid={`icon-${name}`} {...props} />;
    }
    StubIcon.displayName = `StubIcon(${name})`;
    return StubIcon;
  }
  return {
    __esModule: true,
    Sun: makeStub("Sun"),
    Moon: makeStub("Moon"),
    RefreshCw: makeStub("RefreshCw"),
  };
});

const mockClient = {
  applySetup: vi.fn().mockResolvedValue({ ok: true }),
};

vi.mock("@/stores/agent-connection-store", () => ({
  useAgentConnectionStore: (sel: (s: unknown) => unknown) =>
    sel({ agentUrl: "http://gs-node.local:8080", apiKey: null, client: mockClient }),
}));

const toastFn = vi.fn();
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: toastFn }),
}));

import { LcdThemeToggle } from "@/components/hardware/LcdThemeToggle";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useSettingsStore } from "@/stores/settings-store";

const initialCaps = useAgentCapabilitiesStore.getState();
const initialSettings = useSettingsStore.getState();

beforeEach(() => {
  toastFn.mockClear();
  mockClient.applySetup.mockClear();
  useAgentCapabilitiesStore.setState(
    {
      ...initialCaps,
      loaded: true,
      uiTheme: "dark",
      display: { type: "spi-lcd", hasTouch: true },
    },
    true,
  );
  useSettingsStore.setState({ ...initialSettings, themeMode: "dark" });
});

afterEach(() => {
  useAgentCapabilitiesStore.setState(initialCaps, true);
  useSettingsStore.setState(initialSettings, true);
});

describe("LcdThemeToggle", () => {
  it("highlights the agent's current theme", () => {
    const { container } = renderWithIntl(<LcdThemeToggle />);
    const dark = container.querySelector('[data-mode="dark"]');
    expect(dark?.getAttribute("data-active")).toBe("true");
    const light = container.querySelector('[data-mode="light"]');
    expect(light?.getAttribute("data-active")).toBe("false");
  });

  it("fires applySetup when the operator picks the other theme", async () => {
    renderWithIntl(<LcdThemeToggle />);
    fireEvent.click(screen.getByText("Light"));
    await waitFor(() => {
      expect(mockClient.applySetup).toHaveBeenCalledWith({
        ui: { theme: "light" },
      });
    });
  });

  it("disables the sync button when GCS and agent themes already match", () => {
    renderWithIntl(<LcdThemeToggle />);
    const btn = screen.getByText("Already in sync").closest("button");
    expect(btn?.hasAttribute("disabled")).toBe(true);
  });

  it("enables and labels the sync button when themes diverge", () => {
    useSettingsStore.setState({ ...initialSettings, themeMode: "light" });
    renderWithIntl(<LcdThemeToggle />);
    const btn = screen.getByText("Sync from my GCS").closest("button");
    expect(btn).not.toBeNull();
    expect(btn!.hasAttribute("disabled")).toBe(false);
  });

  it("rolls back the optimistic theme when applySetup rejects", async () => {
    mockClient.applySetup.mockRejectedValueOnce(new Error("boom"));
    const { container } = renderWithIntl(<LcdThemeToggle />);
    fireEvent.click(screen.getByText("Light"));
    await waitFor(() => {
      expect(toastFn).toHaveBeenCalledWith("boom", "error");
    });
    const dark = container.querySelector('[data-mode="dark"]');
    expect(dark?.getAttribute("data-active")).toBe("true");
  });
});
