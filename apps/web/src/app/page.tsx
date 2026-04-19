import { SiteHeader } from "@/components/site/SiteHeader";
import { ConvertPanel } from "@/components/convert/ConvertPanel";

export default function Page() {
  return (
    <>
      <SiteHeader currentPath="/" />
      <main className="mx-auto max-w-7xl px-6 py-8">
        <ConvertPanel />
      </main>
    </>
  );
}
