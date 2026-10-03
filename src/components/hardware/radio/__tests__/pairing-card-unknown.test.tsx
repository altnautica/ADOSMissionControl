/**
 * @license GPL-3.0-only
 *
 * The pairing card never reports "not paired" without an answer from the
 * radio. With no pair status (before the first check, or after a failed one)
 * it says the state is unknown, offers a retry, and offers no bind.
 */

import { describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { fireEvent, render, screen } from "@testing-library/react";

import messages from "../../../../../locales/en.json";
import { PairingCard } from "../PairingCard";
import type { PairStatusResponse } from "@/lib/api/ground-station/types";

function renderCard(pairStatus: PairStatusResponse | null, onRetry = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <PairingCard
        pairStatus={pairStatus}
        onRetryPairStatus={onRetry}
        bindSession={null}
        bindBusy={false}
        unpairBusy={false}
        onOpenLocalBind={vi.fn()}
        onUnpair={vi.fn()}
        wfbFailoverState="local"
        onRetryLocal={vi.fn()}
        retryBusy={false}
      />
    </NextIntlClientProvider>,
  );
  return onRetry;
}

describe("PairingCard · unknown pair state", () => {
  it("shows unknown with a retry and no bind when there is no answer", () => {
    const onRetry = renderCard(null);
    expect(screen.getByText("Unknown (last check failed)")).toBeInTheDocument();
    expect(screen.queryByText("Not paired")).toBeNull();
    expect(screen.queryByRole("button", { name: "Open local bind window" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Re-pair (local)" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("offers the bind only once the radio answers unpaired", () => {
    renderCard({ paired: false } as PairStatusResponse);
    expect(screen.getByText("Not paired")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open local bind window" })).toBeInTheDocument();
    expect(screen.queryByText("Unknown (last check failed)")).toBeNull();
  });
});
