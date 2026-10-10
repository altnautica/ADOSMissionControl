/**
 * The install record's `gcsParameters` column is a closed Convex object
 * validator: a parsed parameter carrying a field the validator does not list
 * makes Convex reject the whole install mutation. This walks the validator's
 * JSON form against the parameters the GCS records for real first-party
 * manifests, including a `camera-selector` parameter (which carries
 * `ui.purpose`) and a bitmask (`ui.bits`).
 *
 * @license GPL-3.0-only
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { gcsParametersValidator } from "../../convex/cmdPluginsValidators";
import { parseParameterContributions } from "@/lib/plugins/parameters/parse";
import { buildGcsParameters } from "@/components/plugins/transports/build-install-contributions";

interface ValidatorJson {
  type: string;
  value?: unknown;
}

/** Return the paths where `value` does not conform to `validator`. */
function mismatches(validator: ValidatorJson, value: unknown, path = "$"): string[] {
  switch (validator.type) {
    case "any":
      return [];
    case "string":
      return typeof value === "string" ? [] : [path];
    case "number":
    case "float64":
      return typeof value === "number" ? [] : [path];
    case "boolean":
      return typeof value === "boolean" ? [] : [path];
    case "literal":
      return value === validator.value ? [] : [path];
    case "union": {
      const members = validator.value as ValidatorJson[];
      return members.some((m) => mismatches(m, value, path).length === 0) ? [] : [path];
    }
    case "array": {
      if (!Array.isArray(value)) return [path];
      return value.flatMap((item, i) =>
        mismatches(validator.value as ValidatorJson, item, `${path}[${i}]`),
      );
    }
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return [path];
      const fields = validator.value as Record<
        string,
        { fieldType: ValidatorJson; optional: boolean }
      >;
      const record = value as Record<string, unknown>;
      const out: string[] = [];
      for (const key of Object.keys(record)) {
        if (record[key] === undefined) continue;
        const field = fields[key];
        if (!field) out.push(`${path}.${key} (not in validator)`);
        else out.push(...mismatches(field.fieldType, record[key], `${path}.${key}`));
      }
      for (const [key, field] of Object.entries(fields)) {
        if (!field.optional && record[key] === undefined) out.push(`${path}.${key} (missing)`);
      }
      return out;
    }
    default:
      throw new Error(`validator type ${validator.type} not handled by this test`);
  }
}

function recordedParameters(manifestFile: string) {
  const manifest = parse(
    readFileSync(
      join(__dirname, "../../src/lib/skills/__tests__/fixtures/first-party-manifests", manifestFile),
      "utf8",
    ),
  ) as { gcs?: { contributes?: { parameters?: unknown } } };
  return buildGcsParameters({
    contributesParameters: parseParameterContributions(manifest.gcs?.contributes?.parameters),
  });
}

describe("gcsParameters Convex validator", () => {
  // `json` is the validator's runtime wire form; its type is not public.
  if (!("json" in gcsParametersValidator)) throw new Error("validator has no json form");
  const validator = gcsParametersValidator.json as ValidatorJson;

  it.each(["follow-me.yaml", "mavlink-gimbal-v2.yaml", "siyi-pod.yaml"])(
    "accepts the parameters recorded for %s",
    (file) => {
      const params = recordedParameters(file);
      expect(params).toBeDefined();
      expect(mismatches(validator, params)).toEqual([]);
    },
  );

  it("accepts a camera-selector parameter with its purpose", () => {
    const params = parseParameterContributions([
      {
        key: "designate_camera",
        control: "camera-selector",
        label: "Camera",
        purpose: "detect",
        default: "auto",
      },
    ]);
    expect(params?.[0].ui?.purpose).toBe("detect");
    expect(mismatches(validator, params)).toEqual([]);
  });

  it("accepts a bitmask parameter with its bit table", () => {
    const params = parseParameterContributions([
      {
        key: "mask",
        schema: { type: "integer", minimum: 0, maximum: 3, default: 0 },
        ui: { widget: "bitmask", bits: [{ bit: 0, label: "A" }, { bit: 1, label: "B" }] },
      },
    ]);
    expect(mismatches(validator, params)).toEqual([]);
  });

  it("reports a ui field the validator does not list", () => {
    const params = [{ key: "k", schema: { type: "string" }, ui: { unknownField: "x" } }];
    expect(mismatches(validator, params)).toEqual(["$[0].ui.unknownField (not in validator)"]);
  });
});
