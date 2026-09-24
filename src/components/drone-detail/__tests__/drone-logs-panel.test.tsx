/**
 * @license GPL-3.0-only
 *
 * The right-rail log follows the drone's live protocol: when a reconnect
 * installs a new protocol instance, STATUSTEXT is subscribed on the new one.
 */

import { describe, it, expect, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { render } from "@testing-library/react";

import messages from "../../../../locales/en.json";
import { DroneLogsPanel } from "../DroneLogsPanel";

function fakeProtocol() {
  return { onStatusText: vi.fn(() => () => undefined) };
}

// The store action is stable across renders, as in the real store.
const state = { protocol: fakeProtocol(), getSelectedProtocol: () => state.protocol };

vi.mock("@/stores/drone-manager", () => ({
  useDroneManager: (sel: (s: unknown) => unknown) =>
    sel({
      drones: new Map([["d1", { protocol: state.protocol }]]),
      getSelectedProtocol: state.getSelectedProtocol,
    }),
}));

function panel() {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <DroneLogsPanel droneId="d1" />
    </NextIntlClientProvider>
  );
}

describe("DroneLogsPanel", () => {
  it("subscribes to the new protocol after a reconnect", () => {
    const first = state.protocol;
    const { rerender } = render(panel());
    expect(first.onStatusText).toHaveBeenCalledTimes(1);

    const second = fakeProtocol();
    state.protocol = second;
    rerender(panel());
    expect(second.onStatusText).toHaveBeenCalledTimes(1);
  });
});
