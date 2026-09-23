/**
 * A service restart never fires on one click: it asks first, warns when the
 * vehicle is armed and the unit carries its link, and reports the agent's
 * answer (success, refusal, or a cloud-queued send) instead of staying silent.
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";

const toast = vi.fn();
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast }),
}));

import { renderWithIntl } from "../../../helpers/intl-wrapper";
import { ServiceTable } from "@/components/command/shared/ServiceTable";
import { useAgentConnectionStore } from "@/stores/agent-connection";
import { useNodeRegistryStore } from "@/stores/node-registry";
import type { ServiceInfo } from "@/lib/agent/types";

const SERVICES = [
  { name: "ados-mavlink", status: "running", uptime_seconds: 10 },
  { name: "ados-logd", status: "running", uptime_seconds: 10 },
] as ServiceInfo[];

function setArmed(armed: boolean) {
  useAgentConnectionStore.setState({ nodeDeviceId: "dev-1" });
  useNodeRegistryStore.setState({
    nodes: { "node:dev-1": { fc: { armState: armed ? "armed" : "disarmed" } } } as never,
  });
}

afterEach(() => {
  toast.mockClear();
  useAgentConnectionStore.setState({ nodeDeviceId: null });
  useNodeRegistryStore.setState({ nodes: {} });
});

describe("ServiceTable restart", () => {
  it("asks before restarting and warns when the vehicle is armed and the unit is link-critical", async () => {
    setArmed(true);
    const onRestart = vi.fn(async () => "Restarted ados-mavlink");
    renderWithIntl(<ServiceTable services={SERVICES} onRestart={onRestart} />);

    fireEvent.click(screen.getByLabelText("Restart ados-mavlink"));
    expect(onRestart).not.toHaveBeenCalled();
    expect(screen.getByText(/The vehicle is armed/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    });
    expect(onRestart).toHaveBeenCalledWith("ados-mavlink");
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Restarted ados-mavlink", "success"));
  });

  it("does not warn about the flight link for a unit that does not carry it", () => {
    setArmed(true);
    renderWithIntl(<ServiceTable services={SERVICES} onRestart={vi.fn(async () => null)} />);
    fireEvent.click(screen.getByLabelText("Restart ados-logd"));
    expect(screen.queryByText(/The vehicle is armed/)).toBeNull();
  });

  it("reports a refused restart and a cloud-queued one", async () => {
    setArmed(false);
    const onRestart = vi
      .fn<(name: string) => Promise<string | null>>()
      .mockRejectedValueOnce(new Error("Unknown service"))
      .mockResolvedValueOnce(null);
    renderWithIntl(<ServiceTable services={SERVICES} onRestart={onRestart} />);

    fireEvent.click(screen.getByLabelText("Restart ados-logd"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    });
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Unknown service", "error"));

    fireEvent.click(screen.getByLabelText("Restart ados-logd"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    });
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.stringContaining("sent over the cloud relay"), "info"),
    );
  });
});
