/**
 * @module plugins/parameters/PluginParametersPanel.test
 * @description Status-honesty tests for the plugin parameter panel. The agent
 * exposes a config write but no config read-back, so a `plugin.config` value
 * the GCS cannot confirm is the drone's live setting must be badged as a
 * default — never presented as a verified reading. A confirmed value (passed
 * in `values`) renders without the badge; a successful commit promotes the
 * value to confirmed and clears the badge; a failed write rolls the value back
 * AND re-shows the badge.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import type { ParsedParameterContribution } from "@/lib/plugins/parameters/parse";

const { writeMock, toastMock, reachMock, getLocaleMock } = vi.hoisted(() => ({
  writeMock: vi.fn<
    (input: {
      droneId: string;
      pluginId: string;
      key: string;
      value: unknown;
    }) => Promise<boolean>
  >(),
  toastMock: vi.fn(),
  reachMock: vi.fn<(droneId: string) => unknown>(() => null),
  getLocaleMock: vi.fn<(pluginId: string, lang: string) => Promise<Record<string, string> | null>>(),
}));

vi.mock("@/lib/plugins/node-agent-reach", () => ({
  resolveNodeAgentReach: reachMock,
  pluginClientForReach: () => ({
    getConfig: () => Promise.reject(new Error("unreachable")),
    getLocale: getLocaleMock,
  }),
}));

vi.mock("@/lib/skills/plugin-config-writer", () => ({
  writePluginConfigValue: writeMock,
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

// ParameterControl mounts the heavy vision ModelPicker for the model widgets;
// stub it so the panel test stays focused (no model widgets used here anyway).
vi.mock("@/components/vision/ModelPicker", () => ({
  ModelPicker: () => null,
}));

import { PluginParametersPanel } from "../PluginParametersPanel";
import { resetPluginLocaleCache } from "@/lib/plugins/plugin-locale";
import enMessages from "../../../../../locales/en.json";

const DEFAULT_NOTE = enMessages.plugins.parameters.unconfirmedDefault;

function numberParam(): ParsedParameterContribution {
  return {
    key: "follow_distance_m",
    schema: { type: "number", minimum: 1, maximum: 30, default: 8 },
    binding: "plugin.config",
    ui: { label: "Follow distance" },
  };
}

function detectorParam(): ParsedParameterContribution {
  return {
    key: "detector",
    schema: { type: "string", default: "" },
    binding: "engine.detector",
    ui: { label: "Detector", widget: "model" },
  };
}

function renderPanel(
  parameters: ParsedParameterContribution[],
  values?: Record<string, string | number | boolean>,
  locale = "en",
) {
  return render(
    <NextIntlClientProvider locale={locale} messages={enMessages}>
      <PluginParametersPanel
        droneId="drone-1"
        pluginId="com.example.followme"
        parameters={parameters}
        values={values}
      />
    </NextIntlClientProvider>,
  );
}

function groupedParam(group: string): ParsedParameterContribution {
  return { ...numberParam(), ui: { label: "Follow distance", group } };
}

describe("PluginParametersPanel — group headings", () => {
  beforeEach(() => {
    resetPluginLocaleCache();
    getLocaleMock.mockReset();
    reachMock.mockReturnValue({ hostUrl: "http://node.example.com:8080", apiKey: "k", peerDeviceId: null });
  });

  it("resolves the group through the plugin's locale bundle", async () => {
    getLocaleMock.mockResolvedValue({ "settings.title": "Settings" });
    renderPanel([groupedParam("settings.title")]);
    expect(await screen.findByText("Settings")).toBeTruthy();
    expect(screen.queryByText("settings.title")).toBeNull();
    expect(getLocaleMock).toHaveBeenCalledWith("com.example.followme", "en");
  });

  it("falls back to the en bundle when the active language has none", async () => {
    getLocaleMock.mockImplementation(async (_id, lang) =>
      lang === "en" ? { "settings.title": "Settings" } : null,
    );
    renderPanel([groupedParam("settings.title")], undefined, "de");
    expect(await screen.findByText("Settings")).toBeTruthy();
    expect(getLocaleMock.mock.calls.map((c) => c[1])).toEqual(["de", "en"]);
  });

  it("shows the raw group only when the bundle has no entry for it", async () => {
    getLocaleMock.mockResolvedValue({ "other.key": "Other" });
    renderPanel([groupedParam("Limits")]);
    await waitFor(() => expect(getLocaleMock).toHaveBeenCalled());
    expect(screen.getByText("Limits")).toBeTruthy();
  });

  it("keeps the raw group when the agent cannot serve the bundle", async () => {
    getLocaleMock.mockRejectedValue(new Error("offline"));
    renderPanel([groupedParam("settings.title")]);
    await waitFor(() => expect(getLocaleMock).toHaveBeenCalled());
    expect(screen.getByText("settings.title")).toBeTruthy();
  });
});

describe("PluginParametersPanel — status honesty", () => {
  beforeEach(() => {
    writeMock.mockReset();
    toastMock.mockReset();
    reachMock.mockReturnValue(null);
  });

  it("writes nothing when a field is focused and left without an edit", () => {
    renderPanel([numberParam()]);
    const input = screen.getByLabelText("Follow distance");
    fireEvent.focus(input);
    fireEvent.blur(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(writeMock).not.toHaveBeenCalled();
    // The value is still an unconfirmed default.
    expect(screen.getByText(DEFAULT_NOTE)).toBeTruthy();
  });

  it("badges a plugin.config value as a default when no confirmed value exists", () => {
    renderPanel([numberParam()]);
    // The input shows the schema default...
    expect(
      (screen.getByRole("spinbutton") as HTMLInputElement).value,
    ).toBe("8");
    // ...and is honestly badged as a default, not a live reading.
    expect(screen.getByText(DEFAULT_NOTE)).toBeTruthy();
  });

  it("does not badge a value the caller confirmed via `values`", () => {
    renderPanel([numberParam()], { follow_distance_m: 12 });
    expect(
      (screen.getByRole("spinbutton") as HTMLInputElement).value,
    ).toBe("12");
    expect(screen.queryByText(DEFAULT_NOTE)).toBeNull();
  });

  it("does not badge an engine.detector parameter (it reads its own live model)", () => {
    renderPanel([detectorParam()]);
    expect(screen.queryByText(DEFAULT_NOTE)).toBeNull();
  });

  it("clears the badge after a successful commit (the value is now live)", async () => {
    writeMock.mockResolvedValue(true);
    renderPanel([numberParam()]);
    expect(screen.getByText(DEFAULT_NOTE)).toBeTruthy();

    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "15" } });
    fireEvent.blur(input);

    await waitFor(() => expect(writeMock).toHaveBeenCalledTimes(1));
    expect(writeMock).toHaveBeenCalledWith({
      droneId: "drone-1",
      pluginId: "com.example.followme",
      key: "follow_distance_m",
      value: 15,
    });
    await waitFor(() => expect(screen.queryByText(DEFAULT_NOTE)).toBeNull());
  });

  it("rolls back the value AND re-shows the badge when the write fails", async () => {
    writeMock.mockResolvedValue(false);
    renderPanel([numberParam()]);

    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "15" } });
    fireEvent.blur(input);

    await waitFor(() => expect(writeMock).toHaveBeenCalledTimes(1));
    // Value reverts to the default and the unconfirmed badge returns.
    await waitFor(() => expect(input.value).toBe("8"));
    expect(screen.getByText(DEFAULT_NOTE)).toBeTruthy();
    expect(toastMock).toHaveBeenCalledTimes(1);
  });
});

describe("PluginParametersPanel — plugin locale words", () => {
  beforeEach(() => {
    resetPluginLocaleCache();
    getLocaleMock.mockReset();
    reachMock.mockReturnValue({ hostUrl: "http://node.example.com:8080", apiKey: "k", peerDeviceId: null });
  });

  it("labels controls and enum options from the plugin bundle", async () => {
    getLocaleMock.mockResolvedValue({
      "settings.followMode": "Follow mode",
      "follow_mode.orbit": "Orbit",
    });
    renderPanel([
      {
        key: "follow_mode",
        schema: { type: "string", enum: ["follow", "orbit"], default: "orbit" },
        binding: "plugin.config",
        ui: { label: "settings.followMode" },
      },
    ]);
    expect(await screen.findByText("Follow mode")).toBeTruthy();
    expect(screen.queryByText("settings.followMode")).toBeNull();
    // The selected option shows its bundle word, not the raw value.
    expect(screen.getAllByText("Orbit").length).toBeGreaterThan(0);
  });

  it("shows the host notes in the app language, not hard-coded English", () => {
    reachMock.mockReturnValue(null);
    render(
      <NextIntlClientProvider locale="de" messages={{ plugins: { parameters: { unconfirmedDefault: "Standard" } } }}>
        <PluginParametersPanel droneId="drone-1" pluginId="com.example.followme" parameters={[numberParam()]} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Standard")).toBeTruthy();
  });
});
