export type FilterMode = "all" | "changed" | "added" | "unchanged";

export const STATUS_STYLES: Record<string, string> = {
  changed: "text-status-warning",
  added: "text-accent-primary",
  unchanged: "text-text-tertiary",
};

/** `fcPanels.paramCompare` key of each row status. */
export const STATUS_KEYS = {
  changed: "statusChanged",
  added: "statusAdded",
  unchanged: "statusUnchanged",
} as const;

/** `fcPanels.paramCompare` key of each filter, given its `{count}`. */
export const FILTER_KEYS = {
  all: "filterAll",
  changed: "filterChanged",
  added: "filterAdded",
  unchanged: "filterUnchanged",
} as const satisfies Record<FilterMode, string>;

export const FILTER_MODES: FilterMode[] = ["all", "changed", "added", "unchanged"];

export const TH = "px-2 py-1.5 text-text-tertiary font-semibold uppercase tracking-wider text-[10px]";
