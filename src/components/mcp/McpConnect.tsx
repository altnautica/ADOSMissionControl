/**
 * @module components/mcp/McpConnect
 * @description The Connect section, LOCAL-FIRST. It leads with the
 * LAN-direct path — the guided local wizard that points the server at a drone on
 * your network with the drone's own pairing key, no sign-in and no cloud — plus
 * the one-time clone-and-build. The cloud (`--target fleet`) recipes are a
 * collapsed, opt-in "manage from anywhere" block for remote reach.
 * @license GPL-3.0-only
 */

"use client";

import { useState, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Copy, Check, Rocket, Cloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMcpTabStore } from "@/stores/mcp-tab-store";
import { cloneAndBuildRecipe, connectRecipe, mcpJsonSnippet } from "./mcp-shared";

type Snippet = "cli" | "json";

export function McpConnect() {
  const t = useTranslations("mcp");
  const openWizard = useMcpTabStore((s) => s.openWizard);
  const [copied, setCopied] = useState<Snippet | "clone" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const placeholder = t("connectPlaceholder");
  const recipe = connectRecipe(placeholder);
  const json = mcpJsonSnippet(placeholder);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy(which: Snippet | "clone", text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(null), 2000);
    } catch {
      /* clipboard unavailable — the text stays selectable */
    }
  }

  const block = (which: Snippet | "clone", label: string, text: string) => (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-text-secondary">{label}</span>
      <div className="flex items-start gap-2">
        <pre className="flex-1 overflow-x-auto rounded-md border border-border-default bg-bg-tertiary p-3 font-mono text-xs text-text-primary">
          {text}
        </pre>
        <Button
          variant="secondary"
          size="sm"
          icon={copied === which ? <Check size={14} /> : <Copy size={14} />}
          onClick={() => copy(which, text)}
        >
          {copied === which ? t("reveal.copied") : t("reveal.copy")}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      {/* Primary: LAN-direct */}
      <section className="flex flex-col gap-4">
        <header className="flex flex-col gap-1">
          <h2 className="text-base font-semibold text-text-primary">{t("local.title")}</h2>
          <p className="text-sm text-text-secondary">{t("local.body")}</p>
        </header>
        {block("clone", t("wizard.get.title"), cloneAndBuildRecipe())}
        <div>
          <Button icon={<Rocket size={16} />} onClick={openWizard}>
            {t("local.cta")}
          </Button>
        </div>
      </section>

      {/* Secondary: cloud relay (opt-in) */}
      <details className="rounded-lg border border-border-default bg-bg-primary p-4">
        <summary className="flex cursor-pointer select-none items-center gap-2 text-sm font-medium text-text-secondary">
          <Cloud size={15} className="text-text-tertiary" />
          {t("cloud.title")}
        </summary>
        <div className="mt-3 flex flex-col gap-4">
          <p className="text-sm text-text-tertiary">{t("cloud.body")}</p>
          {block("cli", t("connect.cliLabel"), recipe)}
          {block("json", t("connect.jsonLabel"), json)}
          <p className="text-xs text-text-tertiary">{t("connect.jsonNote")}</p>
          <p className="text-xs text-text-tertiary">{t("credentialNote")}</p>
          <p className="text-xs text-text-tertiary">{t("selfHostNote")}</p>
        </div>
      </details>
    </div>
  );
}
