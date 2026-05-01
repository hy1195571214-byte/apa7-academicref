"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { DuplicateMatch } from "@/lib/library";
import { Badge } from "@/components/ui/badge";
import { FileText, BookOpen, Globe } from "lucide-react";
import type { WorkType } from "@/lib/types";

interface DuplicateDialogProps {
  open: boolean;
  match: DuplicateMatch;
  onKeepExisting: () => void;
  onKeepNew: () => void;
  onCancel: () => void;
}

export function DuplicateDialog({
  open,
  match,
  onKeepExisting,
  onKeepNew,
  onCancel,
}: DuplicateDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title="检测到可能重复的文献"
      description="该文献与项目中已有条目高度相似，请选择保留版本"
      footer={
        <>
          <Button variant="secondary" onClick={onKeepExisting}>
            <CheckCircle2 className="mr-2 h-4 w-4" />
            保留已有
          </Button>
          <Button onClick={onKeepNew}>
            <AlertTriangle className="mr-2 h-4 w-4" />
            保留当前
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            取消
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <DuplicateCard label="已有版本" entry={match.existingEntry} />
          <CandidateCard label="当前待加入" match={match} />
        </div>
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <p className="font-medium">
            {match.confidence === "exact" ? "DOI 完全一致" : "标题、作者、年份高度相似"}
          </p>
          <p className="mt-1 text-xs opacity-80">
            系统无法自动判断哪个版本更完整，建议人工对比后选择。
          </p>
        </div>
      </div>
    </Dialog>
  );
}

function WorkTypeBadge({ type }: { type: WorkType }) {
  const config: Record<WorkType, { label: string; icon: typeof FileText }> = {
    journal_article: { label: "期刊", icon: FileText },
    book: { label: "图书", icon: BookOpen },
    book_chapter: { label: "章节", icon: BookOpen },
    webpage: { label: "网页", icon: Globe },
  };
  const { label, icon: Icon } = config[type];
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs">
      <Icon className="h-3 w-3" /> {label}
    </span>
  );
}

function DuplicateCard({
  label,
  entry,
}: {
  label: string;
  entry: DuplicateMatch["existingEntry"];
}) {
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Badge tone="positive">已存在</Badge>
      </div>
      <p className="text-sm leading-relaxed">{entry.rendered.reference_plain}</p>
      <div className="mt-2 flex flex-wrap gap-1">
        <WorkTypeBadge type={entry.structured.work_type} />
        {entry.crossrefUsed && <Badge tone="positive">Crossref</Badge>}
      </div>
    </div>
  );
}

function CandidateCard({
  label,
  match,
}: {
  label: string;
  match: DuplicateMatch;
}) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Badge tone="warning">待加入</Badge>
      </div>
      <p className="text-sm leading-relaxed">{match.candidateLabel}</p>
    </div>
  );
}
