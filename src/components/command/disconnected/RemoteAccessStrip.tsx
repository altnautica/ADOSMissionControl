"use client";

/**
 * @module RemoteAccessStrip
 * @description Collapsible "Reach drones from outside this network"
 * disclosure for the disconnected page. Default collapsed so the
 * surface stays focused on the pair input above; expand reveals the
 * one-liner pitch and a sign-in button.
 *
 * Folded out of the prior `AddNodeCard` sign-in branch when the
 * disconnected page was collapsed onto a single focused surface.
 * Cloud relay is orthogonal to local pair, so it lives below the
 * primary entry point rather than next to it.
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight, CloudOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface RemoteAccessStripProps {
  onSignIn: () => void;
}

export function RemoteAccessStrip({ onSignIn }: RemoteAccessStripProps) {
  const t = useTranslations("command.addNode");
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-bg-secondary border border-border-default rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-bg-tertiary transition-colors"
      >
        <div className="w-8 h-8 rounded-full bg-bg-tertiary flex items-center justify-center shrink-0">
          <CloudOff size={14} className="text-text-secondary" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-text-primary">
            {t("signInForRemote")}
          </p>
          <p className="text-[10px] text-text-tertiary">
            {t("signInDescription")}
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
        <div className="px-4 pb-4 space-y-3">
          <p className="text-xs text-text-secondary leading-relaxed">
            {t("signInBody")}
          </p>
          <button
            type="button"
            onClick={onSignIn}
            className="w-full px-4 py-2 text-xs font-medium bg-accent-primary text-accent-foreground rounded hover:bg-accent-primary/90 transition-colors inline-flex items-center justify-center gap-1.5"
          >
            {t("signInButton")}
            <ChevronRight size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
