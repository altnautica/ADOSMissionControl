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

import type { ParsedParameterContribution } from "@/lib/plugins/parameters/parse";

const { writeMock, toastMock } = vi.hoisted(() => ({
  writeMock: vi.fn<
    (input: {
      droneId: string;
      pluginId: string;
      key: string;
      value: unknown;
    }) => Promise<boolean>
  >(),
  toastMock: vi.fn(),
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

const DEFAULT_NOTE = "Default — not read from drone";

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
) {
  return render(
    <PluginParametersPanel
      droneId="drone-1"
      pluginId="com.example.followme"
      parameters={parameters}
      values={values}
    />,
  );
}

describe("PluginParametersPanel — status honesty", () => {
  beforeEach(() => {
    writeMock.mockReset();
    toastMock.mockReset();
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
