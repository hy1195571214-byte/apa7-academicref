"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  FileText,
  Library,
  Loader2,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { UploadSurface } from "@/components/convert/UploadSurface";
import { copyPlainText } from "@/lib/clipboard";
import { useLibrary } from "@/lib/library";
import { useBackgroundTasks } from "@/lib/background-tasks";
import type { SummaryResultItem } from "@/lib/background-tasks";
import type { LiteratureSummary, SummaryLanguage } from "@/lib/types";

type Mode = "file" | "paste";
type VisionSetting = "off" | "conservative";

export function SummaryPanel() {
  const [mode, setMode] = useState<Mode>("file");
  const [files, setFiles] = useState<File[]>([]);
  const [pastedText, setPastedText] = useState("");
  const [outputLanguage, setOutputLanguage] = useState<SummaryLanguage>("zh");
  const [vision, setVision] = useState<VisionSetting>("conservative");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saveAllStatus, setSaveAllStatus] = useState<"idle" | "saved">("idle");

  const {
    addSummary,
    activeProjectId,
    activeProjectName,
    projects,
    setActiveProject,
  } = useLibrary();
  const {
    summaryRun,
    startSummaryRun,
    markSummaryItemSaved,
    markAllSummaryItemsSaved,
    clearSummaryRun,
  } = useBackgroundTasks();

  const reset = () => {
    clearSummaryRun();
    setSubmitError(null);
    setSaveAllStatus("idle");
  };

  const submit = () => {
    setSubmitError(null);
    setSaveAllStatus("idle");
    try {
      if (mode === "file") {
        if (files.length === 0) throw new Error("请先选择要生成概要的文件。");
        if (files.length === 1) {
          const only = files[0];
          startSummaryRun({
            kind: "single-file",
            file: only,
            filename: only.name,
            outputLanguage,
            vision,
          });
        } else {
          startSummaryRun({
            kind: "batch",
            files,
            outputLanguage,
            vision,
          });
        }
      } else {
        if (!pastedText.trim()) throw new Error("请粘贴要生成概要的文本。");
        startSummaryRun({
          kind: "paste",
          pastedText: pastedText.trim(),
          outputLanguage,
          vision,
        });
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "发生未知错误。");
    }
  };

  const saveItem = (item: SummaryResultItem) => {
    if (!summaryRun || !item.summary || item.saved) return;
    addSummary({
      summary: item.summary,
      source: item.source,
      filename: item.source === "upload" ? item.filename : null,
      outputLanguage: summaryRun.meta.outputLanguage,
    });
    markSummaryItemSaved(summaryRun.runId, item.id);
  };

  const saveAll = () => {
    if (!summaryRun) return;
    summaryRun.items.forEach((item) => {
      if (item.saved || !item.summary) return;
      addSummary({
        summary: item.summary,
        source: item.source,
        filename: item.source === "upload" ? item.filename : null,
        outputLanguage: summaryRun.meta.outputLanguage,
      });
    });
    markAllSummaryItemsSaved(summaryRun.runId);
    setSaveAllStatus("saved");
  };

  const state: "idle" | "processing" | "success" | "error" = summaryRun
    ? summaryRun.phase
    : "idle";
  const items = summaryRun?.items ?? [];
  const error = summaryRun?.error ?? submitError;

  if (state === "processing") {
    return (
      <section className="mx-auto max-w-3xl">
        <div className="space-y-6 rounded-lg border border-border bg-card p-8 text-center">
          <Loader2 className="mx-auto h-12 w-12 animate-spin text-primary" />
          <div className="space-y-1">
            <h3 className="text-lg font-medium">
              {summaryRun && summaryRun.meta.mode === "file" && summaryRun.meta.totalFiles > 1
                ? `正在并行生成 ${summaryRun.meta.totalFiles} 份概要`
                : "正在生成概要"}
            </h3>
            <p className="text-sm text-muted-foreground">解析输入内容 · 提取论点、关键词与话题标签…</p>
            <p className="text-xs text-muted-foreground">切换页面不会中断请求，回来即可查看结果。</p>
          </div>
          <Button variant="secondary" size="sm" onClick={reset}>
            取消
          </Button>
        </div>
      </section>
    );
  }

  if (state === "error") {
    return (
      <section className="mx-auto max-w-3xl">
        <div className="space-y-4 rounded-lg border border-destructive/50 bg-card p-8 text-center">
          <AlertCircle className="mx-auto h-12 w-12 text-destructive" />
          <h3 className="text-lg font-medium">概要生成失败</h3>
          <p className="text-sm text-muted-foreground">{error ?? "未知错误，请重试。"}</p>
          <div className="flex justify-center gap-3">
            <Button variant="secondary" onClick={reset}>
              返回重新选择
            </Button>
            <Button onClick={submit}>重试</Button>
          </div>
        </div>
      </section>
    );
  }

  if (state === "success" && items.length > 0) {
    const savableCount = items.filter((item) => item.summary && !item.saved).length;
    const total = items.length;

    return (
      <section className="space-y-6">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-medium">
              概要结果{total > 1 ? `（${total}）` : ""}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              保存时将写入当前项目：{activeProjectName}
            </p>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto">
            {total > 1 && (
              <Button
                variant="secondary"
                onClick={saveAll}
                disabled={savableCount === 0}
              >
                <Library className="h-4 w-4" />
                {saveAllStatus === "saved" && savableCount === 0
                  ? "已保存全部成功项"
                  : `保存全部成功项${savableCount > 0 ? `（${savableCount}）` : ""}`}
              </Button>
            )}
            <Button variant="secondary" onClick={reset} className="shrink-0">
              生成新概要
            </Button>
          </div>
        </div>

        <div className="space-y-5">
          {items.map((item) => (
            <SummaryResultCard
              key={item.id}
              item={item}
              onSave={() => saveItem(item)}
              showHeader={total > 1}
            />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-4xl space-y-6">
      <div className="flex rounded-lg border border-border bg-card p-1">
        {[
          { id: "file" as const, label: "上传文件" },
          { id: "paste" as const, label: "粘贴文本" },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setMode(tab.id);
              reset();
            }}
            className={
              tab.id === mode
                ? "flex-1 rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-foreground"
                : "flex-1 rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      {projects.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm">
            <p className="font-medium">保存到论文项目</p>
            <p className="text-xs text-muted-foreground">切换后当前页的新概要都会写入所选项目。</p>
          </div>
          <Select
            value={activeProjectId}
            onChange={(event) => setActiveProject(event.target.value)}
            className="h-9 w-full max-w-sm sm:w-auto sm:min-w-[14rem]"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}（概要 {p.summaries?.length ?? 0}）
              </option>
            ))}
          </Select>
        </div>
      )}

      {mode === "file" ? (
        <UploadSurface files={files} onFilesChange={setFiles} />
      ) : (
        <div className="rounded-lg border border-border bg-card p-6">
          <label className="mb-2 block text-sm font-medium" htmlFor="summary-paste">
            粘贴正文 / 摘要
          </label>
          <Textarea
            id="summary-paste"
            rows={10}
            placeholder="粘贴文献正文段落、摘要，或从 PDF 复制出的文本。"
            value={pastedText}
            onChange={(event) => setPastedText(event.target.value)}
          />
        </div>
      )}

      <div className="rounded-lg border border-border bg-card">
        <button
          type="button"
          onClick={() => setShowAdvanced((value) => !value)}
          className="flex w-full items-center justify-between px-6 py-4 text-sm text-muted-foreground transition-colors hover:bg-accent/50"
        >
          <span>高级选项</span>
          {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {showAdvanced && (
          <div className="grid gap-4 border-t border-border px-6 pb-6 pt-4 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm font-medium">输出语言</label>
              <Select
                value={outputLanguage}
                onChange={(event) => setOutputLanguage(event.target.value as SummaryLanguage)}
              >
                <option value="zh">中文（默认）</option>
                <option value="en">English</option>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">视觉识别</label>
              <Select value={vision} onChange={(event) => setVision(event.target.value as VisionSetting)}>
                <option value="off">关闭</option>
                <option value="conservative">保守（仅在文本极少时启用）</option>
              </Select>
            </div>
          </div>
        )}
      </div>

      {submitError && (
        <div className="rounded-lg border border-destructive/40 bg-card p-4 text-sm text-destructive">
          {submitError}
        </div>
      )}

      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
        <p className="text-center text-xs text-muted-foreground sm:mr-auto sm:text-left">
          {mode === "file" && files.length > 0 ? (
            <>
              已选择 {files.length} 个文件 · 保存到当前项目：{activeProjectName}
            </>
          ) : (
            <>保存概要时将写入当前项目：{activeProjectName}</>
          )}
        </p>
        <Button size="lg" onClick={submit}>
          {mode === "file" && files.length > 1 ? `并行生成 ${files.length} 份概要` : "生成概要"}
        </Button>
      </div>
    </section>
  );
}

function SummaryResultCard({
  item,
  onSave,
  showHeader,
}: {
  item: SummaryResultItem;
  onSave: () => void;
  showHeader: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const header = showHeader ? (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <FileText className="h-3.5 w-3.5" />
      <span className="truncate">{item.filename}</span>
    </div>
  ) : null;

  if (item.error || !item.summary) {
    return (
      <div className="space-y-2">
        {header}
        <div className="space-y-1 rounded-lg border border-destructive/40 bg-card p-5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <XCircle className="h-4 w-4 text-destructive" />
            <span className="truncate">{item.filename}</span>
          </div>
          <p className="text-sm text-muted-foreground">{item.error ?? "未返回概要"}</p>
        </div>
      </div>
    );
  }

  const summary = item.summary;

  return (
    <div className="space-y-3">
      {header}
      <SummaryView summary={summary} />
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button
          variant="secondary"
          onClick={async () => {
            await copyPlainText(formatSummaryPlainText(summary));
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          <ClipboardCopy className="h-4 w-4" />
          {copied ? "已复制" : "复制概要"}
        </Button>
        <Button onClick={onSave} disabled={item.saved}>
          <Library className="h-4 w-4" />
          {item.saved ? "已保存到当前项目" : "保存到当前项目"}
        </Button>
      </div>
    </div>
  );
}

export function SummaryView({ summary }: { summary: LiteratureSummary }) {
  const title = summary.title_guess?.trim();
  const hasAny = useMemo(
    () => Boolean(title) || summary.key_claims.length || summary.keywords.length || summary.topic_tags.length,
    [title, summary],
  );

  if (!hasAny) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        模型未能从输入中提取有效概要内容。
      </div>
    );
  }

  return (
    <div className="space-y-5 rounded-lg border border-border bg-card p-6">
      {title ? (
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">推测标题</p>
          <p className="text-base font-medium">{title}</p>
        </div>
      ) : null}

      <SummarySection label="关键论点" icon={<CheckCircle2 className="h-4 w-4 text-primary" />}>
        {summary.key_claims.length ? (
          <ol className="list-decimal space-y-1 pl-5 text-sm leading-relaxed">
            {summary.key_claims.map((claim, idx) => (
              <li key={idx}>{claim}</li>
            ))}
          </ol>
        ) : (
          <EmptyHint text="未识别到明确论点。" />
        )}
      </SummarySection>

      <SummarySection label="关键词">
        {summary.keywords.length ? (
          <div className="flex flex-wrap gap-2">
            {summary.keywords.map((word, idx) => (
              <Badge key={idx} tone="outline">
                {word}
              </Badge>
            ))}
          </div>
        ) : (
          <EmptyHint text="未识别到关键词。" />
        )}
      </SummarySection>

      <SummarySection label="话题标签">
        {summary.topic_tags.length ? (
          <div className="flex flex-wrap gap-2">
            {summary.topic_tags.map((tag, idx) => (
              <Badge key={idx}>{tag}</Badge>
            ))}
          </div>
        ) : (
          <EmptyHint text="未识别到话题标签。" />
        )}
      </SummarySection>
    </div>
  );
}

function SummarySection({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      {children}
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground">{text}</p>;
}

export function formatSummaryPlainText(summary: LiteratureSummary): string {
  const lines: string[] = [];
  if (summary.title_guess?.trim()) lines.push(`标题：${summary.title_guess.trim()}`);
  if (summary.key_claims.length) {
    lines.push("关键论点：");
    summary.key_claims.forEach((claim, idx) => {
      lines.push(`${idx + 1}. ${claim}`);
    });
  }
  if (summary.keywords.length) {
    lines.push(`关键词：${summary.keywords.join("、")}`);
  }
  if (summary.topic_tags.length) {
    lines.push(`话题标签：${summary.topic_tags.join("、")}`);
  }
  return lines.join("\n");
}
