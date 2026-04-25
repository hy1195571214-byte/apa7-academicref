"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { v4 as uuid } from "uuid";
import { getJob, runSummary, runSummaryBatch } from "./api";
import type {
  JobRecord,
  LiteratureSummary,
  SummaryLanguage,
  VisionMode,
} from "./types";

export type CitationSummaryStatus = "idle" | "loading" | "done" | "error";

export interface CitationJobItem {
  id: string;
  label: string;
  record: JobRecord;
  added: boolean;
  summary?: LiteratureSummary | null;
  summaryError?: string | null;
  summaryStatus?: CitationSummaryStatus;
}

export type CitationRunPhase = "processing" | "success" | "error";

export interface CitationRunMeta {
  generateSummary: boolean;
  summaryLanguage?: SummaryLanguage;
  summaryVision?: Exclude<VisionMode, "aggressive">;
}

export interface CitationRun {
  runId: string;
  phase: CitationRunPhase;
  items: CitationJobItem[];
  error: string | null;
  startedAt: number;
  meta: CitationRunMeta;
}

export interface SummaryResultItem {
  id: string;
  filename: string;
  source: "upload" | "paste";
  summary: LiteratureSummary | null;
  error: string | null;
  saved: boolean;
}

export type SummaryRunPhase = "processing" | "success" | "error";

export interface SummaryRun {
  runId: string;
  phase: SummaryRunPhase;
  items: SummaryResultItem[];
  error: string | null;
  meta: {
    mode: "file" | "paste";
    outputLanguage: SummaryLanguage;
    totalFiles: number;
  };
  startedAt: number;
}

type SummaryStartArgs =
  | {
      kind: "single-file";
      file: File;
      filename: string;
      outputLanguage: SummaryLanguage;
      vision: Exclude<VisionMode, "aggressive">;
    }
  | {
      kind: "paste";
      pastedText: string;
      outputLanguage: SummaryLanguage;
      vision: Exclude<VisionMode, "aggressive">;
    }
  | {
      kind: "batch";
      files: File[];
      outputLanguage: SummaryLanguage;
      vision: Exclude<VisionMode, "aggressive">;
    };

export interface CitationRunOptions {
  meta?: Partial<CitationRunMeta>;
  inputs?: {
    filesByJobId?: Record<string, File>;
    pastedByJobId?: Record<string, string>;
  };
}

interface BackgroundTasksContextValue {
  citationRun: CitationRun | null;
  startCitationRun: (items: CitationJobItem[], options?: CitationRunOptions) => string;
  markCitationItemAdded: (runId: string, jobId: string) => void;
  clearCitationRun: () => void;

  summaryRun: SummaryRun | null;
  startSummaryRun: (args: SummaryStartArgs) => string;
  markSummaryItemSaved: (runId: string, itemId: string) => void;
  markAllSummaryItemsSaved: (runId: string) => void;
  clearSummaryRun: () => void;
}

const Context = createContext<BackgroundTasksContextValue | null>(null);

const CITATION_SESSION_KEY = "apa7_bg_citation_v1";

function isJobSettled(record: JobRecord): boolean {
  return record.status === "succeeded" || record.status === "failed";
}

function derivePhase(items: CitationJobItem[]): CitationRunPhase {
  if (items.some((item) => !isJobSettled(item.record))) return "processing";
  const anySucceeded = items.some((item) => item.record.status === "succeeded");
  return anySucceeded ? "success" : "error";
}

function deriveError(items: CitationJobItem[]): string | null {
  const errors = items.map((item) => item.record.error).filter(Boolean) as string[];
  if (!errors.length) return null;
  return errors.join("；");
}

const DEFAULT_CITATION_META: CitationRunMeta = {
  generateSummary: false,
  summaryLanguage: "zh",
  summaryVision: "conservative",
};

function normalizeCitationMeta(meta?: Partial<CitationRunMeta>): CitationRunMeta {
  return { ...DEFAULT_CITATION_META, ...(meta ?? {}) };
}

interface CitationRunInputs {
  runId: string;
  filesByJobId: Map<string, File>;
  pastedByJobId: Map<string, string>;
}

export function BackgroundTasksProvider({ children }: { children: React.ReactNode }) {
  const [citationRun, setCitationRun] = useState<CitationRun | null>(null);
  const [summaryRun, setSummaryRun] = useState<SummaryRun | null>(null);
  const citationRef = useRef<CitationRun | null>(null);
  const citationInputsRef = useRef<CitationRunInputs | null>(null);
  const summaryTriggeredRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    citationRef.current = citationRun;
  }, [citationRun]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.sessionStorage.getItem(CITATION_SESSION_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        runId: string;
        startedAt: number;
        meta?: Partial<CitationRunMeta>;
        jobs: {
          id: string;
          label: string;
          added: boolean;
          summary?: LiteratureSummary | null;
          summaryError?: string | null;
          summaryStatus?: CitationSummaryStatus;
        }[];
      };
      if (!parsed?.jobs?.length) return;
      (async () => {
        try {
          const fetched = await Promise.all(
            parsed.jobs.map(async (job): Promise<CitationJobItem | null> => {
              try {
                const record = await getJob(job.id);
                return {
                  id: job.id,
                  label: job.label,
                  record,
                  added: job.added,
                  summary: job.summary ?? null,
                  summaryError: job.summaryError ?? null,
                  summaryStatus: job.summaryStatus ?? "idle",
                };
              } catch {
                return null;
              }
            }),
          );
          const items = fetched.filter((v): v is CitationJobItem => v !== null);
          if (!items.length) {
            window.sessionStorage.removeItem(CITATION_SESSION_KEY);
            return;
          }
          const phase = derivePhase(items);
          setCitationRun({
            runId: parsed.runId,
            phase,
            items,
            error: phase === "error" ? deriveError(items) : null,
            startedAt: parsed.startedAt,
            meta: normalizeCitationMeta(parsed.meta),
          });
        } catch {
          window.sessionStorage.removeItem(CITATION_SESSION_KEY);
        }
      })();
    } catch {
      // ignore malformed storage
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!citationRun) {
      window.sessionStorage.removeItem(CITATION_SESSION_KEY);
      return;
    }
    const payload = {
      runId: citationRun.runId,
      startedAt: citationRun.startedAt,
      meta: citationRun.meta,
      jobs: citationRun.items.map((item) => ({
        id: item.record.id,
        label: item.label,
        added: item.added,
        summary: item.summary ?? null,
        summaryError: item.summaryError ?? null,
        summaryStatus: item.summaryStatus ?? "idle",
      })),
    };
    try {
      window.sessionStorage.setItem(CITATION_SESSION_KEY, JSON.stringify(payload));
    } catch {
      // storage full – ignore
    }
  }, [citationRun]);

  useEffect(() => {
    if (!citationRun || citationRun.phase !== "processing") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const runId = citationRun.runId;

    const tick = async () => {
      if (cancelled) return;
      const current = citationRef.current;
      if (!current || current.runId !== runId || current.phase !== "processing") return;
      const pending = current.items.filter((item) => !isJobSettled(item.record));
      if (!pending.length) return;
      await Promise.all(
        pending.map(async (item) => {
          try {
            const record = await getJob(item.record.id);
            if (cancelled) return;
            setCitationRun((prev) => {
              if (!prev || prev.runId !== runId) return prev;
              const items = prev.items.map((it) =>
                it.record.id === record.id ? { ...it, record } : it,
              );
              const phase = derivePhase(items);
              return {
                ...prev,
                items,
                phase,
                error: phase === "error" ? deriveError(items) : null,
              };
            });
          } catch {
            // transient errors are swallowed; next tick retries
          }
        }),
      );
      if (cancelled) return;
      const after = citationRef.current;
      if (!after || after.runId !== runId) return;
      if (after.phase !== "processing") return;
      timer = setTimeout(tick, 1500);
    };

    tick();
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [citationRun?.runId, citationRun?.phase]);

  useEffect(() => {
    if (!citationRun) return;
    if (!citationRun.meta.generateSummary) return;
    const inputs = citationInputsRef.current;
    if (!inputs || inputs.runId !== citationRun.runId) return;

    const language = citationRun.meta.summaryLanguage ?? "zh";
    const vision = citationRun.meta.summaryVision ?? "conservative";
    const runId = citationRun.runId;

    citationRun.items.forEach((item) => {
      const jobId = item.record.id;
      if (item.record.status !== "succeeded") return;
      if (item.summaryStatus && item.summaryStatus !== "idle") return;
      if (summaryTriggeredRef.current.has(jobId)) return;
      const file = inputs.filesByJobId.get(jobId);
      const paste = inputs.pastedByJobId.get(jobId);
      if (!file && !paste) return;

      summaryTriggeredRef.current.add(jobId);
      setCitationRun((prev) => {
        if (!prev || prev.runId !== runId) return prev;
        return {
          ...prev,
          items: prev.items.map((it) =>
            it.record.id === jobId ? { ...it, summaryStatus: "loading", summaryError: null } : it,
          ),
        };
      });

      void (async () => {
        try {
          const summary = await runSummary({
            file,
            pastedText: paste,
            outputLanguage: language,
            vision,
          });
          setCitationRun((prev) => {
            if (!prev || prev.runId !== runId) return prev;
            return {
              ...prev,
              items: prev.items.map((it) =>
                it.record.id === jobId
                  ? { ...it, summaryStatus: "done", summary, summaryError: null }
                  : it,
              ),
            };
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "生成概要失败";
          setCitationRun((prev) => {
            if (!prev || prev.runId !== runId) return prev;
            return {
              ...prev,
              items: prev.items.map((it) =>
                it.record.id === jobId
                  ? { ...it, summaryStatus: "error", summaryError: message }
                  : it,
              ),
            };
          });
        }
      })();
    });
  }, [citationRun]);

  const startCitationRun = useCallback((items: CitationJobItem[], options?: CitationRunOptions) => {
    const runId = uuid();
    const phase = derivePhase(items);
    const meta = normalizeCitationMeta(options?.meta);
    const filesByJobId = new Map<string, File>();
    const pastedByJobId = new Map<string, string>();
    if (options?.inputs?.filesByJobId) {
      for (const [key, value] of Object.entries(options.inputs.filesByJobId)) {
        filesByJobId.set(key, value);
      }
    }
    if (options?.inputs?.pastedByJobId) {
      for (const [key, value] of Object.entries(options.inputs.pastedByJobId)) {
        pastedByJobId.set(key, value);
      }
    }
    citationInputsRef.current = { runId, filesByJobId, pastedByJobId };
    summaryTriggeredRef.current = new Set();

    const seeded = items.map((item) => ({
      ...item,
      summary: item.summary ?? null,
      summaryError: item.summaryError ?? null,
      summaryStatus: item.summaryStatus ?? ("idle" as CitationSummaryStatus),
    }));

    setCitationRun({
      runId,
      phase,
      items: seeded,
      error: phase === "error" ? deriveError(seeded) : null,
      startedAt: Date.now(),
      meta,
    });
    return runId;
  }, []);

  const markCitationItemAdded = useCallback((runId: string, jobId: string) => {
    setCitationRun((prev) => {
      if (!prev || prev.runId !== runId) return prev;
      return {
        ...prev,
        items: prev.items.map((item) =>
          item.record.id === jobId ? { ...item, added: true } : item,
        ),
      };
    });
  }, []);

  const clearCitationRun = useCallback(() => {
    citationInputsRef.current = null;
    summaryTriggeredRef.current = new Set();
    setCitationRun(null);
  }, []);

  const startSummaryRun = useCallback((args: SummaryStartArgs) => {
    const runId = uuid();
    const totalFiles = args.kind === "batch" ? args.files.length : 1;
    const mode = args.kind === "paste" ? "paste" : "file";
    setSummaryRun({
      runId,
      phase: "processing",
      items: [],
      error: null,
      meta: { mode, outputLanguage: args.outputLanguage, totalFiles },
      startedAt: Date.now(),
    });

    void (async () => {
      try {
        if (args.kind === "single-file") {
          const summary = await runSummary({
            file: args.file,
            outputLanguage: args.outputLanguage,
            vision: args.vision,
          });
          setSummaryRun((prev) => {
            if (!prev || prev.runId !== runId) return prev;
            return {
              ...prev,
              phase: "success",
              items: [
                {
                  id: `single-${runId}`,
                  filename: args.filename,
                  source: "upload",
                  summary,
                  error: null,
                  saved: false,
                },
              ],
            };
          });
        } else if (args.kind === "paste") {
          const summary = await runSummary({
            pastedText: args.pastedText,
            outputLanguage: args.outputLanguage,
            vision: args.vision,
          });
          setSummaryRun((prev) => {
            if (!prev || prev.runId !== runId) return prev;
            return {
              ...prev,
              phase: "success",
              items: [
                {
                  id: `paste-${runId}`,
                  filename: "粘贴文本",
                  source: "paste",
                  summary,
                  error: null,
                  saved: false,
                },
              ],
            };
          });
        } else {
          const batch = await runSummaryBatch({
            files: args.files,
            outputLanguage: args.outputLanguage,
            vision: args.vision,
          });
          setSummaryRun((prev) => {
            if (!prev || prev.runId !== runId) return prev;
            return {
              ...prev,
              phase: "success",
              items: batch.map((item, idx) => ({
                id: `batch-${runId}-${idx}`,
                filename: item.filename,
                source: "upload",
                summary: item.summary,
                error: item.error,
                saved: false,
              })),
            };
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "发生未知错误。";
        setSummaryRun((prev) => {
          if (!prev || prev.runId !== runId) return prev;
          return { ...prev, phase: "error", error: message };
        });
      }
    })();

    return runId;
  }, []);

  const markSummaryItemSaved = useCallback((runId: string, itemId: string) => {
    setSummaryRun((prev) => {
      if (!prev || prev.runId !== runId) return prev;
      return {
        ...prev,
        items: prev.items.map((item) => (item.id === itemId ? { ...item, saved: true } : item)),
      };
    });
  }, []);

  const markAllSummaryItemsSaved = useCallback((runId: string) => {
    setSummaryRun((prev) => {
      if (!prev || prev.runId !== runId) return prev;
      return {
        ...prev,
        items: prev.items.map((item) =>
          item.saved || !item.summary ? item : { ...item, saved: true },
        ),
      };
    });
  }, []);

  const clearSummaryRun = useCallback(() => {
    setSummaryRun(null);
  }, []);

  const value = useMemo<BackgroundTasksContextValue>(
    () => ({
      citationRun,
      startCitationRun,
      markCitationItemAdded,
      clearCitationRun,
      summaryRun,
      startSummaryRun,
      markSummaryItemSaved,
      markAllSummaryItemsSaved,
      clearSummaryRun,
    }),
    [
      citationRun,
      startCitationRun,
      markCitationItemAdded,
      clearCitationRun,
      summaryRun,
      startSummaryRun,
      markSummaryItemSaved,
      markAllSummaryItemsSaved,
      clearSummaryRun,
    ],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useBackgroundTasks(): BackgroundTasksContextValue {
  const ctx = useContext(Context);
  if (!ctx) {
    throw new Error("useBackgroundTasks must be used inside BackgroundTasksProvider");
  }
  return ctx;
}
