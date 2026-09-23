/**
 * @module components/mcp/McpSetupWizard
 * @description The LOCAL-FIRST guided "connect your MCP server" flow:
 * prerequisites → get and build the server → pick the drones already paired on
 * your LAN → add them to your client → a live local verify. One drone emits a
 * `--target agent` recipe with that drone's host + pairing key; several drones
 * export an `ados-fleet.json` (each drone's host + key) and emit a
 * `--target local-fleet` recipe. No Mission Control sign-in, no cloud — the
 * drones' own pairing keys (already in local-nodes-store) authorize the
 * connection. The cloud "manage from anywhere" path is a separate opt-in
 * affordance. The verify is honest (no fabricated reading): it probes each drone's
 * `/api/pairing/info` directly over the LAN, and shows the `--verify` command as
 * the deterministic check.
 * @license GPL-3.0-only
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy, Loader2, XCircle, Download, Radar } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useMcpTabStore } from "@/stores/mcp-tab-store";
import { useLocalNodesStore, type LocalNode } from "@/stores/local-nodes-store";
import { probeAgent } from "@/lib/agent/local-pair-client";
import {
  cloneAndBuildRecipe,
  localConnectRecipe,
  localMcpJsonSnippet,
  envExportLine,
  localVerifyRecipe,
  localFleetConnectRecipe,
  localFleetVerifyRecipe,
  fleetFileContents,
  fleetEnvValue,
  localFleetEnvRecipe,
  localFleetEnvJsonSnippet,
  DEFAULT_FLEET_PATH,
  LOCAL_FLEET_FILENAME,
} from "./mcp-shared";
import { downloadBlob } from "@/lib/download";

const STEP_COUNT = 5;
type NodeVerify = "checking" | "reachable" | "unreachable";

/** A code block with a copy button. */
function CopyBlock({ text }: { text: string }) {
  const t = useTranslations("mcp");
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the text stays selectable */
    }
  }
  return (
    <div className="flex items-start gap-2">
      <pre className="flex-1 overflow-x-auto rounded-md border border-border-default bg-bg-tertiary p-3 font-mono text-xs text-text-primary">
        {text}
      </pre>
      <Button
        variant="secondary"
        size="sm"
        icon={copied ? <Check size={14} /> : <Copy size={14} />}
        onClick={copy}
      >
        {copied ? t("reveal.copied") : t("reveal.copy")}
      </Button>
    </div>
  );
}

function toFleetNode(n: LocalNode) {
  return {
    deviceId: n.deviceId,
    name: n.name,
    host: n.hostname,
    apiKey: n.apiKey,
    profile: n.profile,
  };
}

export function McpSetupWizard() {
  const open = useMcpTabStore((s) => s.wizardOpen);
  const close = useMcpTabStore((s) => s.closeWizard);
  const t = useTranslations("mcp");
  const nodes = useLocalNodesStore((s) => s.nodes);

  const [step, setStep] = useState(0);
  // "all" = control every paired drone (the default, one command); "some" = narrow
  // to a hand-picked subset. autoAdopt = also auto-discover new UNPAIRED LAN drones.
  const [pickMode, setPickMode] = useState<"all" | "some">("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [autoAdopt, setAutoAdopt] = useState(false);
  const [verify, setVerify] = useState<Record<string, NodeVerify>>({});

  const selected = pickMode === "all" ? nodes : nodes.filter((n) => selectedIds.includes(n.deviceId));
  const isFleet = selected.length > 1;

  // Reset the flow whenever the wizard closes.
  useEffect(() => {
    if (!open) {
      setStep(0);
      setPickMode("all");
      setSelectedIds([]);
      setAutoAdopt(false);
      setVerify({});
    }
  }, [open]);

  // Seed the manual picker with every drone once the wizard opens (so "choose
  // specific" starts from all-selected and the operator unchecks to narrow).
  useEffect(() => {
    if (open && selectedIds.length === 0 && nodes.length > 0) {
      setSelectedIds(nodes.map((n) => n.deviceId));
    }
  }, [open, selectedIds.length, nodes]);

  // Live LOCAL verify (no Convex): probe each selected drone directly over the LAN.
  const runVerify = useCallback(async (targets: LocalNode[]) => {
    setVerify(Object.fromEntries(targets.map((n) => [n.deviceId, "checking" as NodeVerify])));
    await Promise.all(
      targets.map(async (n) => {
        let result: NodeVerify;
        try {
          await probeAgent(n.hostname);
          result = "reachable";
        } catch {
          result = "unreachable";
        }
        setVerify((prev) => ({ ...prev, [n.deviceId]: result }));
      }),
    );
  }, []);
  useEffect(() => {
    if (open && step === 4 && selected.length > 0) void runVerify(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step]);

  if (!open) return null;

  function toggle(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function downloadFleet() {
    const blob = new Blob([fleetFileContents(selected.map(toFleetNode))], {
      type: "application/json",
    });
    downloadBlob(blob, LOCAL_FLEET_FILENAME);
  }

  const one = selected[0];
  // The whole selected fleet as a base64 blob for the one-command, no-file recipe.
  const fleetB64 = isFleet ? fleetEnvValue(selected.map(toFleetNode)) : "";
  const canAdvance = step !== 2 || selected.length > 0;
  const reachable = Object.values(verify).filter((v) => v === "reachable").length;

  const footer = (
    <div className="flex w-full items-center justify-between gap-2">
      <span className="text-xs text-text-tertiary">
        {t("wizard.stepOf", { step: step + 1, total: STEP_COUNT })}
      </span>
      <div className="flex gap-2">
        {step > 0 ? (
          <Button variant="ghost" onClick={() => setStep(step - 1)}>
            {t("wizard.back")}
          </Button>
        ) : null}
        {step === 4 ? (
          <Button onClick={close}>{t("wizard.done")}</Button>
        ) : (
          <Button onClick={() => setStep(step + 1)} disabled={!canAdvance}>
            {t("wizard.next")}
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <Modal open onClose={close} title={t("wizard.title")} size="lg" footer={footer}>
      <div className="flex flex-col gap-4">
        {/* progress dots */}
        <div className="flex gap-1.5">
          {Array.from({ length: STEP_COUNT }).map((_, i) => (
            <span
              key={i}
              className={`h-1 flex-1 rounded-full ${i <= step ? "bg-accent-primary" : "bg-bg-tertiary"}`}
            />
          ))}
        </div>

        {step === 0 ? (
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-text-primary">{t("wizard.prereq.title")}</h3>
            <p className="text-sm text-text-secondary">{t("wizard.prereq.body")}</p>
            <ul className="flex flex-col gap-1.5 text-sm text-text-primary">
              <li>· {t("wizard.prereq.node")}</li>
              <li>· {t("wizard.prereq.git")}</li>
              <li>· {t("wizard.prereq.pnpm")}</li>
              <li>· {t("wizard.prereq.client")}</li>
            </ul>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-text-primary">{t("wizard.get.title")}</h3>
            <p className="text-sm text-text-secondary">{t("wizard.get.body")}</p>
            <CopyBlock text={cloneAndBuildRecipe()} />
            <p className="text-xs text-text-tertiary">{t("wizard.get.note")}</p>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-text-primary">{t("wizard.pick.title")}</h3>
            <p className="text-sm text-text-secondary">{t("wizard.pick.body")}</p>
            {nodes.length > 0 ? (
              <>
                {/* All (default, one command) vs a hand-picked subset. */}
                <button
                  type="button"
                  onClick={() => setPickMode("all")}
                  className={`flex items-start gap-3 rounded-lg border p-3 text-left ${
                    pickMode === "all" ? "border-accent-primary bg-accent-primary/5" : "border-border-default bg-bg-secondary"
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                      pickMode === "all" ? "border-accent-primary bg-accent-primary text-white" : "border-border-default"
                    }`}
                  >
                    {pickMode === "all" ? <Check size={11} /> : null}
                  </span>
                  <span className="flex flex-col">
                    <span className="text-sm font-medium text-text-primary">
                      {t("wizard.pick.allTitle", { count: nodes.length })}
                    </span>
                    <span className="text-xs text-text-tertiary">{t("wizard.pick.allBody")}</span>
                  </span>
                </button>
                {nodes.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => setPickMode("some")}
                    className={`flex items-start gap-3 rounded-lg border p-3 text-left ${
                      pickMode === "some" ? "border-accent-primary bg-accent-primary/5" : "border-border-default bg-bg-secondary"
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                        pickMode === "some" ? "border-accent-primary bg-accent-primary text-white" : "border-border-default"
                      }`}
                    >
                      {pickMode === "some" ? <Check size={11} /> : null}
                    </span>
                    <span className="text-sm font-medium text-text-primary">{t("wizard.pick.someTitle")}</span>
                  </button>
                ) : null}

                {pickMode === "some" ? (
                  <div className="flex flex-col gap-1.5 pl-1">
                    {nodes.map((n) => {
                      const on = selectedIds.includes(n.deviceId);
                      return (
                        <button
                          key={n.deviceId}
                          type="button"
                          onClick={() => toggle(n.deviceId)}
                          className={`flex items-center gap-3 rounded-lg border p-2.5 text-left ${
                            on ? "border-accent-primary bg-accent-primary/5" : "border-border-default bg-bg-secondary"
                          }`}
                        >
                          <span
                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                              on ? "border-accent-primary bg-accent-primary text-white" : "border-border-default"
                            }`}
                          >
                            {on ? <Check size={12} /> : null}
                          </span>
                          <span className="flex flex-1 flex-col">
                            <span className="text-sm text-text-primary">{n.name || n.deviceId}</span>
                            <span className="font-mono text-xs text-text-tertiary">
                              {n.profile} · {n.hostname}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                {/* Opt-in: also auto-adopt new UNPAIRED drones on the LAN. */}
                <label className="mt-1 flex cursor-pointer items-start gap-2.5 rounded-lg border border-border-default bg-bg-primary p-3">
                  <input
                    type="checkbox"
                    checked={autoAdopt}
                    onChange={(e) => setAutoAdopt(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span className="flex flex-col">
                    <span className="text-sm text-text-primary">{t("wizard.pick.autoAdopt")}</span>
                    <span className="text-xs text-text-tertiary">{t("wizard.pick.autoAdoptNote")}</span>
                  </span>
                </label>
              </>
            ) : (
              <div className="flex flex-col gap-1.5 rounded-lg border border-border-default bg-bg-secondary p-4">
                <span className="text-sm font-medium text-text-primary">
                  {t("wizard.pick.emptyTitle")}
                </span>
                <span className="text-xs text-text-secondary">{t("wizard.pick.emptyBody")}</span>
              </div>
            )}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-text-primary">{t("wizard.add.title")}</h3>
            {isFleet ? (
              <>
                <p className="text-sm text-text-secondary">{t("wizard.add.allBody")}</p>
                {/* The ONE command — every drone's host + key rides in the env, no file. */}
                <CopyBlock text={localFleetEnvRecipe(fleetB64, { discover: autoAdopt })} />
                <details className="text-xs text-text-tertiary">
                  <summary className="cursor-pointer select-none">{t("wizard.add.jsonAlt")}</summary>
                  <div className="mt-2 flex flex-col gap-2">
                    <CopyBlock text={localFleetEnvJsonSnippet({ discover: autoAdopt })} />
                    <p>{t("wizard.add.jsonSecretNote", { name: "ADOS_MCP_FLEET" })}</p>
                    <CopyBlock text={envExportLine("ADOS_MCP_FLEET", fleetB64)} />
                  </div>
                </details>
                {/* Alternative for very large fleets / a persisted setup: a file. */}
                <details className="text-xs text-text-tertiary">
                  <summary className="cursor-pointer select-none">{t("wizard.add.fileAlt")}</summary>
                  <div className="mt-2 flex flex-col gap-2">
                    <p>{t("wizard.add.fileBody")}</p>
                    <div>
                      <Button variant="secondary" icon={<Download size={15} />} onClick={downloadFleet}>
                        {t("wizard.add.download")}
                      </Button>
                    </div>
                    <p>{t("wizard.add.savePath", { path: DEFAULT_FLEET_PATH })}</p>
                    <CopyBlock text={localFleetConnectRecipe(DEFAULT_FLEET_PATH, { discover: autoAdopt })} />
                  </div>
                </details>
              </>
            ) : (
              <>
                <p className="text-sm text-text-secondary">{t("wizard.add.localBody")}</p>
                <CopyBlock text={localConnectRecipe(one?.hostname ?? "", one?.apiKey ?? "")} />
                <details className="text-xs text-text-tertiary">
                  <summary className="cursor-pointer select-none">{t("wizard.add.jsonAlt")}</summary>
                  <div className="mt-2 flex flex-col gap-2">
                    <CopyBlock text={localMcpJsonSnippet(one?.hostname ?? "")} />
                    <p>{t("wizard.add.jsonSecretNote", { name: "ADOS_MCP_AGENT_KEY" })}</p>
                    <CopyBlock text={envExportLine("ADOS_MCP_AGENT_KEY", one?.apiKey ?? "")} />
                  </div>
                </details>
                <p className="text-xs text-text-tertiary">{t("wizard.add.keyNote")}</p>
              </>
            )}
            <p className="text-xs text-text-tertiary">{t("wizard.add.pathNote")}</p>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-text-primary">{t("wizard.verify.title")}</h3>
            <p className="text-sm text-text-secondary">
              {isFleet ? t("wizard.verify.fleetBody") : t("wizard.verify.localBody")}
            </p>
            <CopyBlock
              text={
                isFleet
                  ? localFleetVerifyRecipe()
                  : localVerifyRecipe(one?.hostname ?? "", one?.apiKey ?? "")
              }
            />
            {isFleet ? (
              <p className="text-xs text-text-secondary">
                {t("wizard.verify.summary", { reachable, total: selected.length })}
              </p>
            ) : null}
            <div className="flex flex-col gap-1.5">
              {selected.map((n) => {
                const state = verify[n.deviceId];
                return (
                  <div
                    key={n.deviceId}
                    className={`flex items-center gap-2 rounded-lg border p-2.5 ${
                      state === "reachable"
                        ? "border-status-success/40 bg-status-success/10"
                        : state === "unreachable"
                          ? "border-status-error/40 bg-status-error/10"
                          : "border-border-default bg-bg-secondary"
                    }`}
                  >
                    {state === "reachable" ? (
                      <Check size={15} className="text-status-success" />
                    ) : state === "unreachable" ? (
                      <XCircle size={15} className="text-status-error" />
                    ) : (
                      <Loader2 size={15} className="animate-spin text-text-tertiary" />
                    )}
                    <span className="flex-1 text-sm text-text-primary">{n.name || n.deviceId}</span>
                    <span className="text-xs text-text-tertiary">
                      {state === "reachable"
                        ? t("wizard.verify.reachable")
                        : state === "unreachable"
                          ? t("wizard.verify.unreachable")
                          : t("wizard.verify.checking")}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="flex items-start gap-2 rounded-lg border border-accent-primary/30 bg-accent-primary/5 p-2.5 text-xs text-text-secondary">
              <Radar size={14} className="mt-0.5 shrink-0 text-accent-primary" />
              <span>{t("watch.wizardNote")}</span>
            </p>
            <div>
              <Button variant="ghost" size="sm" onClick={() => selected.length && runVerify(selected)}>
                {t("wizard.verify.recheck")}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
