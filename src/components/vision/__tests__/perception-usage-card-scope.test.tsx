/**
 * @license GPL-3.0-only
 *
 * A node with no connection of its own shows neither the attached node's core
 * gauges nor any engine read.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { cleanup, render, screen } from "@testing-library/react";

import messages from "../../../../locales/en.json";

const resolveVisionClient = vi.fn(() => ({ getEngineStatus: vi.fn(() => new Promise(() => {})) }));
vi.mock("@/lib/vision/resolve-vision-client", () => ({
  resolveVisionClient: (...a: unknown[]) => resolveVisionClient(...(a as [])),
}));
vi.mock("@/components/command/shared/SystemResourceGauges", () => ({
  SystemResourceGauges: () => <div data-testid="gauges" />,
  ResourceBar: () => null,
}));

import { useAgentSystemStore } from "@/stores/agent-system-store";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { PerceptionUsageCard } from "../PerceptionUsageCard";

afterEach(() => {
  cleanup();
  resolveVisionClient.mockClear();
});

describe("PerceptionUsageCard scope", () => {
  it("with no connection for this node shows no borrowed gauges or engine", () => {
    useAgentSystemStore.setState({ resources: { cpu_percent: 10 } as never, fetchResources: vi.fn() as never });
    useAgentConnectionStore.setState({ agentUrl: "http://10.0.0.2:8080", apiKey: "k", connected: true });
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PerceptionUsageCard agent={null} />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByTestId("gauges")).toBeNull();
    expect(screen.getByText(messages.vision.coreUsageUnreachable)).toBeTruthy();
    expect(resolveVisionClient).not.toHaveBeenCalled();
  });
});
