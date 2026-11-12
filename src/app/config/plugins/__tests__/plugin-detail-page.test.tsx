/**
 * @license GPL-3.0-only
 *
 * A drone-bound plugin install is changed on that drone's agent first; when
 * that agent is not the attached one, nothing is written (the cloud record
 * must not drift from what the drone runs).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { render, screen, fireEvent, act } from "@testing-library/react";

import messages from "../../../../../locales/en.json";
import PluginDetailPage from "../[id]/page";

const toast = vi.fn();
const removeMutation = vi.fn(async () => undefined);
const agentRemove = vi.fn(async () => undefined);
const node = { attached: false };

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "install-1" }),
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("convex/react", () => ({ useMutation: () => removeMutation }));
const installQuery: { state: "ready" | "skipped" | "error" | "loading" } = { state: "ready" };
const INSTALL = {
  install: {
    name: "Thermal",
    version: "1.0.0",
    pluginId: "com.example.thermal",
    droneId: "dev-1",
    status: "enabled",
    source: "registry",
    halves: ["agent"],
    installedAt: 0,
    manifestHash: "abcdef0123456789abcdef",
  },
  permissions: [],
};
vi.mock("@/hooks/use-convex-skip-query", () => ({
  useConvexSkipQuery: () => undefined,
  useConvexSkipQueryState: () =>
    installQuery.state === "ready"
      ? { data: INSTALL, state: "ready" }
      : { data: undefined, state: installQuery.state },
}));
vi.mock("@/components/command/settings/use-node-direct-agent", () => ({
  useNodeDirectAgent: () =>
    node.attached ? { agentUrl: "http://192.168.1.50:8080", apiKey: "k", client: null } : null,
}));
vi.mock("@/lib/agent/plugin-client", () => ({
  PluginAgentClient: class {
    remove = agentRemove;
  },
}));
const lanRows: { current: Array<{ plugin_id: string; failure_reason?: string | null }> | null } = {
  current: null,
};
vi.mock("@/hooks/use-node-plugin-list", () => ({
  useNodePluginList: (deviceId: string | null) => (deviceId === "dev-1" ? lanRows.current : null),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast }) }));

async function removeViaDialog() {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <PluginDetailPage />
    </NextIntlClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  const buttons = screen.getAllByRole("button", { name: "Remove" });
  await act(async () => {
    fireEvent.click(buttons[buttons.length - 1]);
  });
}

describe("PluginDetailPage · remove", () => {
  beforeEach(() => {
    toast.mockReset();
    removeMutation.mockClear();
    agentRemove.mockClear();
  });

  it("removes nothing when the install's drone agent is not attached", async () => {
    node.attached = false;
    await removeViaDialog();
    expect(removeMutation).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(messages.plugins.needsNodeAgent, "error");
  });

  it("removes on the drone first, then the cloud record", async () => {
    node.attached = true;
    await removeViaDialog();
    expect(agentRemove).toHaveBeenCalledWith("com.example.thermal");
    expect(removeMutation).toHaveBeenCalledTimes(1);
  });
});

describe("PluginDetailPage · failure reason", () => {
  function renderPage() {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PluginDetailPage />
      </NextIntlClientProvider>,
    );
  }

  it("shows the reason the node stopped the plugin", () => {
    lanRows.current = [
      { plugin_id: "com.example.other", failure_reason: "signer_revoked" },
      { plugin_id: "com.example.thermal", failure_reason: "tampered: agent/x.py digest mismatch" },
    ];
    renderPage();
    expect(screen.getByText(messages.plugins.detail.field.failureReason)).toBeTruthy();
    expect(screen.getByText("tampered: agent/x.py digest mismatch")).toBeTruthy();
    expect(screen.queryByText("signer_revoked")).toBeNull();
  });

  it("shows no reason row for a plugin that has not failed", () => {
    lanRows.current = [{ plugin_id: "com.example.thermal", failure_reason: null }];
    renderPage();
    expect(screen.queryByText(messages.plugins.detail.field.failureReason)).toBeNull();
  });
});

describe("PluginDetailPage without cloud data", () => {
  it.each(["skipped", "error"] as const)("a %s query shows not found with the back link, not Loading", (state) => {
    installQuery.state = state;
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PluginDetailPage />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByText(messages.plugins.detail.loading)).toBeNull();
    expect(screen.getByText(messages.plugins.detail.notFound)).toBeTruthy();
    installQuery.state = "ready";
  });
});
