"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { cn } from "@/lib/utils";
import { useBackgroundTasks } from "@/lib/background-tasks";

export function SiteHeader({ currentPath = "/" }: { currentPath?: string }) {
  const { citationRun, summaryRun } = useBackgroundTasks();
  const citationActive = citationRun?.phase === "processing";
  const summaryActive = summaryRun?.phase === "processing";

  const navButton = (path: string, active: boolean) =>
    cn(
      "relative inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm transition-colors",
      active
        ? "bg-accent text-accent-foreground"
        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
    );

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-8">
          <Link href="/" className="block">
            <h1 className="text-xl font-medium leading-tight">AcademicRef</h1>
            <p className="text-sm text-muted-foreground">学术引用格式化工具</p>
          </Link>
          <nav className="flex gap-1">
            <Link
              href="/"
              className={navButton("/", currentPath === "/")}
              title={citationActive ? "有引用任务正在后台处理" : undefined}
            >
              <span>转换</span>
              {citationActive && <TaskDot />}
            </Link>
            <Link href="/library" className={navButton("/library", currentPath === "/library")}>
              文献库
            </Link>
            <Link
              href="/summary"
              className={navButton("/summary", currentPath === "/summary")}
              title={summaryActive ? "有概要任务正在后台处理" : undefined}
            >
              <span>概要</span>
              {summaryActive && <TaskDot />}
            </Link>
          </nav>
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}

function TaskDot() {
  return (
    <span className="inline-flex items-center" aria-label="处理中">
      <Loader2 className="h-3 w-3 animate-spin text-primary" />
    </span>
  );
}
