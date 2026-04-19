import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "APA7 Citation Formatter",
  description: "Upload documents or fill a form to get APA 7th edition citations.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground">{children}</body>
    </html>
  );
}
