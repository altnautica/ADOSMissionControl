/**
 * A multi-node dispatch asks for at least what one vehicle asks for: any skill
 * that confirms — including a mode preset whose policy depends on its target
 * mode — asks for its typed id; a press-confirmed skill asks for nothing.
 *
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";
import { builtinSkills } from "@/lib/skills/builtins";
import { batchConfirmPhrase, batchConfirmPolicy } from "@/lib/skills/batch-confirm";

function builtin(id: string) {
  const skill = builtinSkills.find((s) => s.id === id);
  if (!skill) throw new Error(`no built-in ${id}`);
  return skill;
}

describe("batch confirm", () => {
  it("asks for the typed id before sending AUTO to many vehicles", () => {
    const auto = builtin("mode.auto");
    expect(batchConfirmPolicy(auto)?.gesture).toBe("slide");
    expect(batchConfirmPhrase(auto)).toBe("MODE.AUTO");
  });

  it("asks for the typed id for a fixed-policy skill", () => {
    expect(batchConfirmPhrase(builtin("rth"))).toBe("RTH");
  });

  it("asks for nothing for a recovery mode or an unconfirmed skill", () => {
    expect(batchConfirmPhrase(builtin("mode.loiter"))).toBeUndefined();
    expect(batchConfirmPhrase(builtin("pause"))).toBeUndefined();
  });
});
