/**
 * The shared behaviour case files (chip, status pill, refusal texts, tips,
 * Fly here routes, readout formats, nav-source chip) run against Mission
 * Control's copies of the shared HUD modules, so this surface computes
 * exactly what every other cockpit computes.
 *
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";

import chipCases from "../fixtures/chip-cases.json";
import pillCases from "../fixtures/pill-cases.json";
import refusalCases from "../fixtures/refusal-cases.json";
import tipsCases from "../fixtures/tips-cases.json";
import flyHereCases from "../fixtures/fly-here-cases.json";
import readoutCases from "../fixtures/readout-cases.json";
import flightStateJson from "@/lib/cockpit-spec/flight-state.json";
import tokensJson from "@/lib/cockpit-spec/tokens.json";
import { parsePilotState, type ArFrame } from "../cockpit-frames";
import { chipInputs } from "../chip-inputs";
import { flightStateChip } from "../flight-state";
import { pillAlerts, pillSummary, type PillInputs } from "../status-pill";
import { refusalText } from "../refusal";
import { nextTip, placeTip, type TipRect, type TipsContext } from "../tips";
import { flyHereOffered } from "../fly-here-offer";
import navSourceCases from "../fixtures/nav-source-cases.json";
import { navSourceTextEn, resolveNavSource } from "../nav-source";
import { parseNavState } from "../nav-types";
import { navSourceText } from "@/components/cockpit/nav-source-text";
import { countdownS, fmtDistance, fmtSigned1 } from "../format";

describe("chip cases", () => {
  const colors = tokensJson.state as Record<string, string>;

  it("covers every chip rule", () => {
    const covered = new Set(chipCases.map((c) => c.expected.rule));
    expect(flightStateJson.rules.filter((r) => !covered.has(r.id)).map((r) => r.id)).toEqual([]);
  });

  for (const c of chipCases) {
    it(c.name, () => {
      const i = c.input;
      const p = parsePilotState(i.pilot);
      expect(p).not.toBeNull();
      const arFrame: ArFrame | null =
        i.ar_eta_s === null ? null : ({ cameras: { c: { items: [{ t: "wp", role: "next", etaS: i.ar_eta_s }] } } } as unknown as ArFrame);
      const v = flightStateChip(
        chipInputs(p!, i.pilot_age_ms, 0, {
          homeDistM: i.home_dist_m,
          localPos: i.local_pos,
          arFrame,
          arAgeMs: 0,
          modeDetail: i.mode_detail,
          completeAgeMs: i.complete_age_ms,
          speed: null,
        }),
      );
      expect({
        rule: v.ruleId,
        text: v.text,
        color: v.color,
        dim: v.dim,
        button: v.button,
        secondary: v.secondary.map((s) => s.text),
      }).toEqual({ ...c.expected, color: colors[c.expected.color] });
    });
  }
});

describe("pill cases", () => {
  for (const c of pillCases) {
    it(c.name, () => {
      const i = c.input;
      const alerts = pillAlerts({
        alerts: i.alerts as PillInputs["alerts"],
        readiness: i.readiness as PillInputs["readiness"],
        prearm: i.prearm ?? undefined,
        storagePct: i.storage_pct,
        fcStatus: i.fc_status.map((s) => ({ severity: s.severity, text: s.text, ageMs: s.age_ms })),
        pilotAgeMs: i.pilot_age_ms,
        agentReachable: i.agent_reachable,
        controllerLost: i.controller_lost,
        preflightFailing: i.preflight_failing,
        fcFailsafe: (i as { fc_failsafe?: boolean }).fc_failsafe,
        failsafeCause: (i as { failsafe_cause?: string | null }).failsafe_cause,
        setupAbort: (i as { setup_abort?: string | null }).setup_abort,
        armed: (i as { armed?: boolean | null }).armed,
        navSource: (i as { nav_source?: PillInputs["navSource"] }).nav_source,
        lowBatteryAction: (i as { low_battery_action?: string | null }).low_battery_action,
      });
      const s = pillSummary(alerts, new Set());
      expect({ severity: s.severity, text: s.text, count: s.count, ids: alerts.map((a) => a.id) }).toEqual(c.expected);
    });
  }
});

describe("refusal cases", () => {
  for (const c of refusalCases) {
    it(c.name, () => {
      expect(refusalText(c.input.code)).toBe(c.expected.text);
    });
  }
});

describe("tips cases", () => {
  // A case with `input.place` checks placement; every other case the queue.
  for (const c of tipsCases) {
    it(c.name, () => {
      const i = c.input as {
        place?: { anchor: TipRect; tip: { w: number; h: number }; viewport: TipRect; avoid: TipRect[] };
        state: Parameters<typeof nextTip>[0];
        ctx: TipsContext;
        now_ms: number;
      };
      if (i.place) {
        expect(placeTip(i.place.anchor, i.place.tip, i.place.viewport, i.place.avoid)).toEqual(c.expected);
      } else {
        expect(nextTip(i.state, i.ctx, i.now_ms)).toEqual(c.expected);
      }
    });
  }
});

describe("fly here cases", () => {
  for (const c of flyHereCases) {
    it(c.name, () => {
      const p = c.input.pilot === null ? null : parsePilotState(c.input.pilot);
      if (c.input.pilot !== null) expect(p).not.toBeNull();
      expect(flyHereOffered(p, c.input.pilot_age_ms, c.input.fc)).toEqual(c.expected);
    });
  }
});

describe("readout cases", () => {
  const fns: Record<string, (v: number | null) => string | number> = {
    fmtSigned1,
    fmtDistance,
    countdownS: (v) => countdownS(v ?? 0),
  };
  for (const c of readoutCases) {
    it(c.name, () => {
      expect(Object.keys(fns)).toContain(c.input.fn);
      expect(fns[c.input.fn](c.input.v)).toBe(c.expected);
    });
  }
});

describe("nav source cases", () => {
  type Case = {
    name: string;
    input: {
      ekf_flags: number;
      ekf_age_ms?: number;
      params?: Record<string, number>;
      gps?: { fix_type: number; satellites?: number; hdop?: number };
      nav?: Record<string, unknown>;
      position_unverified?: { reason: string; detail?: string };
    };
    expected: { label: string; word: string | null; tone: string };
  };
  for (const c of navSourceCases as Case[]) {
    it(c.name, () => {
      const i = c.input;
      const r = resolveNavSource({
        ekf: { flags: i.ekf_flags, ageMs: i.ekf_age_ms ?? 100 },
        gps: i.gps ? { fixType: i.gps.fix_type, satellites: i.gps.satellites, hdop: i.gps.hdop } : null,
        nav: i.nav ? parseNavState(i.nav) : null,
        lastCommandedSet: null,
        params: i.params ?? null,
        positionUnverified: i.position_unverified
          ? { reason: i.position_unverified.reason, detail: i.position_unverified.detail ?? null }
          : null,
      });
      expect({ ...navSourceTextEn(r), tone: r.tone }).toEqual(c.expected);
      // The chip draws the spec text in capitals.
      const shown = navSourceText(r);
      expect({ label: shown.label.toUpperCase(), word: shown.word?.toUpperCase() ?? null, tone: r.tone }).toEqual(
        c.expected,
      );
    });
  }
});
