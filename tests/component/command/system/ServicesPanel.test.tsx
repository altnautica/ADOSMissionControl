/**
 * Render smoke test for ServicesPanel.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi } from "vitest";
import { renderWithIntl as render } from "../../../helpers/intl-wrapper";

vi.mock("@/stores/agent-system-store", () => ({
  useAgentSystemStore: (sel: (s: unknown) => unknown) =>
    sel({
      services: [],
      resources: null,
      restartService: vi.fn(),
    }),
}));

vi.mock("@/components/command/shared/ServiceTable", () => ({
  ServiceTable: () => <div data-testid="service-table" />,
}));

vi.mock("@/components/command/system/shared", () => ({
  CollapsibleSection: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <section data-testid="collapsible" data-title={title}>
      {children}
    </section>
  ),
}));

import { ServicesPanel } from "@/components/command/system/ServicesPanel";

describe("ServicesPanel", () => {
  it("renders the Services section with empty state copy", () => {
    const { getByTestId, getByText } = render(<ServicesPanel />);
    expect(getByTestId("collapsible").getAttribute("data-title")).toBe("Services");
    expect(getByText(/No service data available/i)).toBeTruthy();
  });
});
