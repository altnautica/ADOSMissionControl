/**
 * Place a compiled logic-condition program into the free slots of the table
 * read from the flight controller, leaving every slot already in use alone.
 *
 * A compiled program numbers its conditions from 0 and refers to its own
 * intermediate results by that number (operand type LC, and activatorId), so
 * those references are rebased onto the slots the program actually lands in.
 *
 * @module lib/inav/lc-placement
 */

import type { INavLogicCondition } from "@/lib/protocol/msp/msp-decoders-inav";

/** logicOperandType_e LOGIC_CONDITION_OPERAND_TYPE_LOGIC_CONDITION. */
const OPERAND_TYPE_LC = 4;

/**
 * A slot is free when it is disabled and holds nothing: operation TRUE (0),
 * both operands the literal 0 and no flags. A disabled slot that still holds
 * a rule may be one the pilot switched off on purpose, so it is kept.
 */
export function isFreeLogicCondition(c: INavLogicCondition): boolean {
  return (
    !c.enabled &&
    c.operation === 0 &&
    c.operandAType === 0 &&
    c.operandAValue === 0 &&
    c.operandBType === 0 &&
    c.operandBValue === 0 &&
    c.flags === 0
  );
}

export type PlacementResult =
  | { conditions: INavLogicCondition[]; slots: number[] }
  | { error: string };

/**
 * `program[i]` goes to the i-th free slot of `table`. Returns the new table and
 * the slot each program condition landed in, or an error when the table has
 * too few free slots (nothing is placed then).
 */
export function placeLogicProgram(
  table: readonly INavLogicCondition[],
  program: readonly INavLogicCondition[],
): PlacementResult {
  const free: number[] = [];
  table.forEach((c, i) => {
    if (isFreeLogicCondition(c)) free.push(i);
  });
  if (program.length > free.length) {
    return {
      error: `The program needs ${program.length} logic conditions but only ${free.length} slots are free on the flight controller`,
    };
  }
  const slots = free.slice(0, program.length);
  const rebase = (type: number, value: number) => (type === OPERAND_TYPE_LC ? slots[value] ?? value : value);
  const conditions = table.map((c) => ({ ...c }));
  program.forEach((c, i) => {
    conditions[slots[i]] = {
      ...c,
      activatorId: c.activatorId >= 0 ? slots[c.activatorId] ?? c.activatorId : c.activatorId,
      operandAValue: rebase(c.operandAType, c.operandAValue),
      operandBValue: rebase(c.operandBType, c.operandBValue),
    };
  });
  return { conditions, slots };
}
