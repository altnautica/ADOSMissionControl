/**
 * @module components/mcp/McpScopesReference
 * @description The Scopes & roles reference: a read-only explainer of what each
 * scope group grants and what the role presets bundle. This is where an operator
 * learns why admin sits above safe_write, that secret_read is a modifier on read,
 * and that a destructive scope is not a flight scope.
 * @license GPL-3.0-only
 */

"use client";

import { useTranslations } from "next-intl";
import { ShieldCheck } from "lucide-react";
import {
  ELEVATED_SCOPES,
  SAFETY_CLASSES,
  SCOPE_PRESETS,
  SCOPE_PRESET_ORDER,
  safetyClassBadge,
  type SafetyClass,
} from "./mcp-shared";

export function McpScopesReference() {
  const t = useTranslations("mcp");

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-base font-semibold text-text-primary">
          <ShieldCheck size={16} />
          {t("scopes.title")}
        </h2>
        <p className="text-sm text-text-secondary">{t("scopes.subtitle")}</p>
      </header>

      <section className="flex flex-col gap-2">
        <h3 className="font-mono text-xs uppercase tracking-wide text-text-tertiary">
          {t("scopes.groupsTitle")}
        </h3>
        <div className="flex flex-col gap-1.5">
          {SAFETY_CLASSES.map((group) => (
            <div
              key={group}
              className="flex flex-col gap-1 rounded-lg border border-border-default bg-bg-secondary p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${safetyClassBadge(group)}`}
                >
                  {group}
                </span>
                {ELEVATED_SCOPES.includes(group as SafetyClass) ? (
                  <span className="rounded bg-status-warning/15 px-1.5 py-0.5 text-[10px] uppercase text-status-warning">
                    {t("scopes.elevated")}
                  </span>
                ) : null}
              </div>
              <p className="text-xs leading-relaxed text-text-secondary">
                {t(`scopes.group.${group}`)}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-mono text-xs uppercase tracking-wide text-text-tertiary">
          {t("scopes.rolesTitle")}
        </h3>
        <div className="flex flex-col gap-1.5">
          {/* Only the presets the Generate dialog can mint are described. */}
          {SCOPE_PRESET_ORDER.map((role) => (
            <div
              key={role}
              className="flex flex-col gap-1.5 rounded-lg border border-border-default bg-bg-secondary p-3"
            >
              <span className="text-sm font-medium text-text-primary">
                {t(`presets.${role}.label`)}
              </span>
              <p className="text-xs leading-relaxed text-text-secondary">
                {t(`presets.${role}.body`)}
              </p>
              <div className="flex flex-wrap gap-1">
                {SCOPE_PRESETS[role].map((scope) => (
                  <span
                    key={scope}
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${safetyClassBadge(scope)}`}
                  >
                    {scope}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
