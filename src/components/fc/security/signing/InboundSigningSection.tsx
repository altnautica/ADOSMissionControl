"use client";

/**
 * @module components/fc/security/signing/InboundSigningSection
 * @description Inbound signature verification for the selected drone: one
 * row of counters per MAVLink link (frames whose signature verified against
 * this browser's key, frames that failed, frames that arrived unsigned), and
 * the setting that drops every unsigned or failed frame.
 *
 * Verified and failed counts move only while a key is loaded: with no key
 * there is nothing to verify against.
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { useSigningStore } from "@/stores/signing-store";
import { useSettingsStore } from "@/stores/settings-store";
import { FcSection } from "@/components/fc/shared/FcSection";

export function InboundSigningSection() {
  const tl = useTranslations("fcPanels.inboundSigningSection");
  const protocol = useDroneManager(selectSelectedProtocol);
  const counters = useSigningStore((s) => s.linkCounters);
  const enforce = useSettingsStore((s) => s.enforceInboundSigning);
  const setEnforce = useSettingsStore((s) => s.setEnforceInboundSigning);
  const links = protocol?.linkInfo ?? [];

  return (
    <FcSection>
      <div>
        <h2 className="text-sm font-semibold text-text-primary">{tl("inboundVerification")}</h2>
        <p className="text-xs text-text-tertiary">
          Signatures on frames received from the vehicle, checked against this browser&apos;s key.
        </p>
      </div>
      {links.length === 0 ? (
        <p className="text-xs text-text-tertiary">{tl("noMAVLinkLinkIsOpen")}</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-text-tertiary">
              <th className="font-normal py-1">{tl("link")}</th>
              <th className="font-normal py-1 text-right">{tl("verified")}</th>
              <th className="font-normal py-1 text-right">{tl("failed")}</th>
              <th className="font-normal py-1 text-right">{tl("unsigned")}</th>
            </tr>
          </thead>
          <tbody className="font-mono text-text-secondary">
            {links.map((link) => {
              const c = counters[link.id];
              return (
                <tr key={link.id}>
                  <td className="py-1">
                    {link.label}
                    {link.isPrimary && <span className="ml-2 text-text-tertiary">primary</span>}
                  </td>
                  <td className="py-1 text-right">{c ? c.signedOk : "—"}</td>
                  <td className={c && c.signedBad > 0 ? "py-1 text-right text-status-error" : "py-1 text-right"}>
                    {c ? c.signedBad : "—"}
                  </td>
                  <td className="py-1 text-right">{c ? c.unsigned : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <label className="flex items-start gap-2 text-xs text-text-secondary cursor-pointer">
        <input
          type="checkbox"
          checked={enforce}
          onChange={(e) => setEnforce(e.target.checked)}
          className="mt-0.5 accent-accent-primary"
        />
        <span>
          Require signed telemetry. While a key is loaded, every frame that is unsigned or fails
          verification is dropped. A vehicle that does not sign its replies goes silent.
        </span>
      </label>
    </FcSection>
  );
}
