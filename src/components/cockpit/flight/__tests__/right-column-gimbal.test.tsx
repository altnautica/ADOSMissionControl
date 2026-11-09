/**
 * @license GPL-3.0-only
 *
 * The right column's gimbal pad: shown only while the drone's agent reports
 * it takes gimbal rates (`GET /api/v1/gimbal/rate`), a held press posts the
 * rate and letting go posts a zero.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";

import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";

vi.mock("@/lib/agent/resolve-agent", () => ({
  resolveLocalAgentForDrone: () => ({ agentUrl: "http://agent.test", apiKey: "k" }),
}));

import { RightColumn } from "../RightColumn";
import { FlightGridContext } from "../flight-context";
import { flightGrid } from "../flight-grid";

const grid = flightGrid({ width: 1280, height: 800, widthClass: "expanded" });

let available = true;
const posts: { pitch_dps: number; yaw_dps: number }[] = [];

beforeEach(() => {
  available = true;
  posts.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("http://agent.test/api/v1/gimbal/rate");
      if (init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)));
        return new Response("{}", { status: 200 });
      }
      return new Response(JSON.stringify({ available, reason: available ? null : "no gimbal" }), { status: 200 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderColumn(): Promise<void> {
  renderWithIntl(
    <FlightGridContext.Provider value={grid}>
      <RightColumn droneId="gimbal-drone" />
    </FlightGridContext.Provider>,
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("right column gimbal pad", () => {
  it("is hidden while the agent reports no gimbal rates", async () => {
    available = false;
    await renderColumn();
    expect(screen.queryByTestId("fs-gimbal-pad")).toBeNull();
  });

  it("posts the rate while held and a zero on release", async () => {
    await renderColumn();
    const up = screen.getByTestId("fs-gimbal-up");
    await act(async () => {
      fireEvent.pointerDown(up, { pointerId: 1 });
      await new Promise((r) => setTimeout(r, 0));
    });
    await act(async () => {
      fireEvent.pointerUp(up, { pointerId: 1 });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(posts[0]).toMatchObject({ pitch_dps: 60, yaw_dps: 0 });
    expect(posts.at(-1)).toMatchObject({ pitch_dps: 0, yaw_dps: 0 });
  });
});
