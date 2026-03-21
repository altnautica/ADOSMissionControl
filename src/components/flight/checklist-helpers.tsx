import { Check, X, Circle, SkipForward } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { useChecklistStore, type ChecklistItem, type ChecklistItemStatus, type ChecklistCategory } from "@/stores/checklist-store";
import { cn } from "@/lib/utils";

export const CATEGORY_ORDER: ChecklistCategory[] = ["hardware", "software", "environment", "mission"];

/** Translation keys for checklist category labels — use with t(key) from "checklist" namespace */
export const CATEGORY_LABEL_KEYS: Record<ChecklistCategory, string> = {
  hardware: "hardware",
  software: "software",
  environment: "environment",
  mission: "mission",
};

export function StatusIcon({ status }: { status: ChecklistItemStatus }) {
  switch (status) {
    case "pass":
      return <Check size={12} className="text-status-success shrink-0" />;
    case "fail":
      return <X size={12} className="text-status-error shrink-0" />;
    case "skipped":
      return <SkipForward size={10} className="text-text-tertiary shrink-0" />;
    default:
      return <Circle size={10} className="text-text-tertiary shrink-0" />;
  }
}

export function ChecklistRow({ item }: { item: ChecklistItem }) {
  const toggleManualItem = useChecklistStore((s) => s.toggleManualItem);
  const skipItem = useChecklistStore((s) => s.skipItem);

  const isManual = item.type === "manual";
  const isClickable = isManual;

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 group",
        isClickable && "cursor-pointer hover:bg-bg-tertiary transition-colors",
      )}
      onClick={isClickable ? () => toggleManualItem(item.id) : undefined}
    >
      <StatusIcon status={item.status} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "text-[11px]",
              item.status === "pass" && "text-text-secondary line-through",
              item.status === "fail" && "text-status-error",
              item.status === "pending" && "text-text-primary",
              item.status === "skipped" && "text-text-tertiary line-through",
            )}
          >
            {item.label}
          </span>
          {item.type === "auto" && (
            <span className="text-[8px] font-mono uppercase text-text-tertiary bg-bg-tertiary px-1 py-0.5">
              AUTO
            </span>
          )}
        </div>
      </div>
      {item.displayValue && (
        <span
          className={cn(
            "text-[10px] font-mono tabular-nums",
            item.status === "pass" && "text-status-success",
            item.status === "fail" && "text-status-error",
            item.status === "pending" && "text-text-tertiary",
          )}
        >
          {item.displayValue}
        </span>
      )}
      {/* Skip button for manual items */}
      {isManual && item.status !== "pass" && (
        <Tooltip content="Skip this check" position="left">
          <button
            onClick={(e) => {
              e.stopPropagation();
              skipItem(item.id);
            }}
            className="opacity-0 group-hover:opacity-100 p-0.5 text-text-tertiary hover:text-text-secondary transition-all"
          >
            <SkipForward size={10} />
          </button>
        </Tooltip>
      )}
    </div>
  );
}
