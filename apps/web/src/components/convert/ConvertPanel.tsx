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
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { UploadSurface } from "./UploadSurface";
import { CitationResultView } from "@/components/citation/CitationResultView";
import { createJob, createJobsBatch, detectReferences } from "@/lib/api";
import type {
  CitationResult,
  JobRecord,
  LocalePolicy,
  SummaryLanguage,
  VisionMode,
} from "@/lib/types";
import { useLibrary, checkDuplicate, type DuplicateMatch } from "@/lib/library";
import { useBackgroundTasks } from "@/lib/background-tasks";
import type {
  CitationJobItem,
  CitationRunOptions,
  SummaryResultItem,
} from "@/lib/background-tasks";
import { SummaryView, formatSummaryPlainText } from "@/components/summary/SummaryPanel";
import { copyPlainText } from "@/lib/clipboard";
import { DuplicateDialog } from "@/components/library/DuplicateDialog";

type InputMode = "file" | "paste";
type PipelineMode = "cite" | "cite_and_summary" | "summary_only";
type SummaryVision = Exclude<VisionMode, "aggressive">;

export function ConvertPanel() {
  const [inputMode, setInputMode] = useState<InputMode>("file");
  const [pipelineMode, setPipelineMode] = useState<PipelineMode>("cite");
  const [files, setFiles] = useState<File[]>([]);
  const [pastedText, setPastedText] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [localePolicy, setLocalePolicy] = useState<LocalePolicy>("en_all");
  const [enableCrossref, setEnableCrossref] = useState(true);
  const [vision, setVision] = useState<VisionMode>("conservative");
  const [summaryLanguage, setSummaryLanguage] = useState<SummaryLanguage>("zh");
  const [summaryVision, setSummaryVision] = useState<SummaryVision>("conservative");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saveAllStatus, setSaveAllStatus] = useState<"idle" | "saved">("idle");

  // Duplicate detection state
  const [pendingResult, setPendingResult] = useState<CitationResult | null>(null);
  const [pendingDuplicate, setPendingDuplicate] = useState<DuplicateMatch | null>(null);
  // jobId for which the pending result belongs (so markCitationItemAdded uses correct run)
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);

  const { addFromResult, addSummary, activeProjectName, entries } = useLibrary();
  const {
    citationRun,
    startCitationRun,
    markCitationItemAdded,
    clearCitationRun,
    summaryRun,
    startSummaryRun,
    markSummaryItemSaved,
    markAllSummaryItemsSaved,
    clearSummaryRun,
  } = useBackgroundTasks();

  const items = citationRun?.items ?? [];
  const total = items.length;
  const completed = useMemo(
    () =>
      items.filter(
        (item) => item.record.status === "succeeded" || item.record.status === "failed",
      ).length,
    [items],
  );

  const progress = useMemo(() => {
    if (!citationRun || total === 0) return 0;
    if (citationRun.phase === "success") return 100;
    if (citationRun.phase !== "processing") return 0;
    const running = items.filter((item) => item.record.status === "running").length;
    return Math.min(95, Math.round(((completed + running * 0.5) / total) * 100));
  }, [citationRun, items, total, completed]);

  const reset = () => {
    clearCitationRun();
    clearSummaryRun();
    setSubmitError(null);
    setSaveAllStatus("idle");
  };

  const labelFor = (record: JobRecord, fallback: string): string => {
    return record.evidence?.filename ?? fallback;
  };

  const submit = async () => {
    if (submitting) return;
    setSubmitError(null);

    if (pipelineMode === "summary_only") {
      try {
        clearCitationRun();
        setSubmitting(true);
        if (inputMode === "file") {
          if (files.length === 0) throw new Error("请先选择要生成概要的文件。");
          if (files.length === 1) {
            const only = files[0];
            startSummaryRun({
              kind: "single-file",
              file: only,
              filename: only.name,
              outputLanguage: summaryLanguage,
              vision: summaryVision,
            });
          } else {
            startSummaryRun({
              kind: "batch",
              files,
              outputLanguage: summaryLanguage,
              vision: summaryVision,
            });
          }
        } else {
          if (!pastedText.trim()) throw new Error("请粘贴要生成概要的文本。");
          startSummaryRun({
            kind: "paste",
            pastedText: pastedText.trim(),
            outputLanguage: summaryLanguage,
            vision: summaryVision,
          });
        }
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : "发生未知错误。");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    setSubmitting(true);
    try {
      clearSummaryRun();
      let seeded: CitationJobItem[];
      const filesByJobId: Record<string, File> = {};
      const pastedByJobId: Record<string, string> = {};

      if (inputMode === "file") {
        if (files.length === 0) throw new Error("请先选择要上传的文件。");
        const initial = await createJobsBatch({
          files,
          localePolicy,
          enableCrossref,
          vision,
        });
        seeded = initial.map((record, index) => ({
          id: record.id,
          label: labelFor(record, files[index]?.name ?? `文件 ${index + 1}`),
          record,
          added: false,
          summary: null,
          summaryError: null,
          summaryStatus: "idle",
        }));
        initial.forEach((record, index) => {
          const file = files[index];
          if (file) filesByJobId[record.id] = file;
        });
      } else {
        const text = pastedText.trim();
        if (!text) throw new Error("请粘贴要识别的文本。");

        // Detect multiple references in pasted text
        const detected = await detectReferences(text, localePolicy);

        if (detected.references.length <= 1) {
          // Single reference: use original single-job flow
          const initial = await createJob({
            pastedText: text,
            localePolicy,
            enableCrossref,
            vision,
          });
          seeded = [
            {
              id: initial.id,
              label: "粘贴文本",
              record: initial,
              added: false,
              summary: null,
              summaryError: null,
              summaryStatus: "idle",
            },
          ];
          pastedByJobId[initial.id] = text;
        } else {
          // Multiple references: split text by boundaries and batch process
          const texts: string[] = [];
          for (let i = 0; i < detected.references.length; i++) {
            const start = detected.boundaries[i];
            const end = detected.boundaries[i + 1] ?? text.length;
            const slice = text.slice(start, end).trim();
            if (slice) texts.push(slice);
          }
          const initial = await createJobsBatch({
            pastedTexts: texts,
            localePolicy,
            enableCrossref,
            vision,
          });
          seeded = initial.map((record, index) => ({
            id: record.id,
            label: `粘贴文本 ${index + 1}`,
            record,
            added: false,
            summary: null,
            summaryError: null,
            summaryStatus: "idle" as const,
          }));
          // Map each job to its corresponding text slice by index
          initial.forEach((record, index) => {
            const start = detected.boundaries[index];
            const end = detected.boundaries[index + 1] ?? text.length;
            const slice = text.slice(start, end).trim();
            if (slice) pastedByJobId[record.id] = slice;
          });
        }
      }

      const options: CitationRunOptions = {
        meta: {
          generateSummary: pipelineMode === "cite_and_summary",
          summaryLanguage,
          summaryVision,
        },
        inputs:
          pipelineMode === "cite_and_summary"
            ? { filesByJobId, pastedByJobId }
            : undefined,
      };
      startCitationRun(seeded, options);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "发生未知错误。");
    } finally {
      setSubmitting(false);
    }
  };

  if (citationRun && citationRun.phase === "processing") {
    return (
      <section className="mx-auto max-w-3xl">
        <div className="space-y-6 rounded-lg border border-border bg-card p-8">
          <div className="space-y-2 text-center">
            <Loader2 className="mx-auto h-12 w-12 animate-spin text-primary" />
            <h3 className="text-lg font-medium">
              正在处理 {total > 1 ? `${completed}/${total} 份文档` : "文档"}
            </h3>
            <p className="text-sm text-muted-foreground">
              {completed === 0 && "解析文档结构…"}
              {completed > 0 && completed < total && "抽取文献信息 · 生成 APA 7 引用…"}
              {completed === total && total > 0 && "收尾中…"}
            </p>
            {citationRun.meta.generateSummary && (
              <p className="text-xs text-muted-foreground">引用完成后将并行生成文献概要。</p>
            )}
            <p className="text-xs text-muted-foreground">切换页面不会中断任务，回来即可查看进度。</p>
          </div>
          <Progress value={progress} />
          {items.length > 1 && <JobStatusList items={items} />}
          <div className="text-center">
            <Button variant="secondary" size="sm" onClick={reset}>
              取消
            </Button>
          </div>
        </div>
      </section>
    );
  }

  if (citationRun && citationRun.phase === "error") {
    return (
      <section className="mx-auto max-w-3xl">
        <div className="rounded-lg border border-destructive/50 bg-card p-8">
          <div className="space-y-4 text-center">
            <AlertCircle className="mx-auto h-12 w-12 text-destructive" />
            <h3 className="text-lg font-medium">处理失败</h3>
            <p className="text-sm text-muted-foreground">{citationRun.error ?? "未知错误，请重试。"}</p>
            <div className="flex justify-center gap-3">
              <Button variant="secondary" onClick={reset}>
                返回重新选择
              </Button>
              <Button
                onClick={() => {
                  clearCitationRun();
                  void submit();
                }}
              >
                重试
              </Button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (citationRun && citationRun.phase === "success") {
    return (
      <section className="space-y-6">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-medium">
              生成结果{total > 1 ? `（${items.length}）` : ""}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              加入文献库时将写入当前项目：{activeProjectName}
              {citationRun.meta.generateSummary ? "；若已生成概要会一并写入并自动关联。" : ""}
            </p>
          </div>
          <Button variant="secondary" onClick={reset} className="shrink-0 self-start sm:self-auto">
            转换新文档
          </Button>
        </div>
        <div className="space-y-6">
          {items.map((item) => (
            <ResultCard
              key={item.id}
              item={item}
              onAdd={(result) => {
                const dupFound = checkDuplicate(entries, result);
                if (dupFound) {
                  setPendingResult(result);
                  setPendingDuplicate(dupFound);
                  setPendingJobId(item.record.id);
                  return;
                }
                const entry = addFromResult(result, "upload_job");
                if (item.summary) {
                  addSummary({
                    summary: item.summary,
                    source: inputMode === "paste" ? "paste" : "upload",
                    filename: inputMode === "paste" ? null : item.label,
                    outputLanguage: citationRun.meta.summaryLanguage ?? "zh",
                    linkedEntryId: entry.id,
                  });
                }
                markCitationItemAdded(citationRun.runId, item.record.id);
              }}
            />
          ))}
        </div>
        {pendingDuplicate && (
          <DuplicateDialog
            open={true}
            match={pendingDuplicate}
            onKeepExisting={() => {
              setPendingResult(null);
              setPendingDuplicate(null);
              setPendingJobId(null);
            }}
            onKeepNew={() => {
              if (pendingResult && pendingJobId) {
                const entry = addFromResult(pendingResult, "upload_job");
                const item = citationRun?.items.find((it) => it.record.id === pendingJobId);
                if (item?.summary) {
                  addSummary({
                    summary: item.summary,
                    source: inputMode === "paste" ? "paste" : "upload",
                    filename: inputMode === "paste" ? null : item.label,
                    outputLanguage: citationRun.meta.summaryLanguage ?? "zh",
                    linkedEntryId: entry.id,
                  });
                }
                if (citationRun) markCitationItemAdded(citationRun.runId, pendingJobId);
              }
              setPendingResult(null);
              setPendingDuplicate(null);
              setPendingJobId(null);
            }}
            onCancel={() => {
              setPendingResult(null);
              setPendingDuplicate(null);
              setPendingJobId(null);
            }}
          />
        )}
      </section>
    );
  }

  if (pipelineMode === "summary_only" && summaryRun) {
    return (
      <SummaryOnlyRun
        onReset={reset}
        onRetry={() => {
          clearSummaryRun();
          void submit();
        }}
        activeProjectName={activeProjectName}
        saveAllStatus={saveAllStatus}
        setSaveAllStatus={setSaveAllStatus}
        onSaveItem={(item) => {
          if (!summaryRun || !item.summary || item.saved) return;
          addSummary({
            summary: item.summary,
            source: item.source,
            filename: item.source === "upload" ? item.filename : null,
            outputLanguage: summaryRun.meta.outputLanguage,
          });
          markSummaryItemSaved(summaryRun.runId, item.id);
        }}
        onSaveAll={() => {
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
        }}
      />
    );
  }

  return (
    <section className="mx-auto max-w-4xl space-y-6">
      <PipelineModeSelector value={pipelineMode} onChange={(value) => {
        setPipelineMode(value);
        setSubmitError(null);
      }} />

      <div className="flex rounded-lg border border-border bg-card p-1">
        {[
          { id: "file" as const, label: "上传文件" },
          { id: "paste" as const, label: "粘贴文本" },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setInputMode(tab.id);
              reset();
            }}
            className={
              tab.id === inputMode
                ? "flex-1 rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-foreground"
                : "flex-1 rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      {inputMode === "file" ? (
        <UploadSurface files={files} onFilesChange={setFiles} />
      ) : (
        <div className="rounded-lg border border-border bg-card p-6">
          <label className="mb-2 block text-sm font-medium" htmlFor="pasted">
            {pipelineMode === "summary_only" ? "粘贴正文 / 摘要" : "粘贴题录文本"}
          </label>
          <Textarea
            id="pasted"
            rows={8}
            placeholder={
              pipelineMode === "summary_only"
                ? "粘贴文献正文段落、摘要，或从 PDF 复制出的文本。"
                : "粘贴参考文献条目、数据库导出的题录，或文献摘要页面的纯文本。"
            }
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
          <div className="space-y-4 border-t border-border px-6 pb-6 pt-4">
            {pipelineMode !== "summary_only" && (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm">DOI 元数据增强</p>
                    <p className="text-xs text-muted-foreground">
                      检测到 DOI 时通过 Crossref 获取更准确的题录元数据
                    </p>
                  </div>
                  <SwitchInput checked={enableCrossref} onChange={setEnableCrossref} />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-sm font-medium">引用输出语言</label>
                    <Select
                      value={localePolicy}
                      onChange={(event) => setLocalePolicy(event.target.value as LocalePolicy)}
                    >
                      <option value="en_all">全英文（默认）</option>
                      <option value="en_bracket">原文 + 括号内英文</option>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">引用视觉识别</label>
                    <Select value={vision} onChange={(event) => setVision(event.target.value as VisionMode)}>
                      <option value="off">关闭</option>
                      <option value="conservative">保守（仅关键页）</option>
                      <option value="aggressive">积极（尽可能使用）</option>
                    </Select>
                  </div>
                </div>
              </>
            )}
            {pipelineMode !== "cite" && (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-sm font-medium">概要输出语言</label>
                  <Select
                    value={summaryLanguage}
                    onChange={(event) => setSummaryLanguage(event.target.value as SummaryLanguage)}
                  >
                    <option value="zh">中文（默认）</option>
                    <option value="en">English</option>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">概要视觉识别</label>
                  <Select
                    value={summaryVision}
                    onChange={(event) => setSummaryVision(event.target.value as SummaryVision)}
                  >
                    <option value="off">关闭</option>
                    <option value="conservative">保守（仅在文本极少时启用）</option>
                  </Select>
                </div>
              </div>
            )}
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
          成功加入文献库时将写入当前项目：{activeProjectName}
        </p>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {inputMode === "file" && files.length > 0 && (
            <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <FileText className="h-3.5 w-3.5" />
              已选择 {files.length} 个文件
            </span>
          )}
          <Button size="lg" onClick={submit} disabled={submitting}>
            {submitting ? "提交中…" : submitLabel(pipelineMode, inputMode, files.length)}
          </Button>
        </div>
      </div>
    </section>
  );
}

function submitLabel(mode: PipelineMode, inputMode: InputMode, fileCount: number): string {
  const many = inputMode === "file" && fileCount > 1;
  if (mode === "cite") return many ? `并行生成 ${fileCount} 条引用` : "生成 APA 7 引用";
  if (mode === "summary_only") return many ? `并行生成 ${fileCount} 份概要` : "生成概要";
  return many ? `并行生成 ${fileCount} 条引用 + 概要` : "生成 APA 7 引用 + 概要";
}

function PipelineModeSelector({
  value,
  onChange,
}: {
  value: PipelineMode;
  onChange: (value: PipelineMode) => void;
}) {
  const options: { id: PipelineMode; label: string; hint: string }[] = [
    { id: "cite", label: "仅转换", hint: "生成 APA 7 引用" },
    { id: "cite_and_summary", label: "转换且生成概要", hint: "引用 + 文献概要并自动关联" },
    { id: "summary_only", label: "仅生成概要", hint: "只生成关键论点与标签" },
  ];
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={
              "rounded-lg border px-4 py-3 text-left transition-colors " +
              (active
                ? "border-primary bg-accent/60 shadow-sm"
                : "border-border bg-card hover:border-muted-foreground/40 hover:bg-accent/30")
            }
            aria-pressed={active}
          >
            <p className="text-sm font-medium">{opt.label}</p>
            <p className="mt-1 text-xs text-muted-foreground">{opt.hint}</p>
          </button>
        );
      })}
    </div>
  );
}

function JobStatusList({ items }: { items: CitationJobItem[] }) {
  return (
    <ul className="divide-y divide-border rounded-md border border-border bg-background">
      {items.map((item) => (
        <li key={item.id} className="flex items-center gap-3 px-4 py-2 text-sm">
          <StatusIcon status={item.record.status} />
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          <span className="text-xs text-muted-foreground">{statusLabel(item.record.status)}</span>
        </li>
      ))}
    </ul>
  );
}

function StatusIcon({ status }: { status: JobRecord["status"] }) {
  if (status === "succeeded") return <CheckCircle2 className="h-4 w-4 text-primary" />;
  if (status === "failed") return <XCircle className="h-4 w-4 text-destructive" />;
  if (status === "running") return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  return <Loader2 className="h-4 w-4 text-muted-foreground/60" />;
}

function statusLabel(status: JobRecord["status"]): string {
  switch (status) {
    case "queued":
      return "排队中";
    case "running":
      return "处理中";
    case "succeeded":
      return "已完成";
    case "failed":
      return "失败";
  }
}

function ResultCard({
  item,
  onAdd,
}: {
  item: CitationJobItem;
  onAdd: (result: CitationResult) => void;
}) {
  const { record, added, label, summary, summaryStatus, summaryError } = item;

  if (record.status === "failed") {
    return (
      <div className="space-y-2 rounded-lg border border-destructive/40 bg-card p-5">
        <div className="flex items-center gap-2 text-sm font-medium">
          <XCircle className="h-4 w-4 text-destructive" />
          <span className="truncate">{label}</span>
        </div>
        <p className="text-sm text-muted-foreground">{record.error ?? "转换失败"}</p>
      </div>
    );
  }

  if (!record.result) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <FileText className="h-3.5 w-3.5" />
        <span className="truncate">{label}</span>
      </div>
      <CitationResultView
        result={record.result}
        onAddToLibrary={() => onAdd(record.result!)}
        addLabel={
          <span className="inline-flex items-center gap-2">
            <Library className="h-4 w-4" />
            {added ? "已加入文献库" : "加入参考文献列表"}
          </span>
        }
        disabledAdd={added}
      />
      <CitationSummarySection
        status={summaryStatus ?? "idle"}
        summary={summary ?? null}
        error={summaryError ?? null}
      />
    </div>
  );
}

function CitationSummarySection({
  status,
  summary,
  error,
}: {
  status: "idle" | "loading" | "done" | "error";
  summary: CitationJobItem["summary"];
  error: string | null;
}) {
  if (status === "idle") return null;

  if (status === "loading") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-card/60 px-4 py-3 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        正在生成文献概要…
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-card/60 px-4 py-3 text-xs text-destructive">
        <AlertCircle className="h-3.5 w-3.5" />
        概要生成失败：{error ?? "未知错误"}
      </div>
    );
  }

  if (!summary) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">文献概要（加入文献库时将自动关联）</p>
      <SummaryView summary={summary} />
    </div>
  );
}

function SummaryOnlyRun({
  onReset,
  onRetry,
  activeProjectName,
  saveAllStatus,
  setSaveAllStatus,
  onSaveItem,
  onSaveAll,
}: {
  onReset: () => void;
  onRetry: () => void;
  activeProjectName: string;
  saveAllStatus: "idle" | "saved";
  setSaveAllStatus: (value: "idle" | "saved") => void;
  onSaveItem: (item: SummaryResultItem) => void;
  onSaveAll: () => void;
}) {
  const { summaryRun } = useBackgroundTasks();
  if (!summaryRun) return null;

  if (summaryRun.phase === "processing") {
    return (
      <section className="mx-auto max-w-3xl">
        <div className="space-y-6 rounded-lg border border-border bg-card p-8 text-center">
          <Loader2 className="mx-auto h-12 w-12 animate-spin text-primary" />
          <div className="space-y-1">
            <h3 className="text-lg font-medium">
              {summaryRun.meta.mode === "file" && summaryRun.meta.totalFiles > 1
                ? `正在并行生成 ${summaryRun.meta.totalFiles} 份概要`
                : "正在生成概要"}
            </h3>
            <p className="text-sm text-muted-foreground">解析输入内容 · 提取论点、关键词与话题标签…</p>
            <p className="text-xs text-muted-foreground">切换页面不会中断请求，回来即可查看结果。</p>
          </div>
          <Button variant="secondary" size="sm" onClick={onReset}>
            取消
          </Button>
        </div>
      </section>
    );
  }

  if (summaryRun.phase === "error") {
    return (
      <section className="mx-auto max-w-3xl">
        <div className="space-y-4 rounded-lg border border-destructive/50 bg-card p-8 text-center">
          <AlertCircle className="mx-auto h-12 w-12 text-destructive" />
          <h3 className="text-lg font-medium">概要生成失败</h3>
          <p className="text-sm text-muted-foreground">{summaryRun.error ?? "未知错误，请重试。"}</p>
          <div className="flex justify-center gap-3">
            <Button variant="secondary" onClick={onReset}>
              返回重新选择
            </Button>
            <Button onClick={onRetry}>重试</Button>
          </div>
        </div>
      </section>
    );
  }

  const items = summaryRun.items;
  const total = items.length;
  const savableCount = items.filter((item) => item.summary && !item.saved).length;

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
              onClick={() => {
                onSaveAll();
                setSaveAllStatus("saved");
              }}
              disabled={savableCount === 0}
            >
              <Library className="h-4 w-4" />
              {saveAllStatus === "saved" && savableCount === 0
                ? "已保存全部成功项"
                : `保存全部成功项${savableCount > 0 ? `（${savableCount}）` : ""}`}
            </Button>
          )}
          <Button variant="secondary" onClick={onReset} className="shrink-0">
            生成新概要
          </Button>
        </div>
      </div>

      <div className="space-y-5">
        {items.map((item) => (
          <SummaryOnlyResultCard
            key={item.id}
            item={item}
            onSave={() => onSaveItem(item)}
            showHeader={total > 1}
          />
        ))}
      </div>
    </section>
  );
}

function SummaryOnlyResultCard({
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

function SwitchInput({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={
        "relative h-6 w-11 rounded-full transition-colors " + (checked ? "bg-primary" : "bg-muted")
      }
    >
      <span
        className={
          "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform " +
          (checked ? "right-0.5 translate-x-0" : "left-0.5 translate-x-0")
        }
      />
    </button>
  );
}
