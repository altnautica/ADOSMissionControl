"use client";

/**
 * @module ModuleStoreTab
 * @description Module store with suites-primary layout, search, and category filtering.
 * @license GPL-3.0-only
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Package, Download, Check, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/stores/agent-store";
import { AgentDisconnectedPage } from "./AgentDisconnectedPage";
import { CategoryFilter } from "./shared/CategoryFilter";
import { SuiteCard } from "./shared/SuiteCard";
import type { MockModule } from "@/mock/mock-agent";

type ViewCategory = "all" | "suites" | "modules";

export function ModuleStoreTab() {
  const t = useTranslations("moduleStore");
  const connected = useAgentStore((s) => s.connected);
  const suites = useAgentStore((s) => s.suites);
  const fetchSuites = useAgentStore((s) => s.fetchSuites);
  const installSuite = useAgentStore((s) => s.installSuite);
  const activateSuite = useAgentStore((s) => s.activateSuite);
  const [modules, setModules] = useState<MockModule[]>([]);
  const [activeCategory, setActiveCategory] = useState<ViewCategory>("all");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!connected) return;
    fetchSuites();
    import("@/mock/mock-agent").then((mod) =>
      setModules(mod.MOCK_MODULES.map((m) => ({ ...m })))
    );
  }, [connected, fetchSuites]);

  const handleModuleInstall = useCallback((name: string) => {
    setModules((prev) =>
      prev.map((m) =>
        m.name === name ? { ...m, installed: true } : m
      )
    );
  }, []);

  const filteredSuites = useMemo(() => {
    if (!searchQuery) return suites;
    const q = searchQuery.toLowerCase();
    return suites.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
    );
  }, [suites, searchQuery]);

  const filteredModules = useMemo(() => {
    if (!searchQuery) return modules;
    const q = searchQuery.toLowerCase();
    return modules.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q)
    );
  }, [modules, searchQuery]);

  const categories = [
    { id: "all" as const, label: t("all") },
    { id: "suites" as const, label: t("suites"), count: suites.length },
    { id: "modules" as const, label: t("modules"), count: modules.length },
  ];

  if (!connected) {
    return <AgentDisconnectedPage />;
  }

  const showSuites = activeCategory === "all" || activeCategory === "suites";
  const showModules = activeCategory === "all" || activeCategory === "modules";
  const installedModules = filteredModules.filter((m) => m.installed);
  const availableModules = filteredModules.filter((m) => !m.installed);

  return (
    <div className="p-4 max-w-4xl space-y-4">
      {/* Search and filter */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 flex-1 max-w-sm border border-border-default rounded px-2.5 py-1.5 focus-within:border-accent-primary transition-colors">
          <Search size={12} className="text-text-tertiary" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-tertiary outline-none"
          />
        </div>
        <CategoryFilter
          categories={categories}
          active={activeCategory}
          onChange={(id) => setActiveCategory(id as ViewCategory)}
        />
      </div>

      {/* Suites */}
      {showSuites && filteredSuites.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary mb-3">
            {t("featuredSuites")}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filteredSuites.map((suite) => (
              <SuiteCard
                key={suite.id}
                suite={suite}
                onInstall={installSuite}
                onActivate={activateSuite}
              />
            ))}
          </div>
        </div>
      )}

      {/* Modules - Installed */}
      {showModules && installedModules.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary mb-3">
            {t("installedModules", { count: installedModules.length })}
          </h3>
          <div className="space-y-2">
            {installedModules.map((mod) => (
              <div
                key={mod.name}
                className="flex items-center justify-between border border-border-default rounded-lg p-3 bg-bg-secondary"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text-primary">
                      {mod.name}
                    </span>
                    <span className="text-[10px] font-mono text-text-tertiary">
                      v{mod.version}
                    </span>
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-status-success/15 text-status-success">
                      <Check size={10} />
                      {t("installed")}
                    </span>
                  </div>
                  <p className="text-xs text-text-tertiary mt-0.5">
                    {mod.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modules - Available */}
      {showModules && availableModules.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary mb-3">
            {t("availableModules", { count: availableModules.length })}
          </h3>
          <div className="space-y-2">
            {availableModules.map((mod) => (
              <div
                key={mod.name}
                className="flex items-center justify-between border border-border-default rounded-lg p-3 bg-bg-secondary"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text-primary">
                      {mod.name}
                    </span>
                    <span className="text-[10px] font-mono text-text-tertiary">
                      v{mod.version}
                    </span>
                  </div>
                  <p className="text-xs text-text-tertiary mt-0.5">
                    {mod.description}
                  </p>
                </div>
                <button
                  onClick={() => handleModuleInstall(mod.name)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-accent-primary text-white rounded hover:opacity-90 transition-opacity shrink-0 ml-3"
                >
                  <Download size={12} />
                  {t("install")}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
