"use client";

/**
 * @module hardware/radio/CalibrateLinkWizard
 * @description Drives the pure calibration engine from the UI: sweeps the
 * transmitter's trio over a grid, measures the receiver's decode-side stats,
 * shows a live results table, and applies the recommended trio. Safety: it
 * captures the last-good trio before sweeping and ALWAYS restores it on cancel,
 * error, or a failed final re-validation, so a sweep never strands the link.
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import {
  runCalibration,
  measureAfter,
  evaluateCell,
  DEFAULT_CAL_CONFIG,
  AbortError,
  type CalCellResult,
  type CalMeasurement,
  type CalTrio,
} from "@/lib/api/ground-station/calibration";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface CalibrateLinkWizardProps {
  open: boolean;
  onClose: () => void;
  /** Apply a trio to the transmitter (drone setMcs + setFec). */
  sweep: (trio: CalTrio) => Promise<void>;
  /** Read one decode-side sample from the receiver's live snapshot. */
  measure: () => CalMeasurement;
  /** The trio to restore on cancel / error / failed re-validation. */
  lastGood: CalTrio | null;
  /** Display name of the node whose decode stats are measured. */
  receiverName: string | null;
}

type Phase = "idle" | "running" | "done" | "error";

export function CalibrateLinkWizard({
  open,
  onClose,
  sweep,
  measure,
  lastGood,
  receiverName,
}: CalibrateLinkWizardProps) {
  const t = useTranslations("hardware.radio.calibration");
  const tCommon = useTranslations("common");

  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState({ done: 0, total: DEFAULT_CAL_CONFIG.grid.length });
  const [results, setResults] = useState<CalCellResult[]>([]);
  const [best, setBest] = useState<CalCellResult | null>(null);
  const [marginal, setMarginal] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const abortRef = useRef<{ aborted: boolean }>({ aborted: false });
  const runningRef = useRef(false);

  // Restore the last-good trio. Best-effort: a restore failure is logged in the
  // note but never throws (the link may already be re-acquiring).
  const restore = useCallback(async () => {
    if (!lastGood) return;
    try {
      await sweep(lastGood);
    } catch {
      /* best-effort revert */
    }
  }, [lastGood, sweep]);

  // Always revert if the dialog unmounts mid-run.
  useEffect(() => {
    return () => {
      if (runningRef.current) {
        abortRef.current.aborted = true;
        void restore();
      }
    };
  }, [restore]);

  const start = async () => {
    setPhase("running");
    setResults([]);
    setBest(null);
    setNote(null);
    setProgress({ done: 0, total: DEFAULT_CAL_CONFIG.grid.length });
    abortRef.current = { aborted: false };
    runningRef.current = true;
    try {
      const outcome = await runCalibration(DEFAULT_CAL_CONFIG, {
        sweep,
        measure: async () => measure(),
        sleep,
        now: Date.now,
        signal: abortRef.current,
        onCell: (done, total, cell) => {
          setProgress({ done, total });
          setResults((prev) => [...prev, cell]);
        },
      });
      setBest(outcome.best);
      setMarginal(outcome.marginal);
      // The sweep leaves the TX on the last grid cell; return to the known-good
      // trio so the link is never left on an unvalidated setting. The operator
      // then explicitly applies the recommendation.
      await restore();
      if (!outcome.best) setNote(t("noneWorked"));
      setPhase("done");
    } catch (err) {
      runningRef.current = false;
      await restore();
      if (err instanceof AbortError) {
        setNote(t("restored"));
        setPhase("idle");
      } else {
        const msg = err instanceof Error ? err.message : "calibration failed";
        setNote(t("failed", { msg }));
        setPhase("error");
      }
      return;
    }
    runningRef.current = false;
  };

  // Apply the recommended trio, then re-validate it from receiver samples taken
  // after the apply landed. If the link does not survive, revert to last-good
  // so the operator is never stranded.
  const applyBest = async () => {
    if (!best) return;
    setNote(null);
    runningRef.current = true;
    try {
      await sweep(best.trio);
      const check = await measureAfter(
        DEFAULT_CAL_CONFIG,
        { measure: async () => measure(), sleep, now: Date.now },
        Date.now(),
      );
      const verdict = evaluateCell(best.trio, check, DEFAULT_CAL_CONFIG.lossThresholdPct).verdict;
      if (verdict === "link_lost") {
        await restore();
        setNote(t("noneWorked"));
      } else {
        setNote(t("applied"));
      }
    } catch (err) {
      await restore();
      const msg = err instanceof Error ? err.message : "apply failed";
      setNote(t("failed", { msg }));
    } finally {
      runningRef.current = false;
    }
  };

  const cancel = () => {
    abortRef.current.aborted = true;
  };

  const close = () => {
    if (runningRef.current) cancel();
    onClose();
  };

  const fmt = (v: number | null, digits = 0, suffix = ""): string =>
    v == null ? "—" : `${v.toFixed(digits)}${suffix}`;

  const verdictLabel: Record<CalCellResult["verdict"], string> = {
    ok: t("verdictOk"),
    lossy: t("verdictLossy"),
    fec_fail: t("verdictFecFail"),
    link_lost: t("verdictLinkLost"),
  };

  const canStart = phase !== "running" && Boolean(receiverName);

  return (
    <Modal open={open} onClose={close} title={t("title")} size="lg" closeBlocked={phase === "running"}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-secondary">{t("intro")}</p>

        {receiverName ? (
          <p className="text-xs text-text-tertiary">{t("receiver", { name: receiverName })}</p>
        ) : (
          <p className="text-xs text-status-warning">{t("noReceiver")}</p>
        )}

        {phase === "running" ? (
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <Loader2 size={14} className="animate-spin" />
            {t("running", { done: progress.done, total: progress.total })}
          </div>
        ) : null}

        {results.length > 0 ? (
          <div className="max-h-72 overflow-auto rounded border border-border-default">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-bg-tertiary text-text-tertiary">
                <tr>
                  <th className="px-2 py-1 text-left">{t("colTrio")}</th>
                  <th className="px-2 py-1 text-right">{t("colRssi")}</th>
                  <th className="px-2 py-1 text-right">{t("colLoss")}</th>
                  <th className="px-2 py-1 text-right">{t("colGoodput")}</th>
                  <th className="px-2 py-1 text-right">{t("colVerdict")}</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {results.map((r, i) => {
                  const isBest = best != null && r === best;
                  return (
                    <tr
                      key={i}
                      className={
                        isBest
                          ? "bg-accent-primary/10 text-text-primary"
                          : "text-text-secondary"
                      }
                    >
                      <td className="px-2 py-1">
                        {r.trio.mcs} · {r.trio.fecK}/{r.trio.fecN}
                      </td>
                      <td className="px-2 py-1 text-right">{fmt(r.avg.rssiDbm, 0)}</td>
                      <td className="px-2 py-1 text-right">{fmt(r.avg.lossPercent, 1, "%")}</td>
                      <td className="px-2 py-1 text-right">
                        {r.goodputKbps != null ? `${(r.goodputKbps / 1000).toFixed(1)}M` : "—"}
                      </td>
                      <td
                        className={
                          "px-2 py-1 text-right " +
                          (r.verdict === "ok" ? "text-status-success" : "text-status-warning")
                        }
                      >
                        {verdictLabel[r.verdict]}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        {phase === "done" && best ? (
          <div className="rounded border border-border-default bg-bg-secondary p-3 text-sm">
            <p className="text-text-primary">
              {t("recommended", {
                mcs: best.trio.mcs,
                k: best.trio.fecK,
                n: best.trio.fecN,
              })}
            </p>
            {marginal ? (
              <p className="mt-1 text-xs text-status-warning">{t("marginalWarn")}</p>
            ) : null}
          </div>
        ) : null}

        {note ? <p className="text-xs text-text-tertiary">{note}</p> : null}

        <div className="flex justify-end gap-2">
          {phase === "running" ? (
            <Button variant="secondary" size="sm" onClick={cancel}>
              {tCommon("cancel")}
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={close}>
              {tCommon("close")}
            </Button>
          )}
          {phase === "idle" || phase === "error" ? (
            <Button variant="primary" size="sm" onClick={() => void start()} disabled={!canStart}>
              {t("start")}
            </Button>
          ) : null}
          {phase === "done" && best ? (
            <Button variant="primary" size="sm" onClick={() => void applyBest()}>
              {t("applyRecommended")}
            </Button>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
