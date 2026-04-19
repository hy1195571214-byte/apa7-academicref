import Link from "next/link";
import { ThemeToggle } from "./ThemeToggle";
import { cn } from "@/lib/utils";

export function SiteHeader({ currentPath = "/" }: { currentPath?: string }) {
  const navButton = (path: string, active: boolean) =>
    cn(
      "rounded-lg px-4 py-2 text-sm transition-colors",
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
            <Link href="/" className={navButton("/", currentPath === "/")}>
              转换
            </Link>
            <Link href="/library" className={navButton("/library", currentPath === "/library")}>
              文献库
            </Link>
          </nav>
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}
