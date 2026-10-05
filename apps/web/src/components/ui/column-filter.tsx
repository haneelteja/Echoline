"use client";
import { ArrowDown, ArrowUp, ArrowUpDown, MoreVertical, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type SortDirection = "asc" | "desc" | null;

interface ColumnFilterProps {
  label: string;
  dataType?: "text" | "select";
  options?: string[];
  filterValue: string;
  onFilterChange: (value: string) => void;
  sortDirection: SortDirection;
  onSortChange: (direction: SortDirection) => void;
}

/** Per-column sort + filter, triggered by a 3-dot menu in the table header —
 * same interaction as Sales Operations Portal's ColumnFilter, adapted to a
 * single text-or-select input instead of its multiselect/date/number variants
 * (this app's columns don't need those yet). */
export function ColumnFilter({ label, dataType = "text", options = [], filterValue, onFilterChange, sortDirection, onSortChange }: ColumnFilterProps) {
  const active = Boolean(filterValue) || sortDirection !== null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className={cn("h-6 w-6", active && "text-primary")}>
          <MoreVertical className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 p-3">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Sort {label}</Label>
            <div className="flex gap-1.5">
              <Button
                variant={sortDirection === "asc" ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => onSortChange(sortDirection === "asc" ? null : "asc")}
              >
                <ArrowUp className="h-3.5 w-3.5" />
                Asc
              </Button>
              <Button
                variant={sortDirection === "desc" ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => onSortChange(sortDirection === "desc" ? null : "desc")}
              >
                <ArrowDown className="h-3.5 w-3.5" />
                Desc
              </Button>
            </div>
          </div>

          <DropdownMenuSeparator />

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Filter {label}</Label>
            {dataType === "select" ? (
              <Select value={filterValue} onChange={(e) => onFilterChange(e.target.value)}>
                <option value="">All {label.toLowerCase()}</option>
                {options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            ) : (
              <Input placeholder={`Search ${label.toLowerCase()}…`} value={filterValue} onChange={(e) => onFilterChange(e.target.value)} />
            )}
          </div>

          {active && (
            <>
              <DropdownMenuSeparator />
              <div className="flex gap-1.5">
                {filterValue && (
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => onFilterChange("")}>
                    <X className="h-3.5 w-3.5" />
                    Clear filter
                  </Button>
                )}
                {sortDirection && (
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => onSortChange(null)}>
                    <X className="h-3.5 w-3.5" />
                    Clear sort
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SortIndicator({ direction }: { direction: SortDirection }) {
  const Icon = direction === "asc" ? ArrowUp : direction === "desc" ? ArrowDown : ArrowUpDown;
  return <Icon className={cn("h-3 w-3", direction ? "text-foreground" : "text-muted-foreground/50")} />;
}
