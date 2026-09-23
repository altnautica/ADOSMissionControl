/**
 * The shared validator compiles each distinct parameter schema once, even
 * though callers rebuild schema objects on every validation.
 */
import Ajv from "ajv";
import { describe, expect, it, vi } from "vitest";

import { schemaCompiles, validateValueAjv } from "../ajv-validator";

describe("validateValueAjv", () => {
  it("compiles an equal schema once across fresh schema objects", () => {
    const compile = vi.spyOn(Ajv.prototype, "compile");
    const fresh = () => ({ type: "integer" as const, minimum: 2, maximum: 9, step: 1 });

    expect(validateValueAjv(fresh(), 5)).toEqual({ ok: true });
    expect(validateValueAjv(fresh(), 1)).toMatchObject({ ok: false });
    expect(schemaCompiles(fresh())).toBe(true);
    expect(compile).toHaveBeenCalledTimes(1);

    // A different schema is compiled on its own.
    expect(validateValueAjv({ type: "integer", minimum: 3 }, 3)).toEqual({ ok: true });
    expect(compile).toHaveBeenCalledTimes(2);
    compile.mockRestore();
  });
});
