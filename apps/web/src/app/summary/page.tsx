import { SiteHeader } from "@/components/site/SiteHeader";
import { SummaryPanel } from "@/components/summary/SummaryPanel";

export default function SummaryPage() {
  return (
    <>
      <SiteHeader currentPath="/summary" />
      <main className="mx-auto max-w-7xl px-6 py-8">
        <SummaryPanel />
      </main>
    </>
  );
}
