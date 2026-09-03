"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ChevronUp, ChevronDown } from "lucide-react";

export interface Column<T> {
  key: string;
  label: string;
  sortable?: boolean;
  width?: string;
  render?: (row: T) => ReactNode;
}

interface TableProps<T> {
  columns: Column<T>[];
  data: T[];
  onRowClick?: (row: T) => void;
  selectedRow?: string;
  rowKey?: (row: T) => string;
  className?: string;
}

export function Table<T extends Record<string, unknown>>({
  columns,
  data,
  onRowClick,
  selectedRow,
  rowKey,
  className,
}: TableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sortedData = sortKey
    ? [...data].sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        if (typeof av === "number" && typeof bv === "number") {
          return sortDir === "asc" ? av - bv : bv - av;
        }
        const as = String(av ?? "");
        const bs = String(bv ?? "");
        return sortDir === "asc" ? as.localeCompare(bs) : bs.localeCompare(as);
      })
    : data;

  return (
    <div className={cn("overflow-auto", className)}>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border-default">
            {columns.map((col) => (
              <th
                key={col.key}
                // `aria-sort` on the header cell is how a screen reader
                // announces which column orders the table and in which
                // direction. Without it the chevron is the only channel.
                aria-sort={
                  col.sortable
                    ? sortKey === col.key
                      ? sortDir === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                    : undefined
                }
                className={cn(
                  "px-3 py-2 text-left font-semibold text-text-secondary uppercase tracking-wider",
                  col.sortable && "select-none"
                )}
                style={col.width ? { width: col.width } : undefined}
              >
                {col.sortable ? (
                  // Sorting used to live on `<th onClick>`: not focusable and
                  // inert to the keyboard, so ordering a table was
                  // pointer-only. A real button carries the affordance.
                  <button
                    type="button"
                    onClick={() => handleSort(col.key)}
                    className="flex w-full items-center gap-1 text-left uppercase tracking-wider cursor-pointer hover:text-text-primary focus-ring-inset"
                  >
                    {col.label}
                    {sortKey === col.key &&
                      (sortDir === "asc" ? (
                        <ChevronUp size={12} aria-hidden="true" />
                      ) : (
                        <ChevronDown size={12} aria-hidden="true" />
                      ))}
                  </button>
                ) : (
                  <div className="flex items-center gap-1">{col.label}</div>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedData.map((row, i) => {
            const key = rowKey ? rowKey(row) : String(i);
            const interactive = Boolean(onRowClick);
            return (
              <tr
                key={key}
                className={cn(
                  "border-b border-border-default transition-colors",
                  interactive && "cursor-pointer hover:bg-bg-tertiary focus-ring-inset",
                  selectedRow === key && "bg-accent-primary/10"
                )}
                onClick={() => onRowClick?.(row)}
                // A clickable row had no way in from the keyboard. `<tr>`
                // cannot host a button without breaking table semantics, so
                // the row itself becomes focusable and activatable.
                tabIndex={interactive ? 0 : undefined}
                aria-selected={interactive ? selectedRow === key : undefined}
                onKeyDown={
                  interactive
                    ? (e) => {
                        if (e.key !== "Enter" && e.key !== " ") return;
                        e.preventDefault();
                        onRowClick?.(row);
                      }
                    : undefined
                }
              >
                {columns.map((col) => (
                  <td key={col.key} className="px-3 py-2 text-text-primary">
                    {col.render ? col.render(row) : String(row[col.key] ?? "")}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
