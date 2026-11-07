"use client";

/**
 * @module aircraft-setup/AircraftSetupView
 * @description Settings › Aircraft setup: the drone agent's ground and air
 * setup wizards for the selected drone. The aircraft summary, a tab per
 * wizard, the step list beside the current step (the screen follows the
 * engine while a wizard runs; otherwise any step can be opened and re-run on
 * its own), the parameter-snapshot revert offer, and the setup report.
 * @license GPL-3.0-only
 */

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, ChevronRight, CircleStop, Cpu, FileClock, Play, RotateCcw } from "lucide-react";

import { HoldButton } from "@/components/cockpit/v2/HoldButton";
import { currentStep } from "@/lib/fc-setup/parse";
import { formatValue, setupLabel, setupText } from "@/lib/fc-setup/strings";
import { HOLD_CONFIRM_MS, type SetupReport, type SetupSnapshot, type SetupStatus, type SetupStep, type Wizard } from "@/lib/fc-setup/types";
import type { FcSetupController } from "@/lib/fc-setup/use-fc-setup";
import { cn } from "@/lib/utils";

import { ProgressRing, StepCard, StepStateIcon } from "./StepCard";

const BUTTON = "inline-flex min-h-12 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold disabled:opacity-40";

export function AircraftSetupView({ setup }: { setup: FcSetupController }) {
  const t = useTranslations("aircraftSetup");
  const [wizardId, setWizardId] = useState<string | null>(null);
  const { status } = setup;

  let body: ReactNode;
  if (!status) {
    body = setup.loading ? (
      <Note>{t("loading")}</Note>
    ) : (
      <Note tone="err">
        {t("loadError", { error: setup.loadError ?? "" })}{" "}
        <button type="button" onClick={() => void setup.refresh()} className="underline">
          {t("retry")}
        </button>
      </Note>
    );
  } else if (!status.uid) {
    body = <Note>{t("noFc")}</Note>;
  } else {
    const running = status.running?.wizard;
    const shown =
      status.wizards.find((w) => w.id === (wizardId ?? running)) ??
      status.wizards.find((w) => w.state !== "done" && w.available) ??
      status.wizards[0];
    body = (
      <>
        <AircraftSummary status={status} />
        <div role="tablist" className="flex flex-wrap gap-2">
          {status.wizards.map((w) => (
            <button
              key={w.id}
              type="button"
              role="tab"
              aria-selected={w.id === shown?.id}
              onClick={() => setWizardId(w.id)}
              className={cn(
                "flex min-h-12 items-center gap-2 rounded-md border px-4 text-left",
                w.id === shown?.id ? "border-accent-primary bg-accent-primary/10" : "border-border-default hover:bg-bg-tertiary",
              )}
              data-testid={`setup-wizard-tab-${w.id}`}
            >
              <span className="text-sm font-semibold text-text-primary">{setupText(`setup.wizard.${w.id}.title`)}</span>
              <span className="text-xs text-text-secondary">{t(`wizardState.${w.state}`)}</span>
            </button>
          ))}
        </div>
        {shown && <WizardPanel key={shown.id} wizard={shown} status={status} setup={setup} />}
        {status.report && <ReportCard report={status.report} wizards={status.wizards} setup={setup} />}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="aircraft-setup">
      {body}
    </div>
  );
}

function Note({ children, tone }: { children: ReactNode; tone?: "err" }) {
  return (
    <p
      className={cn(
        "rounded-md border px-4 py-3 text-sm",
        tone === "err" ? "border-status-error/40 bg-status-error/10 text-status-error" : "border-border-default bg-bg-secondary text-text-secondary",
      )}
    >
      {children}
    </p>
  );
}

function AircraftSummary({ status }: { status: SetupStatus }) {
  const t = useTranslations("aircraftSetup");
  const cls = status.vehicle_class ? t(`vehicleClass.${status.vehicle_class}`) : null;
  const parts = [[status.firmware, status.firmware_version].filter(Boolean).join(" "), cls].filter(Boolean);
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-text-secondary">
      <Cpu className="h-4 w-4 text-accent-primary" aria-hidden />
      <span className="font-medium text-text-primary">{parts.join(" · ")}</span>
      <span className="font-mono text-xs">{status.uid}</span>
    </div>
  );
}

function WizardPanel({ wizard, status, setup }: { wizard: Wizard; status: SetupStatus; setup: FcSetupController }) {
  const t = useTranslations("aircraftSetup");
  const [picked, setPicked] = useState<string | null>(null);
  const isRunning = wizard.state === "running";
  // While the wizard runs the screen follows the engine; otherwise the operator
  // may open any step to read it or run it on its own.
  const step = (!isRunning && picked ? wizard.steps.find((s) => s.step === picked) : null) ?? currentStep(wizard);
  const busy = setup.busy !== null;
  const snapshots = status.report?.snapshots ?? [];
  const snapshot = snapshots[snapshots.length - 1] ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-text-secondary">{setupText(`setup.wizard.${wizard.id}.body`)}</p>
        {isRunning ? (
          <button type="button" disabled={busy} onClick={() => void setup.abort(wizard.id)} className={cn(BUTTON, "bg-status-error text-white")} data-testid="setup-abort">
            <CircleStop className="h-4 w-4" aria-hidden />
            {setupText("setup.action.abort")}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy || !wizard.available}
            onClick={() => void setup.start(wizard.id)}
            className={cn(BUTTON, "bg-accent-primary text-white")}
            data-testid="setup-start"
          >
            <Play className="h-4 w-4" aria-hidden />
            {setupText(wizard.state === "not_started" ? "setup.action.start" : "setup.action.run_again")}
          </button>
        )}
      </div>

      {wizard.blockers.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-md border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-sm text-status-warning">
          {wizard.blockers.map((b) => (
            <li key={b} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {setupText(b)}
            </li>
          ))}
        </ul>
      )}

      {setup.requestError && !step && <Note tone="err">{setup.requestError}</Note>}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(12rem,15rem)_minmax(0,1fr)]">
        <ol aria-label={t("steps")} className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
          {wizard.steps.map((s) => (
            <StepRow
              key={s.step}
              step={s}
              active={s.step === step?.step}
              rerunnable={!isRunning && (s.state === "done" || s.state === "failed" || s.state === "skipped")}
              busy={busy}
              onPick={() => setPicked(s.step)}
              onRerun={() => void setup.runStep(s.wizard, s.step)}
            />
          ))}
        </ol>
        <div className="flex min-w-0 flex-col gap-4">
          {step && (
            <StepCard
              key={`${step.wizard}/${step.step}`}
              step={step}
              busy={busy}
              error={setup.requestError}
              onAction={(s, id, args) => void setup.action(s, id, args)}
            />
          )}
          {wizard.state === "done" && snapshot && <RevertOffer snapshot={snapshot} setup={setup} />}
        </div>
      </div>
    </div>
  );
}

function StepRow({
  step,
  active,
  rerunnable,
  busy,
  onPick,
  onRerun,
}: {
  step: SetupStep;
  active: boolean;
  rerunnable: boolean;
  busy: boolean;
  onPick: () => void;
  onRerun: () => void;
}) {
  const t = useTranslations("aircraftSetup");
  const title = setupText(step.title_key, step.args);
  return (
    <li className="flex min-w-[11rem] shrink-0 items-stretch gap-1 lg:min-w-0">
      <button
        type="button"
        aria-current={active ? "step" : undefined}
        onClick={onPick}
        className={cn(
          "flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-md px-3 text-left text-sm",
          active ? "bg-accent-primary/15 font-semibold text-text-primary" : "text-text-secondary hover:bg-bg-tertiary",
        )}
        data-testid={`setup-step-${step.step}`}
      >
        <StepStateIcon state={step.state} />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {step.state === "running" && step.progress !== null ? (
          <ProgressRing value={step.progress} size={28} />
        ) : active ? (
          <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
        ) : null}
      </button>
      {rerunnable && (
        <button
          type="button"
          disabled={busy}
          onClick={onRerun}
          aria-label={`${t("rerun")} · ${title}`}
          title={t("rerun")}
          className="flex min-h-12 min-w-12 items-center justify-center rounded-md text-text-secondary hover:bg-bg-tertiary disabled:opacity-40"
        >
          <RotateCcw className="h-4 w-4" aria-hidden />
        </button>
      )}
    </li>
  );
}

function snapshotDate(s: SetupSnapshot): string {
  const d = new Date(s.ts);
  return Number.isNaN(d.getTime()) ? s.file : d.toLocaleString();
}

function RevertButton({ snapshot, setup, onRestored }: { snapshot: SetupSnapshot; setup: FcSetupController; onRestored: (n: number | null) => void }) {
  return (
    <HoldButton
      holdMs={HOLD_CONFIRM_MS}
      disabled={setup.busy !== null}
      title={setupText("setup.confirm.hold")}
      onFire={() => void setup.revert(snapshot.file).then(onRestored)}
      className={cn(BUTTON, "border border-border-default text-text-primary")}
    >
      {setupText("setup.action.revert")}
    </HoldButton>
  );
}

function RevertOffer({ snapshot, setup }: { snapshot: SetupSnapshot; setup: FcSetupController }) {
  const t = useTranslations("aircraftSetup");
  const [restored, setRestored] = useState<number | null>(null);
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border-default bg-bg-secondary p-4">
      <h3 className="flex items-center gap-2 text-base font-semibold text-text-primary">
        <FileClock className="h-4 w-4 text-accent-primary" aria-hidden />
        {setupText("setup.wizard.revert.title")}
      </h3>
      <p className="text-sm text-text-secondary">{setupText("setup.wizard.revert.body", { date: snapshotDate(snapshot) })}</p>
      {restored !== null && <p className="text-sm text-status-success">{t("reverted", { count: restored })}</p>}
      <div>
        <RevertButton snapshot={snapshot} setup={setup} onRestored={setRestored} />
      </div>
    </section>
  );
}

function ReportCard({ report, wizards, setup }: { report: SetupReport; wizards: Wizard[]; setup: FcSetupController }) {
  const t = useTranslations("aircraftSetup");
  const [restored, setRestored] = useState<number | null>(null);
  const titles: Record<string, string> = {};
  for (const w of wizards) for (const s of w.steps) titles[s.step] = setupText(s.title_key, s.args);
  const steps = Object.entries(report.steps);
  const meta: Array<[string, string | null]> = [
    [t("report.date"), report.date ? new Date(report.date).toLocaleString() : null],
    [t("report.firmware"), [report.firmware, report.firmware_version].filter(Boolean).join(" ") || null],
    [t("report.vehicle"), report.vehicle_class ? t(`vehicleClass.${report.vehicle_class}`) : null],
  ];
  return (
    <details className="group rounded-lg border border-border-default bg-bg-secondary" data-testid="setup-report">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 text-base font-semibold text-text-primary">
        <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" aria-hidden />
        {setupText("setup.wizard.report.title")}
      </summary>
      <div className="flex flex-col gap-4 px-4 pb-4">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-0.5 text-sm">
          {meta.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-text-secondary">{k}</dt>
              <dd className="text-text-primary">{v ?? "—"}</dd>
            </div>
          ))}
        </dl>
        {steps.length > 0 ? (
          <div className="flex flex-col gap-2">
            {steps.map(([stepId, values]) => (
              <div key={stepId} className="rounded-md border border-border-default bg-bg-tertiary/40 px-3 py-2">
                <h4 className="mb-1 text-sm font-semibold text-text-primary">{titles[stepId] ?? stepId}</h4>
                <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 text-xs">
                  {Object.entries(values).map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="truncate text-text-secondary">{setupLabel("result", k)}</dt>
                      <dd className="text-right font-mono tabular-nums text-text-primary">{formatValue(v)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-text-secondary">{t("report.noSteps")}</p>
        )}
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold text-text-primary">{t("report.snapshots")}</h4>
          {restored !== null && <p className="text-sm text-status-success">{t("reverted", { count: restored })}</p>}
          {report.snapshots.length > 0 ? (
            report.snapshots.map((s) => (
              <div key={s.file} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-mono text-text-secondary">{s.file}</span>
                <RevertButton snapshot={s} setup={setup} onRestored={setRestored} />
              </div>
            ))
          ) : (
            <p className="text-sm text-text-secondary">{t("report.noSnapshots")}</p>
          )}
        </div>
      </div>
    </details>
  );
}
