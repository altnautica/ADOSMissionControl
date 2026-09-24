/**
 * The diagnostics panel turns on frame hex logging for the selected link only
 * while the Frames tab is open, and moves it with the selection.
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { selectTestProtocol } from "../helpers/selected-drone";
import { DiagnosticsPanel } from "@/components/diagnostics/DiagnosticsPanel";

vi.mock("@/components/diagnostics/EventTimeline", () => ({ EventTimeline: () => null }));
vi.mock("@/components/diagnostics/MessageRatePanel", () => ({ MessageRatePanel: () => null }));
vi.mock("@/components/diagnostics/DiagnosticsExport", () => ({ DiagnosticsExport: () => null }));
vi.mock("@/components/diagnostics/FrameInspector", () => ({ FrameInspector: () => null }));
vi.mock("@/components/diagnostics/CommandQueuePanel", () => ({ CommandQueuePanel: () => null }));
vi.mock("@/components/diagnostics/RingBufferPanel", () => ({ RingBufferPanel: () => null }));
vi.mock("@/components/diagnostics/PerformancePanel", () => ({ PerformancePanel: () => null }));

afterEach(() => selectTestProtocol(null));

describe("DiagnosticsPanel frame logging", () => {
  it("follows a drone switch while the Frames tab is open", () => {
    const first = { diagnosticsEnabled: false };
    const second = { diagnosticsEnabled: false };
    selectTestProtocol(first, {}, "d1");
    render(<DiagnosticsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /frames/i }));
    expect(first.diagnosticsEnabled).toBe(true);

    act(() => selectTestProtocol(second, {}, "d2"));
    expect(second.diagnosticsEnabled).toBe(true);
    expect(first.diagnosticsEnabled).toBe(false);
  });

  it("enables logging on a link that connects after the tab opened", () => {
    selectTestProtocol(null);
    render(<DiagnosticsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /frames/i }));

    const late = { diagnosticsEnabled: false };
    act(() => selectTestProtocol(late));
    expect(late.diagnosticsEnabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /timeline/i }));
    expect(late.diagnosticsEnabled).toBe(false);
  });
});
