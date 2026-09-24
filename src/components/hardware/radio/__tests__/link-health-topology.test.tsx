/**
 * @license GPL-3.0-only
 *
 * The Link card names the radio's power topology only when the radio reported
 * it; an unknown topology is not shown as host VBUS.
 */

import { describe, it, expect } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { render, screen } from "@testing-library/react";

import messages from "../../../../../locales/en.json";
import { LinkHealthCard } from "../LinkHealthCard";
import type { RadioTopology } from "@/lib/api/ground-station/types";

function renderCard(topology: RadioTopology | null) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <LinkHealthCard
        topology={topology}
        linkState="connected"
        showBrownoutWarning={false}
        pollError={null}
        rssiDbm={null}
        bitrateMbps={null}
        channel={null}
        freqMhz={null}
        bandwidthMhz={null}
        fecRecovered={null}
        fecLost={null}
        driver={null}
        iface={null}
      />
    </NextIntlClientProvider>,
  );
}

describe("LinkHealthCard · topology", () => {
  it("shows no topology before the radio reports one", () => {
    renderCard(null);
    expect(screen.queryByText("USB host VBUS")).toBeNull();
  });

  it("names a reported host VBUS topology", () => {
    renderCard("host_vbus");
    expect(screen.getByText("USB host VBUS")).toBeInTheDocument();
  });
});
