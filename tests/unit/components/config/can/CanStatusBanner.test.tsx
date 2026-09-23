/**
 * CanStatusBanner: the SLCAN readout follows the live SLCAN session, not the
 * CAN_SLCAN_CPORT routing parameter left behind by an earlier session.
 *
 * @license GPL-3.0-only
 */

import { beforeEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "../../../../helpers/intl-wrapper";
import { useSlcanModeStore } from "@/stores/slcan-mode-store";
import { CanStatusBanner } from "@/components/config/can/CanStatusBanner";

describe("CanStatusBanner", () => {
  beforeEach(() => {
    useSlcanModeStore.getState().reset();
  });

  it("reports SLCAN inactive when only the route parameter is set", () => {
    renderWithIntl(<CanStatusBanner params={new Map([["CAN_SLCAN_CPORT", 1]])} />);
    expect(screen.getByText("Inactive")).toBeDefined();
    expect(screen.getByText("route: CAN1")).toBeDefined();
  });

  it("reports SLCAN active while a session is open", () => {
    useSlcanModeStore.setState({ state: "SLCAN_ACTIVE" });
    renderWithIntl(<CanStatusBanner params={new Map()} />);
    expect(screen.getByText("Active")).toBeDefined();
  });
});
