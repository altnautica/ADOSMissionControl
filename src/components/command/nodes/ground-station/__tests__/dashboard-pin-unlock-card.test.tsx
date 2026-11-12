/**
 * The unpaired ground-station PIN unlock: hidden when Mission Control holds a
 * key, and a correct PIN leaves a held session the ground-station requests use.
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithIntl as render } from "../../../../../../tests/helpers/intl-wrapper";

const direct = vi.hoisted(() => ({
  current: null as { agentUrl: string; apiKey: string | null; client: null } | null,
}));

vi.mock("@/components/command/settings/use-node-direct-agent", () => ({
  useNodeDirectAgent: () => direct.current,
}));

import { DashboardPinUnlockCard } from "../DashboardPinUnlockCard";
import {
  dashboardSessionFor,
  forgetDashboardSession,
} from "@/lib/agent/local-pair/dashboard-session";

const URL = "http://192.168.4.1:8080";

beforeEach(() => {
  forgetDashboardSession(URL);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DashboardPinUnlockCard", () => {
  it("renders nothing when the node is reached with a key", () => {
    direct.current = { agentUrl: URL, apiKey: "k", client: null };
    const { container } = render(<DashboardPinUnlockCard nodeDeviceId="gs-1" />);
    expect(container.textContent).toBe("");
  });

  it("unlocks with the PIN and holds the session", async () => {
    direct.current = { agentUrl: URL, apiKey: null, client: null };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ session: "s-1", expires_at: Date.now() / 1000 + 600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<DashboardPinUnlockCard nodeDeviceId="gs-1" />);
    fireEvent.change(screen.getByLabelText("Dashboard PIN"), { target: { value: "1234" } });
    await act(async () => {
      fireEvent.click(screen.getByText("Unlock"));
    });
    expect(fetchMock.mock.calls[0][0]).toBe(`${URL}/api/dashboard/pin/verify`);
    expect(dashboardSessionFor(URL)).toBe("s-1");
    expect(screen.getByRole("status").textContent).toContain("Unlocked");
  });

  it("shows the node-wide lock copy on 423", async () => {
    direct.current = { agentUrl: URL, apiKey: null, client: null };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "E_PIN_LOCKED", scope: "node", retry_after_s: 120 }), {
          status: 423,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    render(<DashboardPinUnlockCard nodeDeviceId="gs-1" />);
    fireEvent.change(screen.getByLabelText("Dashboard PIN"), { target: { value: "1234" } });
    await act(async () => {
      fireEvent.click(screen.getByText("Unlock"));
    });
    expect(screen.getByRole("alert").textContent).toContain("locked for every device");
  });
});
