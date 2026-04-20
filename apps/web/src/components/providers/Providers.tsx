"use client";

import { BackgroundTasksProvider } from "@/lib/background-tasks";

export function Providers({ children }: { children: React.ReactNode }) {
  return <BackgroundTasksProvider>{children}</BackgroundTasksProvider>;
}
