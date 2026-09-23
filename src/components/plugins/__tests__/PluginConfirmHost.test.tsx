/**
 * @license GPL-3.0-only
 *
 * The confirm host must settle every request it is handed: two plugin RPCs
 * that ask for confirmation in the same tick each get an answer, one dialog at
 * a time, and neither promise is orphaned.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/components/ui/confirm-dialog", () => ({
  ConfirmDialog: (props: {
    title: string;
    confirmDisabled?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
  }) => (
    <div data-testid="confirm-dialog" data-title={props.title}>
      <button disabled={props.confirmDisabled} onClick={props.onConfirm}>
        approve
      </button>
      <button onClick={props.onCancel}>deny</button>
    </div>
  ),
}));

import { PluginConfirmHost } from "../PluginConfirmHost";
import {
  PLUGIN_CONFIRM_ARM_DELAY_MS,
  requestPluginConfirm,
  type PluginConfirmRequest,
} from "@/lib/plugins/confirm";

function req(pluginId: string, title: string): PluginConfirmRequest {
  return { pluginId, targetName: "drone-1", targetId: "drone-1", title, body: "" };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PluginConfirmHost", () => {
  it("settles both of two requests raised in the same tick", async () => {
    vi.useFakeTimers();
    render(<PluginConfirmHost />);

    let first!: Promise<string>;
    let second!: Promise<string>;
    await act(async () => {
      first = requestPluginConfirm(req("com.example.a", "Arm"));
      second = requestPluginConfirm(req("com.example.b", "Takeoff"));
    });

    expect(screen.getByTestId("confirm-dialog").getAttribute("data-title")).toMatch(/^Arm/);
    await act(async () => {
      vi.advanceTimersByTime(PLUGIN_CONFIRM_ARM_DELAY_MS);
    });
    fireEvent.click(screen.getByText("approve"));
    await expect(first).resolves.toBe("approved");

    await act(async () => {});
    expect(screen.getByTestId("confirm-dialog").getAttribute("data-title")).toMatch(
      /^Takeoff/,
    );
    fireEvent.click(screen.getByText("deny"));
    await expect(second).resolves.toBe("denied");
  });
});
