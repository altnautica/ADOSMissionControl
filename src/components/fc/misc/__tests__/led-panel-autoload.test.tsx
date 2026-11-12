/**
 * The LED panel reads its parameters on open, like the other Setup panels,
 * so its toggles never show defaults the vehicle does not hold.
 */

import { describe, it, expect, vi } from "vitest";
import { renderWithIntl as render } from "../../../../../tests/helpers/intl-wrapper";

const STOP = new Error("panel-state-captured");
const panelState = vi.fn((opts: { autoLoad?: boolean; panelId: string }) => {
  void opts;
  throw STOP;
});
vi.mock("@/hooks/use-fc-panel-state", () => ({
  useFcPanelState: (o: { autoLoad?: boolean; panelId: string }) => panelState(o),
}));

import { LedPanel } from "../LedPanel";

describe("LedPanel", () => {
  it("auto-loads its parameters when it opens", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<LedPanel />)).toThrow(STOP);
    spy.mockRestore();
    expect(panelState).toHaveBeenCalled();
    expect(panelState.mock.calls[0][0]).toMatchObject({ panelId: "led", autoLoad: true });
  });
});
