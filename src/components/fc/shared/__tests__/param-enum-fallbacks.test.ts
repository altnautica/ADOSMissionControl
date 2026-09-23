/**
 * The FC panels render enum params from the vehicle's param metadata, with the
 * tables in param-enum-fallbacks.json as the floor while metadata is absent.
 * A floor that disagrees with the firmware writes the wrong number (an E-stop
 * switch that selects Precision Loiter, a Plane low-battery "RTL" that lands),
 * so every table is cross-checked value-for-value and label-for-label against
 * the bundled metadata snapshots in public/param-metadata.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  PARAM_ENUM_FALLBACKS, fallbackParamKey, fallbackTable, resolveParamEnum, resolveParamBitmask,
} from "../param-enum-fallbacks";
import { GNSS_BIT } from "../../sensors/GnssConstellationEditor";
import type { ParamMetadata } from "@/lib/protocol/param-metadata";

type Entries = [number, string][];
interface SnapParam { name: string; values?: Entries; bitmask?: Entries }

const AP_VEHICLES = ["ardupilot-copter", "ardupilot-plane", "ardupilot-rover", "ardupilot-sub"] as const;

function loadSnapshot(key: string): Map<string, SnapParam> {
  const file = join(process.cwd(), "public", "param-metadata", `${key}.json.gz`);
  const snap = JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as { params: SnapParam[] };
  return new Map(snap.params.map((p) => [p.name, p]));
}

const SNAPSHOTS = new Map<string, Map<string, SnapParam>>(
  [...AP_VEHICLES, "px4"].map((k) => [k, loadSnapshot(k)]),
);

/** Vehicles whose metadata a scope's tables must match. */
function vehiclesFor(scope: string): string[] {
  return scope === "ardupilot" ? [...AP_VEHICLES] : [scope];
}

describe("param enum fallback tables", () => {
  const scopes = Object.entries(PARAM_ENUM_FALLBACKS);

  it("covers every scope the panels resolve", () => {
    expect(Object.keys(PARAM_ENUM_FALLBACKS).sort()).toEqual(["ardupilot", ...AP_VEHICLES, "px4"].sort());
  });

  for (const [scope, tables] of scopes) {
    for (const kind of ["values", "bitmask"] as const) {
      for (const [name, entries] of Object.entries(tables[kind] ?? {})) {
        it(`${scope} ${kind} ${name} matches the firmware metadata`, () => {
          let checked = 0;
          for (const vehicle of vehiclesFor(scope)) {
            const meta = SNAPSHOTS.get(vehicle)!.get(name);
            // A library param the vehicle does not build (e.g. TERRAIN_ENABLE
            // on Rover) is simply absent there.
            if (scope === "ardupilot" && !meta) continue;
            expect(meta, `${name} missing from ${vehicle} metadata`).toBeDefined();
            expect(entries).toEqual(meta![kind]);
            checked++;
          }
          expect(checked).toBeGreaterThan(0);
        });
      }
    }
  }

  it("collapses instanced params only onto a representative with an identical table", () => {
    const families: Record<string, string[]> = {
      RC1_OPTION: Array.from({ length: 16 }, (_, i) => `RC${i + 1}_OPTION`),
      SERIAL1_PROTOCOL: Array.from({ length: 9 }, (_, i) => `SERIAL${i + 1}_PROTOCOL`),
      SERIAL1_BAUD: Array.from({ length: 10 }, (_, i) => `SERIAL${i}_BAUD`),
      RNGFND1_TYPE: [..."123456789A"].map((n) => `RNGFND${n}_TYPE`),
      RNGFND1_ORIENT: [..."123456789A"].map((n) => `RNGFND${n}_ORIENT`),
      BATT_FS_LOW_ACT: ["BATT_FS_LOW_ACT", ...[..."23456789"].map((n) => `BATT${n}_FS_LOW_ACT`)],
      BATT_FS_CRT_ACT: ["BATT_FS_CRT_ACT", "BATT2_FS_CRT_ACT"],
    };
    for (const vehicle of AP_VEHICLES) {
      const snap = SNAPSHOTS.get(vehicle)!;
      for (const [rep, members] of Object.entries(families)) {
        for (const member of members) {
          expect(fallbackParamKey(member)).toBe(rep);
          const meta = snap.get(member);
          if (meta) expect(meta.values, `${vehicle} ${member}`).toEqual(snap.get(rep)!.values);
        }
      }
    }
    // The USB console port takes only the MAVLink values, so it is not collapsed.
    expect(fallbackParamKey("SERIAL0_PROTOCOL")).toBe("SERIAL0_PROTOCOL");
  });

  it("pins the GNSS constellation bits the presets are built from", () => {
    const bits = new Map(SNAPSHOTS.get("ardupilot-copter")!.get("GPS_GNSS_MODE")!.bitmask);
    expect(bits.get(GNSS_BIT.GPS)).toBe("GPS");
    expect(bits.get(GNSS_BIT.GALILEO)).toBe("Galileo");
    expect(bits.get(GNSS_BIT.BEIDOU)).toBe("Beidou");
    expect(bits.get(GNSS_BIT.QZSS)).toBe("QZSS");
    expect(bits.get(GNSS_BIT.GLONASS)).toBe("GLONASS");
    expect(1 << GNSS_BIT.GLONASS).toBe(64);
  });
});

describe("RCx_OPTION safety functions", () => {
  // The kill/interlock/brake switches are the ones an operator reaches for in
  // an emergency; a wrong number here silently selects another function.
  const copter = fallbackTable("values", "RC7_OPTION", "ardupilot-copter")!;

  it("maps 31/32/33 to Motor Emergency Stop, Motor Interlock and Brake", () => {
    expect(copter.get(31)).toBe("Motor Emergency Stop");
    expect(copter.get(32)).toBe("Motor Interlock");
    expect(copter.get(33)).toBe("BRAKE Mode");
  });

  it("keeps 39/40/41 as the functions the firmware defines for them", () => {
    expect(copter.get(39)).toBe("PrecLoiter Enable");
    expect(copter.get(40)).toBe("Proximity Avoidance Enable");
    expect(copter.get(41)).toBe("ArmDisarm (4.1 and lower)");
  });

  it("pins the arm/disarm and arm-or-stop switches", () => {
    expect(copter.get(81)).toBe("Disarm");
    expect(copter.get(153)).toBe("ArmDisarm (4.2 and higher)");
    expect(copter.get(165)).toBe("Arm/Emergency Motor Stop");
  });
});

describe("resolveParamEnum", () => {
  const empty = new Map<string, ParamMetadata>();

  it("gives each vehicle its own battery failsafe action enum", () => {
    expect(resolveParamEnum("BATT_FS_LOW_ACT", empty, "ardupilot-copter").get(1)).toBe("Land");
    expect(resolveParamEnum("BATT_FS_LOW_ACT", empty, "ardupilot-plane").get(1)).toBe("RTL");
    expect(resolveParamEnum("BATT2_FS_CRT_ACT", empty, "ardupilot-plane").get(2)).toBe("Land");
    expect(resolveParamEnum("COM_LOW_BAT_ACT", empty, "px4").get(2)).toBe("Land mode");
  });

  it("uses the vehicle's FENCE_ACTION meaning", () => {
    expect(resolveParamEnum("FENCE_ACTION", empty, "ardupilot-copter").get(4)).toBe("Brake or Land");
    expect(resolveParamEnum("FENCE_ACTION", empty, "ardupilot-plane").has(4)).toBe(false);
  });

  it("prefers live metadata over the fallback", () => {
    const live = new Map<string, ParamMetadata>([
      ["FLOW_TYPE", { name: "FLOW_TYPE", humanName: "", description: "", values: new Map([[5, "Live label"]]) }],
    ]);
    expect(resolveParamEnum("FLOW_TYPE", live, "ardupilot-copter").get(5)).toBe("Live label");
    expect(resolveParamEnum("FLOW_TYPE", empty, "ardupilot-copter").get(5)).toBe("MAVLink");
  });

  it("returns no options when there is neither metadata nor a table", () => {
    expect(resolveParamEnum("FLOW_TYPE", empty, null).size).toBe(0);
    expect(resolveParamEnum("NOT_A_PARAM", empty, "ardupilot-copter").size).toBe(0);
  });

  it("resolves GPS_GNSS_MODE bits with GLONASS on bit 6", () => {
    expect(resolveParamBitmask("GPS_GNSS_MODE", empty, "ardupilot-plane").get(6)).toBe("GLONASS");
  });
});
