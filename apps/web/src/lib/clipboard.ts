const TIMES_FONT = "'Times New Roman', Times, serif";

function wrapWithFont(html: string): string {
  return `<span style="font-family:${TIMES_FONT}; font-size:12pt;">${html}</span>`;
}

async function writeRich(plain: string, html: string): Promise<void> {
  const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  const hasClipboardItem = typeof window !== "undefined" && typeof (window as { ClipboardItem?: unknown }).ClipboardItem === "function";

  if (clipboard && hasClipboardItem && typeof clipboard.write === "function") {
    try {
      const item = new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([plain], { type: "text/plain" }),
      });
      await clipboard.write([item]);
      return;
    } catch {
      // fall through to plain text fallback below
    }
  }

  if (clipboard?.writeText) {
    await clipboard.writeText(plain);
    return;
  }

  throw new Error("Clipboard API unavailable");
}

export async function copyReference(plain: string, html?: string | null): Promise<void> {
  const effectiveHtml = wrapWithFont(html?.trim() ? html! : escapeHtml(plain));
  await writeRich(plain, effectiveHtml);
}

export async function copyReferenceList(entries: Array<{ plain: string; html?: string | null }>): Promise<void> {
  if (!entries.length) return;
  const plain = entries.map((entry) => entry.plain).join("\n\n");
  const htmlBody = entries
    .map((entry) => {
      const content = entry.html?.trim() ? entry.html! : escapeHtml(entry.plain);
      return `<p style="margin:0 0 12pt 0; text-indent:-24pt; padding-left:24pt;">${content}</p>`;
    })
    .join("");
  await writeRich(plain, wrapWithFont(htmlBody));
}

export async function copyPlainText(text: string): Promise<void> {
  await writeRich(text, wrapWithFont(escapeHtml(text)));
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
