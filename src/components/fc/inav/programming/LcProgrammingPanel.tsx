/**
 * @module LcProgrammingPanel
 * @description Compiles a small JavaScript-like expression language into iNav
 * Logic Conditions, previews the generated LC slots, and loads them into the
 * Logic Conditions editor for review before they are written to the FC.
 * @license GPL-3.0-only
 */

"use client";

import { useState } from "react";
import { useProgrammingStore } from "@/stores/programming-store";
import { compileToLogicConditions, type CompiledProgram } from "@/lib/inav/lc-transpiler";
import { LOGIC_OPERATIONS } from "./programming-constants";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Code, Download, Play } from "lucide-react";

const EXAMPLE = [
  "// One statement per line. Assign a global variable or write a bare boolean.",
  "// Operands: numbers, gvar[N], rc[N].  Operators: + - * / %  > < >= <= ==  && ||  !",
  "gvar[0] = rc[6] > 1600",
  "gvar[1] = (gvar[0] * 10) + 5",
].join("\n");

const OPERAND_LABELS: Record<number, string> = { 1: "rc", 4: "LC", 5: "gvar" };

/** Human-readable operand for the preview: VALUE shows the number, else name[idx]. */
function operandLabel(type: number, value: number): string {
  if (type === 0) return String(value); // VALUE
  const name = OPERAND_LABELS[type] ?? `T${type}`;
  return `${name}[${value}]`;
}

export function LcProgrammingPanel() {
  const [source, setSource] = useState(EXAMPLE);
  const [result, setResult] = useState<CompiledProgram | null>(null);
  const placeProgram = useProgrammingStore((s) => s.placeProgram);
  const { toast } = useToast();

  const compiled = result && !result.error ? result.conditions.filter((c) => c.enabled) : [];

  const handleCompile = () => setResult(compileToLogicConditions(source));

  const handleLoad = () => {
    if (!result || result.error) return;
    const placed = placeProgram(compiled);
    if ("error" in placed) {
      toast(placed.error, "error");
      return;
    }
    toast(
      `Placed ${compiled.length} logic conditions in free slots ${placed.slots.join(", ")}; review and Write in the Logic Conditions tab`,
      "success",
    );
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl space-y-4">
        <div className="flex items-center gap-2">
          <Code size={16} className="text-accent-primary" />
          <h2 className="text-sm font-medium text-text-primary">Programming (JS)</h2>
          <span className="ml-auto text-[10px] text-text-tertiary">compiles to Logic Conditions</span>
        </div>

        <p className="text-[10px] text-text-tertiary">
          Write expressions and compile them into Logic Conditions. Loading places them in the slots the
          flight controller has free, leaving every condition already in use as it is; review them in the
          Logic Conditions editor and write them to the FC from there.
        </p>

        <textarea
          value={source}
          onChange={(e) => setSource(e.target.value)}
          spellCheck={false}
          rows={10}
          className="w-full font-mono text-xs bg-bg-tertiary border border-border-default rounded p-3 text-text-primary focus:outline-none focus:border-accent-primary"
        />

        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" icon={<Play size={12} />} onClick={handleCompile}>
            Compile
          </Button>
          {result && !result.error && (
            <Button variant="primary" size="sm" icon={<Download size={12} />} onClick={handleLoad}>
              Load into Logic Conditions
            </Button>
          )}
        </div>

        {result?.error && (
          <p className="text-[11px] font-mono text-status-error">Compile error: {result.error}</p>
        )}

        {result && !result.error && (
          <div className="space-y-1">
            <p className="text-[10px] font-mono text-status-success">
              {compiled.length} logic condition{compiled.length === 1 ? "" : "s"} generated:
            </p>
            <div className="overflow-x-auto">
              <table className="text-[11px] font-mono">
                <thead>
                  <tr className="text-text-tertiary">
                    <th className="text-left pr-3 pb-1">#</th>
                    <th className="text-left pr-3 pb-1">operation</th>
                    <th className="text-left pr-3 pb-1">A</th>
                    <th className="text-left pb-1">B</th>
                  </tr>
                </thead>
                <tbody>
                  {compiled.map((c, i) => (
                    <tr key={i} className="text-text-secondary">
                      <td className="pr-3 py-0.5 text-text-tertiary">{i}</td>
                      <td className="pr-3 py-0.5 text-text-primary">{LOGIC_OPERATIONS[c.operation] ?? c.operation}</td>
                      <td className="pr-3 py-0.5">{operandLabel(c.operandAType, c.operandAValue)}</td>
                      <td className="py-0.5">{operandLabel(c.operandBType, c.operandBValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
