"use client";

import { Check, ClipboardCopy } from "lucide-react";
import { ReactNode, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { copyPlainText, copyReference } from "@/lib/clipboard";
import type { CitationResult } from "@/lib/types";

interface Props {
  result: CitationResult;
  onAddToLibrary?: () => void;
  addLabel?: ReactNode;
  disabledAdd?: boolean;
}

interface CopyButtonProps {
  plain: string;
  html?: string | null;
  label?: string;
}

function CopyButton({ plain, html, label = "复制" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (html !== undefined) {
      await copyReference(plain, html);
    } else {
      await copyPlainText(plain);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <Button variant="secondary" size="sm" onClick={copy} type="button">
      {copied ? <Check className="h-3.5 w-3.5" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
      {copied ? "已复制" : label}
    </Button>
  );
}

export function CitationResultView({ result, onAddToLibrary, addLabel = "加入文献库", disabledAdd }: Props) {
  const { structured, rendered } = result;
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-border bg-card p-6">
          <h3 className="mb-4 text-lg font-medium">结构化字段</h3>
          <dl className="space-y-3 text-sm">
            <Row label="类型" value={<Badge tone="muted">{prettyWorkType(structured.work_type)}</Badge>} />
            <Row label="作者" value={formatAuthors(structured) || "—"} />
            <Row label="年份" value={structured.year ?? "—"} />
            <Row label="标题" value={structured.title_english ?? structured.title ?? "—"} />
            {structured.title_original && structured.title_original !== structured.title_english && (
              <Row label="原文标题" value={structured.title_original} />
            )}
            <Row
              label="容器"
              value={structured.container_title_english ?? structured.container_title ?? "—"}
            />
            {(structured.volume || structured.issue || structured.pages) && (
              <Row
                label="卷 / 期 / 页"
                value={[structured.volume, structured.issue, structured.pages].filter(Boolean).join(" · ")}
              />
            )}
            {(structured.publisher || structured.publisher_place) && (
              <Row
                label="出版"
                value={[structured.publisher, structured.publisher_place].filter(Boolean).join(", ")}
              />
            )}
            {structured.doi && <Row label="DOI" value={structured.doi} />}
            {structured.url && <Row label="URL" value={structured.url} />}
          </dl>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <Badge tone="muted">输出语言：{result.locale_policy === "en_all" ? "全英文" : "原文+英文"}</Badge>
            {result.crossref_used && <Badge tone="positive">Crossref 已增强</Badge>}
            {typeof structured.confidence === "number" && (
              <Badge tone="outline">置信度：{(structured.confidence * 100).toFixed(0)}%</Badge>
            )}
            {structured.missing_fields?.map((field) => (
              <Badge key={field} tone="warning">
                缺失：{field}
              </Badge>
            ))}
          </div>
        </section>

        <div className="space-y-4">
          <section className="rounded-lg border border-border bg-card p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-medium">参考文献条目</h3>
              <CopyButton
                plain={rendered.reference_plain}
                html={rendered.reference_html}
                label="复制条目"
              />
            </div>
            <p
              className="reference-entry text-[15px]"
              dangerouslySetInnerHTML={{ __html: rendered.reference_html || rendered.reference_plain }}
            />
          </section>

          <section className="rounded-lg border border-border bg-card p-6">
            <h3 className="mb-4 text-lg font-medium">文内引用</h3>
            <div className="space-y-4">
              <InTextRow label="Parenthetical" value={rendered.in_text_parenthetical} />
              <InTextRow label="Narrative" value={rendered.in_text_narrative} />
            </div>
          </section>
        </div>
      </div>

      {onAddToLibrary && (
        <div className="flex justify-end">
          <Button onClick={onAddToLibrary} disabled={disabledAdd}>
            {addLabel}
          </Button>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[80px_minmax(0,1fr)] items-start gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}

function InTextRow({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <CopyButton plain={value} />
      </div>
      <p className="rounded bg-muted px-3 py-2 font-mono text-sm">{value}</p>
    </div>
  );
}

function formatAuthors(structured: CitationResult["structured"]): string {
  if (!structured.authors?.length) return "";
  return structured.authors
    .map((a) =>
      a.is_organization && a.literal
        ? a.literal
        : [a.family, a.given].filter(Boolean).join(", "),
    )
    .filter(Boolean)
    .join("; ");
}

function prettyWorkType(type: CitationResult["structured"]["work_type"]): string {
  switch (type) {
    case "journal_article":
      return "期刊文章";
    case "book":
      return "图书";
    case "book_chapter":
      return "图书章节";
    case "webpage":
      return "网页";
    default:
      return type;
  }
}
