"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ColumnVisibilityToggle } from "../shared/ColumnVisibilityToggle";
import { cn } from "@/lib/utils";
import {
  Search,
  Download,
  GitCompareArrows,
  PenLine,
  RotateCcw,
  RotateCw,
  RefreshCw,
  AlertTriangle,
  Filter,
  Star,
  Zap,
} from "lucide-react";

interface ParameterSearchFilterProps {
  filter: string;
  onFilterChange: (filter: string) => void;
  showModifiedOnly: boolean;
  onToggleModified: () => void;
  showNonDefault: boolean;
  onToggleNonDefault: () => void;
  showFavorites: boolean;
  onToggleFavorites: () => void;
  paramCount: number;
  modifiedCount: number;
  loading: boolean;
  saving: boolean;
  progress: { current: number; total: number };
  writeProgress: { current: number; total: number };
  error: string | null;
  onDismissError: () => void;
  onExport: () => void;
  onCompare: () => void;
  onDefaultsDiff: () => void;
  onRevert: () => void;
  onResetDefaults: () => void;
  onSave: () => void;
  onRefresh: () => void;
}

export function ParameterSearchFilter({
  filter,
  onFilterChange,
  showModifiedOnly,
  onToggleModified,
  showNonDefault,
  onToggleNonDefault,
  showFavorites,
  onToggleFavorites,
  paramCount,
  modifiedCount,
  loading,
  saving,
  progress,
  writeProgress,
  error,
  onDismissError,
  onExport,
  onCompare,
  onDefaultsDiff,
  onRevert,
  onResetDefaults,
  onSave,
  onRefresh,
}: ParameterSearchFilterProps) {
  const progressPercent = progress.total > 0
    ? Math.round((progress.current / progress.total) * 100)
    : 0;

  return (
    <>
      <div className="flex-shrink-0 border-b border-border-default bg-bg-secondary px-4 py-3">
        <div className="flex items-center gap-3 mb-3">
          <h1 className="text-sm font-display font-semibold text-text-primary">
            FC Parameters
          </h1>
          {paramCount > 0 && (
            <Badge variant="info" size="sm">{paramCount} params</Badge>
          )}
          {modifiedCount > 0 && (
            <Badge variant="warning" size="sm">{modifiedCount} changed</Badge>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="relative flex-1 max-w-sm">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-tertiary" />
            <input
              type="text"
              value={filter}
              onChange={(e) => onFilterChange(e.target.value)}
              placeholder="Search parameters..."
              className="w-full h-8 pl-7 pr-2 bg-bg-tertiary border border-border-default text-xs font-mono text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary transition-colors"
            />
          </div>

          {/* Filter toggles */}
          <Button
            variant={showModifiedOnly ? "primary" : "ghost"}
            size="sm"
            icon={<Filter size={12} />}
            onClick={onToggleModified}
            title="Show only parameters you've changed this session"
            className={cn(showModifiedOnly && "bg-status-warning text-bg-primary hover:bg-status-warning/90")}
          >
            Modified
          </Button>

          <Button
            variant={showNonDefault ? "primary" : "ghost"}
            size="sm"
            icon={<Zap size={12} />}
            onClick={onToggleNonDefault}
            title="Show parameters that differ from firmware defaults"
            className={cn(showNonDefault && "bg-accent-primary text-bg-primary hover:bg-accent-primary/90")}
          >
            Non-Default
          </Button>

          {showNonDefault && (
            <button
              onClick={onDefaultsDiff}
              className="text-[10px] text-accent-primary hover:underline cursor-pointer"
              title="Open detailed diff view comparing current values to firmware defaults"
            >
              View diff
            </button>
          )}

          <Button
            variant={showFavorites ? "primary" : "ghost"}
            size="sm"
            icon={<Star size={12} />}
            onClick={onToggleFavorites}
            title="Show only starred parameters"
            className={cn(showFavorites && "bg-status-warning text-bg-primary hover:bg-status-warning/90")}
          >
            Favorites
          </Button>

          <ColumnVisibilityToggle />

          <div className="w-px h-5 bg-border-default" />

          {/* File ops */}
          <Button variant="secondary" size="sm" icon={<Download size={12} />} onClick={onExport} disabled={paramCount === 0} title="Download all parameters as a .param file">Export</Button>
          <Button variant="secondary" size="sm" icon={<GitCompareArrows size={12} />} onClick={onCompare} disabled={paramCount === 0} title="Load a .param file and compare against current FC values">Compare</Button>

          <div className="w-px h-5 bg-border-default" />

          {/* Changes */}
          <Button variant="ghost" size="sm" icon={<RotateCcw size={12} />} onClick={onRevert} disabled={modifiedCount === 0} title="Discard all unsaved changes (does not affect FC)">Revert</Button>
          <Button variant="ghost" size="sm" icon={<RotateCw size={12} />} onClick={onResetDefaults} disabled={paramCount === 0 || saving} title="Reset ALL FC parameters to firmware factory defaults">Reset to Default</Button>
          <Button variant="primary" size="sm" icon={<PenLine size={12} />} onClick={onSave} disabled={modifiedCount === 0} loading={saving} title="Send changed parameters to the flight controller">
            {saving ? `Writing ${writeProgress.current}/${writeProgress.total}...` : `Write to FC (${modifiedCount})`}
          </Button>

          <div className="w-px h-5 bg-border-default" />

          {/* Sync */}
          <Button variant="secondary" size="sm" icon={<RefreshCw size={12} />} onClick={onRefresh} disabled={loading} loading={loading} title="Re-download all parameters from FC">Refresh</Button>
        </div>
      </div>

      {loading && (
        <div className="flex-shrink-0 px-4 py-2 bg-bg-secondary border-b border-border-default">
          <div className="flex items-center gap-3">
            <RefreshCw size={12} className="text-accent-primary animate-spin flex-shrink-0" />
            <span className="text-xs text-text-secondary">Downloading parameters... {progress.current}/{progress.total}</span>
            <div className="flex-1 h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
              <div className="h-full bg-accent-primary transition-all duration-200" style={{ width: `${progressPercent}%` }} />
            </div>
            <span className="text-xs text-text-tertiary font-mono">{progressPercent}%</span>
          </div>
        </div>
      )}

      {saving && writeProgress.total > 0 && (
        <div className="flex-shrink-0 px-4 py-2 bg-bg-secondary border-b border-border-default">
          <div className="flex items-center gap-3">
            <PenLine size={12} className="text-status-warning flex-shrink-0" />
            <span className="text-xs text-text-secondary">Writing parameters... {writeProgress.current}/{writeProgress.total}</span>
            <div className="flex-1 h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
              <div className="h-full bg-status-warning transition-all duration-200" style={{ width: `${Math.round((writeProgress.current / writeProgress.total) * 100)}%` }} />
            </div>
            <span className="text-xs text-text-tertiary font-mono">{Math.round((writeProgress.current / writeProgress.total) * 100)}%</span>
          </div>
        </div>
      )}

      {error && (
        <div className="flex-shrink-0 px-4 py-2 bg-status-error/10 border-b border-status-error/30 flex items-center gap-2">
          <AlertTriangle size={14} className="text-status-error flex-shrink-0" />
          <span className="text-xs text-status-error">{error}</span>
          <button onClick={onDismissError} className="ml-auto text-xs text-status-error hover:text-status-error/80 cursor-pointer">Dismiss</button>
        </div>
      )}
    </>
  );
}
