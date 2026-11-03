/**
 * @module settings/mavlink-armed-override.test
 * @description The agent refuses the `mavlink.*` transport and identity keys
 * with 409 `E_ARMED` while the vehicle is armed. Every writer asks the
 * operator once and resends with `force: true`; a declined prompt writes
 * nothing; the FC-source write is resent as a unit.
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { setMavlinkSource } from "@/lib/agent/agent-client/system/mavlink";
import { setConfigValueViaAccess, type ConfigAccess } from "@/lib/agent/config-access";
import { AgentArmedRefusal } from "@/lib/agent/agent-client/transport";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import type { AgentClient } from "@/lib/agent/client";
import { FcSourcePicker } from "../../shared/FcSourcePicker";
import { MavlinkRoutingSection } from "../MavlinkRoutingSection";

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));

const toast = vi.fn();
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("../use-node-direct-agent", () => ({ useNodeDirectAgent: () => null }));

const ARMED = JSON.stringify({ error: "E_ARMED", message: "Vehicle is armed", override: "force" });
const CTX = { baseUrl: "http://agent.test", apiKey: null };
const DEVICE = "dev-1";

/** A fetch that refuses every unforced config write with E_ARMED. */
function armedAgent() {
  const bodies: Record<string, unknown>[] = [];
  const fetch = vi.fn(async (_url: string | URL, init: RequestInit = {}) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    bodies.push(body);
    if (body.force !== true) return new Response(ARMED, { status: 409 });
    return new Response(JSON.stringify({ status: "ok", persisted: true }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetch);
  return bodies;
}

beforeEach(() => {
  toast.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useAgentConnectionStore.setState({ client: null, nodeDeviceId: null, cloudMode: false });
});

describe("setMavlinkSource armed refusal", () => {
  it("stops at the refused first key, then resends every key with force", async () => {
    const bodies = armedAgent();
    const opts = { serialPort: "/dev/ttyAMA0", baudRate: 921600 };
    await expect(setMavlinkSource(CTX, "serial", opts)).rejects.toBeInstanceOf(AgentArmedRefusal);
    // Nothing past the refused source write: no half-applied port/baud.
    expect(bodies).toEqual([{ key: "mavlink.source", value: "serial" }]);

    bodies.length = 0;
    await setMavlinkSource(CTX, "serial", { ...opts, force: true });
    expect(bodies).toEqual([
      { key: "mavlink.source", value: "serial", force: true },
      { key: "mavlink.serial_port", value: "/dev/ttyAMA0", force: true },
      { key: "mavlink.baud_rate", value: "921600", force: true },
    ]);
  });

  it("maps the proxied refusal to AgentArmedRefusal and forwards force", async () => {
    const envelopes: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL, init: RequestInit = {}) => {
        const env = JSON.parse(String(init.body)) as { body: Record<string, unknown> };
        envelopes.push(env.body);
        return env.body.force === true
          ? new Response('{"status":"ok"}', { status: 200 })
          : new Response(ARMED, { status: 409 });
      }),
    );
    const access: ConfigAccess = {
      mode: "proxy",
      target: { host: "http://192.168.1.77:8080" },
    } as ConfigAccess;
    await expect(
      setConfigValueViaAccess(access, "mavlink.system_id", "7"),
    ).rejects.toBeInstanceOf(AgentArmedRefusal);
    await setConfigValueViaAccess(access, "mavlink.system_id", "7", { force: true });
    expect(envelopes).toEqual([
      { key: "mavlink.system_id", value: "7" },
      { key: "mavlink.system_id", value: "7", force: true },
    ]);
  });
});

describe("FcSourcePicker armed override", () => {
  function attachRefusingClient() {
    const setMavlinkSource = vi.fn(async (_s: string, opts?: { force?: boolean }) => {
      if (!opts?.force) throw new AgentArmedRefusal(ARMED);
    });
    useAgentConnectionStore.setState({
      client: {
        getMavlinkPorts: vi.fn().mockResolvedValue([]),
        setMavlinkSource,
      } as unknown as AgentClient,
      nodeDeviceId: DEVICE,
      cloudMode: false,
    });
    return setMavlinkSource;
  }

  it("confirms once and resends the whole source write with force", async () => {
    const write = attachRefusingClient();
    render(<FcSourcePicker nodeDeviceId={DEVICE} />);
    await act(async () => {
      fireEvent.click(screen.getByText("Apply"));
    });
    expect(screen.getByText("message")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByText("confirm"));
    });
    expect(write).toHaveBeenCalledTimes(2);
    const [first, second] = write.mock.calls.map((c) => c[1] as Record<string, unknown>);
    expect(first.force).toBeUndefined();
    expect(second).toEqual({ ...first, force: true });
  });

  it("writes nothing more when the operator cancels", async () => {
    const write = attachRefusingClient();
    render(<FcSourcePicker nodeDeviceId={DEVICE} />);
    await act(async () => {
      fireEvent.click(screen.getByText("Apply"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("cancel"));
    });
    expect(write).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Vehicle is armed")).toBeTruthy();
  });
});

describe("MavlinkRoutingSection armed override", () => {
  function renderSection() {
    const setValue = vi.fn(async (_k: string, _v: string, opts?: { force?: boolean }) => {
      if (!opts?.force) throw new AgentArmedRefusal(ARMED);
    });
    render(
      <MavlinkRoutingSection
        nodeDeviceId={DEVICE}
        profile="drone"
        config={{ mavlink: { system_id: 1, component_id: 191 } }}
        readOnly={false}
        setValue={setValue}
      />,
    );
    fireEvent.change(screen.getByLabelText("systemIdLabel"), { target: { value: "7" } });
    return setValue;
  }

  it("retries the identity write with force after the operator confirms", async () => {
    const setValue = renderSection();
    await act(async () => {
      fireEvent.click(screen.getAllByText("apply")[0]);
    });
    await act(async () => {
      fireEvent.click(screen.getByText("confirm"));
    });
    expect(setValue.mock.calls).toEqual([
      ["mavlink.system_id", "7"],
      ["mavlink.system_id", "7", { force: true }],
    ]);
    expect(toast).toHaveBeenCalledWith("applied", "success");
  });

  it("does not retry on cancel and reports the agent's reason", async () => {
    const setValue = renderSection();
    await act(async () => {
      fireEvent.click(screen.getAllByText("apply")[0]);
    });
    await act(async () => {
      fireEvent.click(screen.getByText("cancel"));
    });
    expect(setValue).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith("Vehicle is armed", "error");
  });
});
