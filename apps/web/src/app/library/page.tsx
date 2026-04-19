import { SiteHeader } from "@/components/site/SiteHeader";
import { LibraryPanel } from "@/components/library/LibraryPanel";

export default function LibraryPage() {
  return (
    <>
      <SiteHeader currentPath="/library" />
      <main className="mx-auto max-w-7xl px-6 py-8">
        <LibraryPanel />
      </main>
    </>
  );
}
