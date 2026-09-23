"use client";

/**
 * @module MeshGatewaysTable
 * @description Cloud uplink gateways advertised on the mesh. Highlights
 * the currently selected gateway and offers a Pin button to bias the
 * selection. Pinning is non-destructive; an off button reverts to auto.
 * @license GPL-3.0-only
 */

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useGroundStationStore } from "@/stores/ground-station-store";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { groundStationApiFromAgent } from "@/lib/api/ground-station-api";

export function MeshGatewaysTable() {
  const t = useTranslations("hardware.mesh");
  const gateways = useGroundStationStore((s) => s.mesh.gateways);
  const selected = useGroundStationStore((s) => s.mesh.selectedGateway);
  const pinMeshGateway = useGroundStationStore((s) => s.pinMeshGateway);
  const agentUrl = useAgentConnectionStore((s) => s.agentUrl);
  const apiKey = useAgentConnectionStore((s) => s.apiKey);

  const rowRefs = useRef<Array<HTMLTableRowElement | null>>([]);

  const onPin = async (mac: string) => {
    const api = groundStationApiFromAgent(agentUrl, apiKey);
    if (!api) return;
    await pinMeshGateway(api, { mode: "pinned", pinned_mac: mac });
  };

  const onAuto = async () => {
    const api = groundStationApiFromAgent(agentUrl, apiKey);
    if (!api) return;
    await pinMeshGateway(api, { mode: "auto" });
  };

  const moveFocus = (from: number, delta: number) => {
    const next = from + delta;
    if (next < 0 || next >= gateways.length) return;
    rowRefs.current[next]?.focus();
  };

  const onRowKeyDown = (idx: number, mac: string, isSelected: boolean) => (
    e: React.KeyboardEvent<HTMLTableRowElement>,
  ) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveFocus(idx, 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveFocus(idx, -1);
    } else if (e.key === "Home") {
      e.preventDefault();
      rowRefs.current[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      rowRefs.current[gateways.length - 1]?.focus();
    } else if ((e.key === "Enter" || e.key === " ") && !isSelected) {
      e.preventDefault();
      void onPin(mac);
    }
  };

  if (gateways.length === 0) {
    return (
      <div className="p-4 bg-bg-primary border border-border-default/40">
        <div className="text-sm text-text-tertiary italic">{t("noGateways")}</div>
      </div>
    );
  }

  return (
    <div className="bg-bg-primary border border-border-default/40">
      <div className="px-4 py-2 flex items-center justify-between border-b border-border-default/40">
        <div className="text-sm font-medium text-text-primary">
          {t("gateways")} ({gateways.length})
        </div>
        <button
          type="button"
          onClick={onAuto}
          className="px-2 py-1 text-[10px] text-text-secondary border border-border-default/60 hover:text-text-primary hover:bg-bg-primary transition-colors"
        >
          {t("autoPick")}
        </button>
      </div>
      <div className="px-4 py-2 text-[10px] text-text-tertiary italic border-b border-border-default/40">
        {t("pinHint")}
      </div>
      <div className="overflow-x-auto">
      <table
        role="table"
        aria-label={t("gatewaysAriaLabel")}
        className="w-full text-xs"
      >
        <thead>
          <tr className="text-text-tertiary uppercase tracking-wider">
            <th scope="col" className="px-4 py-2 text-left">{t("colGateway")}</th>
            <th scope="col" className="px-4 py-2 text-right">{t("colUp")}</th>
            <th scope="col" className="px-4 py-2 text-right">{t("colDown")}</th>
            <th scope="col" className="px-4 py-2 text-right">{t("colTq")}</th>
            <th scope="col" className="px-4 py-2 text-right">{t("colAction")}</th>
          </tr>
        </thead>
        <tbody>
          {gateways.map((gw, idx) => {
            const isSelected = gw.mac === selected;
            return (
              <tr
                key={gw.mac}
                ref={(el) => {
                  rowRefs.current[idx] = el;
                }}
                tabIndex={idx === 0 ? 0 : -1}
                onKeyDown={onRowKeyDown(idx, gw.mac, isSelected)}
                className={
                  isSelected
                    ? "border-t border-border-default/20 bg-accent-primary/5 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary"
                    : "border-t border-border-default/20 hover:bg-bg-primary focus:outline-none focus:bg-accent-primary/10 focus-visible:ring-1 focus-visible:ring-accent-primary"
                }
              >
                <th scope="row" className="px-4 py-2 text-left font-mono text-text-primary">
                  {isSelected ? "★ " : ""}{gw.mac}
                </th>
                <td className="px-4 py-2 text-right font-mono text-text-secondary">
                  {gw.class_up_kbps} kbps
                </td>
                <td className="px-4 py-2 text-right font-mono text-text-secondary">
                  {gw.class_down_kbps} kbps
                </td>
                <td className="px-4 py-2 text-right font-mono text-text-primary">{gw.tq}</td>
                <td className="px-4 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => onPin(gw.mac)}
                    aria-label={t("pinGatewayAriaLabel", { mac: gw.mac })}
                    disabled={isSelected}
                    className="px-2 py-1 text-[10px] text-accent-primary border border-accent-primary/40 hover:bg-accent-primary/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {t("pinGateway")}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}
