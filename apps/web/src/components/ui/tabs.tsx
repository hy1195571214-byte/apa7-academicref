"use client";

import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Tab<Id extends string> {
  id: Id;
  label: ReactNode;
}

interface TabsProps<Id extends string> {
  tabs: Tab<Id>[];
  value: Id;
  onChange: (id: Id) => void;
  className?: string;
}

export function Tabs<Id extends string>({ tabs, value, onChange, className }: TabsProps<Id>) {
  return (
    <div className={cn("inline-flex items-center gap-1 rounded-lg border border-border bg-muted p-1", className)}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            tab.id === value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
