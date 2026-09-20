/**
 * The custom-basemap editor's observable contract: an unusable template blocks
 * the apply path with a reason, and applying a usable one is what actually
 * switches `mapTileSource` to "custom".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

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
    createStore: vi.fn(() => ({})),
  };
});

import { CustomTileSourceEditor } from "@/components/map/CustomTileSourceEditor";
import { useSettingsStore } from "@/stores/settings-store";

const SELF_HOSTED =
  "https://localhost/tileserver/tileserver.php?/index.json?/world_countries/{z}/{x}/{y}.png";

describe("CustomTileSourceEditor", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      mapTileSource: "satellite",
      customTileUrl: "",
      customTileMaxZoom: 19,
      customTileAttribution: "",
    });
  });

  it("blocks apply and names the missing placeholder", () => {
    render(<CustomTileSourceEditor />);
    fireEvent.change(screen.getByLabelText("Tile URL template"), {
      target: { value: "https://h/{z}/{x}.png" },
    });
    expect(screen.getByText("Tile URL must contain {y}.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Use this map" })).toHaveProperty("disabled", true);
    expect(useSettingsStore.getState().mapTileSource).toBe("satellite");
  });

  it("applying a usable template selects the custom basemap", () => {
    render(<CustomTileSourceEditor />);
    fireEvent.change(screen.getByLabelText("Tile URL template"), {
      target: { value: SELF_HOSTED },
    });
    const apply = screen.getByRole("button", { name: "Use this map" });
    expect(apply).toHaveProperty("disabled", false);
    fireEvent.click(apply);
    const s = useSettingsStore.getState();
    expect(s.mapTileSource).toBe("custom");
    expect(s.customTileUrl).toBe(SELF_HOSTED);
  });

  it("disables apply when the persisted source already matches the draft", () => {
    useSettingsStore.setState({ mapTileSource: "custom", customTileUrl: SELF_HOSTED });
    render(<CustomTileSourceEditor />);
    expect(screen.getByRole("button", { name: "Use this map" })).toHaveProperty("disabled", true);
  });
});
