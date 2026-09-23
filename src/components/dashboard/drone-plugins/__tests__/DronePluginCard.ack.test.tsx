/**
 * @license GPL-3.0-only
 *
 * Behavior tests for the cloud command-ACK handling in DronePluginCard.
 *
 * The card enqueues a `plugin.enable` / `plugin.disable` / `plugin.uninstall`
 * command and then waits for the agent's ACK before changing the local
 * install state. These tests assert the honest contract:
 *
 *   - a `completed` ACK flips the install state (setStatus / removeInstall)
 *     and shows a success toast,
 *   - a `failed` ACK surfaces the agent's failure message and DOES NOT flip
 *     the install state — a no-op never renders as success.
 *
 * The Convex query that watches the command row is mocked through
 * `useConvexSkipQuery`, and the mutations are recorders.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { render, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import messages from "../../../../../locales/en.json";

vi.mock("lucide-react", () => {
  const stub = (name: string) =>
    function StubIcon(props: Record<string, unknown>) {
      return <span data-testid={`icon-${name}`} {...props} />;
    };
  return {
    __esModule: true,
    MoreHorizontal: stub("MoreHorizontal"),
    Settings: stub("Settings"),
    Trash2: stub("Trash2"),
    FileText: stub("FileText"),
    ShieldCheck: stub("ShieldCheck"),
    ShieldAlert: stub("ShieldAlert"),
    AlertTriangle: stub("AlertTriangle"),
    AlertOctagon: stub("AlertOctagon"),
    Power: stub("Power"),
    RotateCw: stub("RotateCw"),
    BadgeCheck: stub("BadgeCheck"),
    CheckCircle2: stub("CheckCircle2"),
    Code2: stub("Code2"),
    PackageOpen: stub("PackageOpen"),
    ShieldOff: stub("ShieldOff"),
    Star: stub("Star"),
    Loader2: stub("Loader2"),
    X: stub("X"),
  };
});

vi.mock("next/link", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// ── Controllable command-row + mutation/toast recorders ────

// The command row the card's ACK watcher sees. Mutating this between
// renders simulates the agent acking the command.
let commandRow: {
  _id: string;
  status: "pending" | "delivering" | "completed" | "failed";
  result?: { success: boolean; message: string };
} | null = null;

const enqueueCommand =
  vi.fn(async (_args: { deviceId: string; command: string; args?: unknown }) => ({
    commandId: "cmd-1",
  }));
const setStatus =
  vi.fn(async (_args: { installId: string; status: string }) => null);
const removeInstall = vi.fn(async (_args: { installId: string }) => null);
const toast = vi.fn();

// The card builds three mutations; route each to its recorder by the
// function reference it was constructed with (order-independent across
// renders and component instances).
vi.mock("convex/react", () => ({
  useMutation: (ref: unknown) => {
    let name = "";
    try {
      name = getFunctionName(ref as Parameters<typeof getFunctionName>[0]);
    } catch {
      name = "";
    }
    if (name.includes("setStatus")) return setStatus;
    if (name.includes("removeInstall")) return removeInstall;
    return enqueueCommand;
  },
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast }),
}));

vi.mock("@/hooks/use-convex-skip-query", () => ({
  useConvexSkipQuery: (_query: unknown, opts?: { enabled?: boolean }) =>
    opts?.enabled ? commandRow : undefined,
}));

import { DronePluginCard, type DronePluginCardData } from "../DronePluginCard";

function makeInstall(
  overrides: Partial<DronePluginCardData> = {},
): DronePluginCardData {
  return {
    installId: "install-1",
    deviceId: "device-1",
    pluginId: "com.example.alpha",
    version: "1.0.0",
    name: "Example Alpha",
    source: "local_file",
    signerId: "example-2026-A",
    status: "disabled",
    halves: ["agent", "gcs"],
    ...overrides,
  };
}

function renderCard(install: DronePluginCardData) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DronePluginCard install={install} />
    </NextIntlClientProvider>,
  );
}

describe("DronePluginCard cloud command ACK", () => {
  beforeEach(() => {
    commandRow = null;
    enqueueCommand.mockClear();
    setStatus.mockClear();
    removeInstall.mockClear();
    toast.mockClear();
    cleanup();
  });

  it("flips the install state on a completed enable ACK", async () => {
    const { getByText, rerender } = renderCard(makeInstall({ status: "disabled" }));

    fireEvent.click(getByText("Enable"));
    await waitFor(() => expect(enqueueCommand).toHaveBeenCalledTimes(1));
    expect(enqueueCommand.mock.calls[0][0]).toMatchObject({
      command: "plugin.enable",
      deviceId: "device-1",
    });
    // The local state must NOT flip before the agent acks.
    expect(setStatus).not.toHaveBeenCalled();

    // Agent acks success → the card commits the enable.
    commandRow = { _id: "cmd-1", status: "completed", result: { success: true, message: "ok" } };
    rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <DronePluginCard install={makeInstall({ status: "disabled" })} />
      </NextIntlClientProvider>,
    );

    await waitFor(() => expect(setStatus).toHaveBeenCalledTimes(1));
    expect(setStatus.mock.calls[0][0]).toMatchObject({ status: "enabled" });
    expect(toast).toHaveBeenCalledWith("Example Alpha enabled", "success");
  });

  it("surfaces the failure and does not flip state on a failed enable ACK", async () => {
    const { getByText, rerender } = renderCard(makeInstall({ status: "disabled" }));

    fireEvent.click(getByText("Enable"));
    await waitFor(() => expect(enqueueCommand).toHaveBeenCalledTimes(1));
    expect(setStatus).not.toHaveBeenCalled();

    // Agent acks failure → the card must NOT commit the enable, and must
    // surface the agent's message as an error.
    commandRow = {
      _id: "cmd-1",
      status: "failed",
      result: { success: false, message: "not implemented: plugin.enable" },
    };
    rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <DronePluginCard install={makeInstall({ status: "disabled" })} />
      </NextIntlClientProvider>,
    );

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        "Enable failed: not implemented: plugin.enable",
        "error",
      ),
    );
    expect(setStatus).not.toHaveBeenCalled();
    expect(removeInstall).not.toHaveBeenCalled();
  });

  it("falls back to a generic reason when a failed ACK carries no message", async () => {
    const { getByText, rerender } = renderCard(makeInstall({ status: "running" }));

    fireEvent.click(getByText("Disable"));
    await waitFor(() => expect(enqueueCommand).toHaveBeenCalledTimes(1));
    expect(enqueueCommand.mock.calls[0][0]).toMatchObject({
      command: "plugin.disable",
    });

    commandRow = { _id: "cmd-1", status: "failed" };
    rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <DronePluginCard install={makeInstall({ status: "running" })} />
      </NextIntlClientProvider>,
    );

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        "Disable failed: the agent rejected the command",
        "error",
      ),
    );
    expect(setStatus).not.toHaveBeenCalled();
  });

  it("reports success for an agent-reported row without touching the cloud record", async () => {
    const install = makeInstall({ installId: "agent:com.example.alpha", status: "disabled" });
    const { getByText, queryByText, rerender } = renderCard(install);
    // No cloud install record, so no cloud configure page either.
    expect(queryByText("Configure")).toBeNull();

    fireEvent.click(getByText("Enable"));
    await waitFor(() => expect(enqueueCommand).toHaveBeenCalledTimes(1));

    commandRow = { _id: "cmd-1", status: "completed", result: { success: true, message: "ok" } };
    rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <DronePluginCard install={install} />
      </NextIntlClientProvider>,
    );

    await waitFor(() => expect(toast).toHaveBeenCalledWith("Example Alpha enabled", "success"));
    expect(setStatus).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalledWith(expect.stringContaining("failed"), "error");
  });
});
