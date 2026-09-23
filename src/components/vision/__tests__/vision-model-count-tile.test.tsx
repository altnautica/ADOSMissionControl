import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";

import { VisionModelCountTile } from "@/components/vision/VisionModelCountTile";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useVisionDetectionsStore } from "@/stores/vision-detections-store";
import messages from "../../../../locales/en.json";

describe("VisionModelCountTile", () => {
  beforeEach(() => {
    useVisionDetectionsStore.getState().clear();
    // No LAN client: the engine status cannot be read.
    useAgentConnectionStore.setState({ agentUrl: null, apiKey: null });
  });
  afterEach(cleanup);

  it("shows unknown counts, not zeros, when the engine status is unavailable", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <VisionModelCountTile droneId="node:d1" />
      </NextIntlClientProvider>,
    );
    expect(screen.getAllByText("—")).toHaveLength(3);
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.getByText(messages.vision.engineStatusUnavailable)).toBeTruthy();
  });
});
