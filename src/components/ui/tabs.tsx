"use client";

import { cn } from "@/lib/utils";

interface Tab {
  id: string;
  label: string;
}

interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (id: string) => void;
  className?: string;
}

export function Tabs({ tabs, activeTab, onChange, className }: TabsProps) {
  return (
    <div className={cn("flex border-b border-border-default flex-shrink-0", className)}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            "px-4 py-2 text-xs font-medium transition-colors cursor-pointer -mb-px border-b-2",
            activeTab === tab.id
              ? "text-accent-primary border-accent-primary"
              : "text-text-secondary hover:text-text-primary border-transparent"
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
