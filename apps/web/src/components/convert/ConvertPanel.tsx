"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, FileText, Library, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { UploadSurface } from "./UploadSurface";
import { CitationResultView } from "@/components/citation/CitationResultView";
import { createJob, createJobsBatch, pollJob, pollJobsUntilSettled } from "@/lib/api";
import type { CitationResult, JobRecord, LocalePolicy, VisionMode } from "@/lib/types";
import { useLibrary } from "@/lib/library";

type Mode = "file" | "paste";
type State = "idle" | "processing" | "success" | "error";

interface JobItem {
  id: string;
  label: string;
  record: JobRecord;
  added: boolean;
}

export function ConvertPanel() {
  const [mode, setMode] = useState<Mode>("file");
  const [files, setFiles] = useState<File[]>([]);
  const [pastedText, setPastedText] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [localePolicy, setLocalePolicy] = useState<LocalePolicy>("en_all");
  const [enableCrossref, setEnableCrossref] = useState(true);
  const [vision, setVision] = useState<VisionMode>("conservative");

  const [state, setState] = useState<State>("idle");
  const [items, setItems] = useState<JobItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const { addFromResult, activeProjectName } = useLibrary();

  const total = items.length;
  const completed = useMemo(
    () => items.filter((item) => item.record.status === "succeeded" || item.record.status === "failed").length,
    [items],
  );

  const progress = useMemo(() => {
    if (state === "success") return 100;
    if (state !== "processing" || total === 0) return 0;
    const running = items.filter((item) => item.record.status === "running").length;
    return Math.min(95, Math.round(((completed + running * 0.5) / total) * 100));
  }, [state, items, total, completed]);

  useEffect(() => {
    if (state !== "processing" || total === 0) return;
    if (completed === total) {
      const anySucceeded = items.some((item) => item.record.status === "succeeded");
      if (anySucceeded) {
        setState("success");
        setError(null);
      } else {
        setError(items.map((item) => item.record.error).filter(Boolean).join("；") || "全部转换失败");
        setState("error");
      }
    }
  }, [state, items, completed, total]);

  const reset = () => {
    setState("idle");
    setItems([]);
    setError(null);
  };

  const patchJob = (record: JobRecord) => {
    setItems((current) =>
      current.map((item) => (item.id === record.id ? { ...item, record } : item)),
    );
  };

  const labelFor = (record: JobRecord, fallback: string): string => {
    return record.evidence?.filename ?? fallback;
  };

  const submit = async () => {
    setError(null);
    setItems([]);
    setState("processing");
    try {
      if (mode === "file") {
        if (files.length === 0) throw new Error("请先选择要上传的文件。");
        const initial = await createJobsBatch({
          files,
          localePolicy,
          enableCrossref,
          vision,
        });
        const seeded: JobItem[] = initial.map((record, index) => ({
          id: record.id,
          label: labelFor(record, files[index]?.name ?? `文件 ${index + 1}`),
          record,
          added: false,
        }));
        setItems(seeded);
        await pollJobsUntilSettled(
          initial.map((record) => record.id),
          patchJob,
        );
      } else {
        if (!pastedText.trim()) throw new Error("请粘贴要识别的文本。");
        const initial = await createJob({
          pastedText: pastedText.trim(),
          localePolicy,
          enableCrossref,
          vision,
        });
        setItems([
          {
            id: initial.id,
            label: "粘贴文本",
            record: initial,
            added: false,
          },
        ]);
        await pollJob(initial.id, patchJob);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "发生未知错误。");
      setState("error");
    }
  };

  if (state === "processing") {
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

  if (state === "error") {
    return (
      <section className="mx-auto max-w-3xl">
        <div className="rounded-lg border border-destructive/50 bg-card p-8">
          <div className="space-y-4 text-center">
            <AlertCircle className="mx-auto h-12 w-12 text-destructive" />
            <h3 className="text-lg font-medium">处理失败</h3>
            <p className="text-sm text-muted-foreground">{error ?? "未知错误，请重试。"}</p>
            <div className="flex justify-center gap-3">
              <Button variant="secondary" onClick={reset}>
                返回重新选择
              </Button>
              <Button onClick={submit}>重试</Button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (state === "success") {
    return (
      <section className="space-y-6">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-medium">
              生成结果{total > 1 ? `（${items.length}）` : ""}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              加入文献库时将写入当前项目：{activeProjectName}
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
                addFromResult(result, "upload_job");
                setItems((current) =>
                  current.map((entry) => (entry.id === item.id ? { ...entry, added: true } : entry)),
                );
              }}
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

      {mode === "file" ? (
        <UploadSurface files={files} onFilesChange={setFiles} />
      ) : (
        <div className="rounded-lg border border-border bg-card p-6">
          <label className="mb-2 block text-sm font-medium" htmlFor="pasted">
            粘贴题录文本
          </label>
          <Textarea
            id="pasted"
            rows={8}
            placeholder="粘贴参考文献条目、数据库导出的题录，或文献摘要页面的纯文本。"
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
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm">DOI 元数据增强</p>
                <p className="text-xs text-muted-foreground">检测到 DOI 时通过 Crossref 获取更准确的题录元数据</p>
              </div>
              <SwitchInput checked={enableCrossref} onChange={setEnableCrossref} />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <label className="text-sm font-medium">输出语言</label>
                <Select
                  value={localePolicy}
                  onChange={(event) => setLocalePolicy(event.target.value as LocalePolicy)}
                >
                  <option value="en_all">全英文（默认）</option>
                  <option value="en_bracket">原文 + 括号内英文</option>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">视觉识别</label>
                <Select value={vision} onChange={(event) => setVision(event.target.value as VisionMode)}>
                  <option value="off">关闭</option>
                  <option value="conservative">保守（仅关键页）</option>
                  <option value="aggressive">积极（尽可能使用）</option>
                </Select>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
        <p className="text-center text-xs text-muted-foreground sm:mr-auto sm:text-left">
          成功加入文献库时将写入当前项目：{activeProjectName}
        </p>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {mode === "file" && files.length > 0 && (
            <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <FileText className="h-3.5 w-3.5" />
              已选择 {files.length} 个文件
            </span>
          )}
          <Button size="lg" onClick={submit}>
            {mode === "file" && files.length > 1 ? `并行生成 ${files.length} 条引用` : "生成 APA 7 引用"}
          </Button>
        </div>
      </div>
    </section>
  );
}

function JobStatusList({ items }: { items: JobItem[] }) {
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

function ResultCard({ item, onAdd }: { item: JobItem; onAdd: (result: CitationResult) => void }) {
  const { record, added, label } = item;

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
