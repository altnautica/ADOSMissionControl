import type { ParameterValue } from "@/lib/protocol/types";

/** Export parameters to a .param file (download) */
export function exportParamFile(
  parameters: ParameterValue[],
  modified: Map<string, number>,
) {
  const lines = parameters.map((p) => {
    const val = modified.has(p.name) ? modified.get(p.name)! : p.value;
    return `${p.name} ${val}`;
  });
  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `params_${new Date().toISOString().slice(0, 10)}.param`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Import parameters from a .param file. Returns updated modified map. */
export function importParamFile(
  text: string,
  parameters: ParameterValue[],
  modified: Map<string, number>,
): Map<string, number> {
  const newMods = new Map(modified);
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(/[\s,]+/);
    if (parts.length >= 2) {
      const name = parts[0];
      const value = parseFloat(parts[1]);
      if (!isNaN(value)) {
        const orig = parameters.find((p) => p.name === name);
        if (orig && orig.value !== value) newMods.set(name, value);
        else if (orig) newMods.delete(name);
      }
    }
  }
  return newMods;
}
