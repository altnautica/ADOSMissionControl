/**
 * The coarse link-state vocabulary, pinned end to end.
 *
 * A state the normalizer does not recognise is clamped to "absent" — a node
 * reporting a real link would render as having no radio at all. A state with
 * no label renders as a raw key, and a state with no tone renders in whatever
 * colour the last branch happened to return. So every state the radio can
 * report is checked here for all three.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { normalizeRadio } from "@/stores/agent-capabilities/normalizer";
import {
  linkStateLabel,
  linkStateTone,
  linkStateBadgeClass,
  linkStateReach,
} from "@/components/hardware/radio/labels";
import type { RadioLinkState } from "@/lib/api/ground-station/types";

/** Every state the radio itself reports. "absent" is this app's own sentinel. */
const AGENT_STATES: readonly RadioLinkState[] = [
  "disconnected",
  "unpaired",
  "auto_pairing",
  "binding",
  "connecting",
  "connected",
  "degraded",
  "rf_unverified",
];

const ALL_STATES: readonly RadioLinkState[] = ["absent", ...AGENT_STATES];

const EN = JSON.parse(
  readFileSync(resolve(__dirname, "../../locales/en.json"), "utf-8"),
) as Record<string, never>;

/** Stand-in for the next-intl hook, scoped to the "hardware.radio" namespace. */
function radioT(key: string): string {
  const parts = ["hardware", "radio", ...key.split(".")];
  let node: unknown = EN;
  for (const part of parts) {
    if (node === null || typeof node !== "object") return "";
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : "";
}

const t = radioT as unknown as Parameters<typeof linkStateLabel>[0];

describe("radio link-state vocabulary", () => {
  it("the radio reports eight states", () => {
    expect(AGENT_STATES).toHaveLength(8);
  });

  it("the normalizer keeps every state the radio reports", () => {
    for (const state of AGENT_STATES) {
      expect(normalizeRadio({ state })!.state, state).toBe(state);
    }
  });

  it("clamps a state outside the vocabulary rather than inventing one", () => {
    expect(normalizeRadio({ state: "warp" })!.state).toBe("absent");
    expect(normalizeRadio({})!.state).toBe("absent");
  });

  it("every state has a translated label", () => {
    for (const state of ALL_STATES) {
      const label = linkStateLabel(t, state);
      expect(label, state).toBeTruthy();
      // A missing catalogue entry would surface the key itself.
      expect(label, state).not.toContain("linkState.");
    }
  });

  it("renders an out-of-contract state verbatim instead of a bare key", () => {
    expect(linkStateLabel(t, "warp" as RadioLinkState)).toBe("warp");
  });

  it("every state has a tone and a badge class", () => {
    for (const state of ALL_STATES) {
      expect(["success", "warning", "error", "muted"], state).toContain(
        linkStateTone(state),
      );
      expect(linkStateBadgeClass(state), state).toBeTruthy();
    }
  });

  it("reads a transmitting-but-unproven link as neither healthy nor dead", () => {
    // Success would claim the link works; error would claim the radio is
    // silent. Frames are leaving the driver with nothing proving they landed.
    expect(linkStateTone("rf_unverified")).toBe("warning");
    expect(linkStateTone("rf_unverified")).not.toBe(
      linkStateTone("connected"),
    );
    expect(linkStateTone("rf_unverified")).not.toBe(
      linkStateTone("disconnected"),
    );
  });

  it("keeps connected the only state that reads as healthy", () => {
    const healthy = ALL_STATES.filter((s) => linkStateTone(s) === "success");
    expect(healthy).toEqual(["connected"]);
  });
});

describe("link reach classification", () => {
  it("classifies every state", () => {
    const byState = Object.fromEntries(
      ALL_STATES.map((s) => [s, linkStateReach(s)]),
    );
    expect(byState).toEqual({
      absent: "down",
      disconnected: "down",
      unpaired: "down",
      auto_pairing: "down",
      binding: "down",
      connecting: "down",
      connected: "up",
      degraded: "up",
      rf_unverified: "unproven",
    });
  });

  it("refuses to fold a transmitting-but-unproven link into up or down", () => {
    // "down" would report a running transmitter as silent; "up" would report
    // an unproven path as working. It has to be its own answer.
    expect(linkStateReach("rf_unverified")).not.toBe(
      linkStateReach("connected"),
    );
    expect(linkStateReach("rf_unverified")).not.toBe(
      linkStateReach("disconnected"),
    );
  });

  it("treats a state outside the vocabulary as down, never as up", () => {
    expect(linkStateReach("warp" as RadioLinkState)).toBe("down");
  });
});
