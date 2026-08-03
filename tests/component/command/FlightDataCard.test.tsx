import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { FlightDataCard } from "@/components/command/shared/FlightDataCard";
import messages from "../../../locales/en.json";

describe("FlightDataCard", () => {
  it("renders with empty stores without an infinite render loop", () => {
    // Regression guard (carried over when the FC-link summary was merged in):
    // the prearm-buffer selector must return a STABLE reference (select the
    // buffers map + derive the lines outside the selector via a shared empty
    // constant). A selector that returns a fresh `[]` each render makes
    // useSyncExternalStore fail to cache the snapshot and React throws
    // "Maximum update depth exceeded".
    expect(() =>
      render(
        <NextIntlClientProvider locale="en" messages={messages}>
          <FlightDataCard />
        </NextIntlClientProvider>,
      ),
    ).not.toThrow();
  });
});
