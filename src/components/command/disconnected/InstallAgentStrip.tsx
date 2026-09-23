"use client";

/**
 * @module InstallAgentStrip
 * @description Collapsible "First time? Install a new agent" disclosure
 * for the disconnected page. Default collapsed so the surface stays
 * focused on the pair input above; expand reveals the canonical
 * curl one-liner with a copy button.
 *
 * Folded out of the prior `AddNodeCard` install branch when the
 * disconnected page was collapsed onto a single focused surface.
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronDown, Copy, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { INSTALL_URL } from "../pairing/use-pairing-flow";

const INSTALL_COMMAND = `curl -sSL ${INSTALL_URL} | sudo bash`;

export function InstallAgentStrip() {
  const t = useTranslations("command.addNode");
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard rejection is non-fatal
    }
  }

  return (
    <div className="bg-bg-secondary border border-border-default rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-bg-tertiary transition-colors"
      >
        <div className="w-8 h-8 rounded-full bg-bg-tertiary flex items-center justify-center shrink-0">
          <Plus size={14} className="text-text-secondary" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-text-primary">
            {t("installAgent")}
          </p>
          <p className="text-[10px] text-text-tertiary">
            {t("installAgentDescription")}
          </p>
        </div>
        <ChevronDown
          size={14}
          className={cn(
            "text-text-tertiary transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="px-4 pb-4">
          <div className="flex items-start gap-2 p-3 bg-bg-primary border border-border-default rounded">
            <code className="flex-1 text-xs font-mono text-text-secondary leading-relaxed break-all select-all">
              {INSTALL_COMMAND}
            </code>
            <button
              onClick={handleCopy}
              className="p-1.5 text-text-tertiary hover:text-text-primary transition-colors shrink-0"
              title={t("copyInstallCommand")}
              aria-label={t("copyInstallCommand")}
            >
              {copied ? (
                <Check size={14} className="text-status-success" />
              ) : (
                <Copy size={14} />
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
