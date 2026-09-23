/**
 * @module connect/websocket-panel-sitl.test
 * @description The SITL quick presets point at the bridge's IPv6 loopback
 * listener and cannot connect until the operator pastes the token URL the
 * SITL tool printed: the bridge refuses any connection without `?token=`, and
 * the panel never makes one up.
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("@/hooks/use-convex-skip-query", () => ({
  useConvexSkipQuery: () => undefined,
}));
vi.mock("@/components/connect/BuildPresetPicker", () => ({
  BuildPresetPicker: () => null,
}));

import { WebSocketPanel } from "../WebSocketPanel";

afterEach(cleanup);

function urlInput(): HTMLInputElement {
  return screen.getByLabelText("WebSocket URL");
}

function connectButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: /connect/i });
}

describe("WebSocketPanel SITL presets", () => {
  it("prefills the ::1 port and asks for the printed token URL", () => {
    render(<WebSocketPanel />);

    fireEvent.click(screen.getByRole("button", { name: /SITL #2/ }));

    expect(urlInput().value).toBe("ws://[::1]:5770");
    expect(connectButton().disabled).toBe(true);
    expect(screen.getByText(/Paste that whole URL/)).toBeTruthy();
  });

  it("enables Connect once the token URL is pasted", () => {
    render(<WebSocketPanel />);

    fireEvent.click(screen.getByRole("button", { name: /SITL #1/ }));
    fireEvent.change(urlInput(), {
      target: { value: "ws://[::1]:5760/?token=Vq3exampletoken" },
    });

    expect(connectButton().disabled).toBe(false);
    expect(screen.queryByText(/Paste that whole URL/)).toBeNull();
  });

  it("does not ask for a token on a non-SITL URL", () => {
    render(<WebSocketPanel />);

    expect(urlInput().value).toBe("ws://localhost:14550");
    expect(connectButton().disabled).toBe(false);
    expect(screen.queryByText(/Paste that whole URL/)).toBeNull();
  });
});
