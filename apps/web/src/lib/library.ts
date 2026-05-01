"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { v4 as uuid } from "uuid";
import type {
  CitationResult,
  LibraryEntry,
  LibraryStoreV1,
  LiteratureSummary,
  LocalePolicy,
  ReferenceProject,
  SavedSummaryEntry,
  StructuredCitation,
  SummaryLanguage,
} from "./types";

export const LIBRARY_STORAGE_KEY = "apa7_library_v1";
const LEGACY_LIST_KEY = "apa7_reference_list_v1";

function dispatchStorageSync(key: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new StorageEvent("storage", { key }));
}

function createEmptyStore(): LibraryStoreV1 {
  const id = uuid();
  const now = new Date().toISOString();
  return {
    version: 1,
    activeProjectId: id,
    projects: [
      {
        id,
        name: "默认项目",
        createdAt: now,
        entries: [],
        summaries: [],
      },
    ],
  };
}

function isValidStore(parsed: unknown): parsed is LibraryStoreV1 {
  if (!parsed || typeof parsed !== "object") return false;
  const o = parsed as Record<string, unknown>;
  if (o.version !== 1) return false;
  if (typeof o.activeProjectId !== "string") return false;
  if (!Array.isArray(o.projects) || o.projects.length === 0) return false;
  for (const item of o.projects) {
    if (!item || typeof item !== "object") return false;
    const p = item as Record<string, unknown>;
    if (typeof p.id !== "string" || typeof p.name !== "string" || typeof p.createdAt !== "string") return false;
    if (!Array.isArray(p.entries)) return false;
  }
  return true;
}

function normalizeStore(store: LibraryStoreV1): LibraryStoreV1 {
  if (store.projects.length === 0) return createEmptyStore();
  const projects = store.projects.map((project) => {
    const summariesRaw = Array.isArray(project.summaries) ? project.summaries : [];
    const entryIds = new Set(project.entries.map((entry) => entry.id));
    const summaries = summariesRaw.map((summary) => {
      const linked = summary.linkedEntryId ?? null;
      if (linked && entryIds.has(linked)) return { ...summary, linkedEntryId: linked };
      return { ...summary, linkedEntryId: null };
    });
    return { ...project, summaries };
  });
  const activeOk = projects.some((p) => p.id === store.activeProjectId);
  const activeProjectId = activeOk ? store.activeProjectId : projects[0].id;
  return { ...store, projects, activeProjectId };
}

export interface DuplicateMatch {
  existingEntry: LibraryEntry;
  reason: "doi" | "title-author-year";
  confidence: "exact" | "high";
  existingLabel: string;
  candidateLabel: string;
}

function normalizeForMatch(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function titleSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  if (!a || !b) return 0;
  const na = normalizeForMatch(a);
  const nb = normalizeForMatch(b);
  if (na === nb) return 1;
  const [la, lb] = [na.split(" "), nb.split(" ")];
  const intersection = la.filter((w) => lb.includes(w)).length;
  const union = new Set([...la, ...lb]).size;
  return union === 0 ? 0 : intersection / union;
}

function authorKey(authors: StructuredCitation["authors"]): string {
  return authors
    .slice(0, 3)
    .map((a) => (a.family ?? a.literal ?? a.given ?? "").toLowerCase().trim())
    .filter(Boolean)
    .sort()
    .join("|");
}

function labelForCitationResult(result: CitationResult): string {
  const first = result.structured.authors?.[0];
  const author = first ? (first.family ?? first.literal ?? first.given ?? "").trim() : "";
  const year = result.structured.year ? String(result.structured.year) : "";
  const title =
    result.structured.title_english?.trim() ??
    result.structured.title?.trim() ??
    result.structured.title_original?.trim() ??
    "";
  const prefix = [author, year].filter(Boolean).join(" · ");
  return (prefix ? `${prefix} · ${title}` : title).slice(0, 80);
}

function labelForEntry(entry: LibraryEntry): string {
  const first = entry.structured.authors?.[0];
  const author = first ? (first.family ?? first.literal ?? first.given ?? "").trim() : "";
  const year = entry.structured.year ? String(entry.structured.year) : "";
  const title =
    entry.structured.title_english?.trim() ??
    entry.structured.title?.trim() ??
    entry.structured.title_original?.trim() ??
    "";
  const prefix = [author, year].filter(Boolean).join(" · ");
  return (prefix ? `${prefix} · ${title}` : title).slice(0, 80);
}

/**
 * Returns the best duplicate match found in `entries` for `candidate`,
 * or null if no duplicate is detected.
 *
 * Detection order:
 *  1. DOI exact match (exact)
 *  2. Title similarity >= 0.7 + same author key + same year (high)
 */
export function checkDuplicate(
  entries: LibraryEntry[],
  candidate: CitationResult,
): DuplicateMatch | null {
  const candDoi = candidate.structured.doi?.trim() || null;

  // 1. DOI exact
  if (candDoi) {
    for (const entry of entries) {
      if (entry.structured.doi?.trim() === candDoi) {
        return {
          existingEntry: entry,
          reason: "doi",
          confidence: "exact",
          existingLabel: labelForEntry(entry),
          candidateLabel: labelForCitationResult(candidate),
        };
      }
    }
  }

  // 2. Title + author + year
  const candTitle =
    candidate.structured.title_english?.trim() ??
    candidate.structured.title?.trim() ??
    null;
  const candAuthors = candidate.structured.authors ?? [];
  const candYear = candidate.structured.year ?? null;
  const candAuthorKey = authorKey(candAuthors);

  for (const entry of entries) {
    if (entry.structured.doi?.trim() === candDoi) continue; // already handled
    const sim = titleSimilarity(
      candTitle,
      entry.structured.title_english ?? entry.structured.title ?? null,
    );
    if (sim < 0.7) continue;
    if (authorKey(entry.structured.authors ?? []) !== candAuthorKey) continue;
    if (candYear && entry.structured.year === candYear) {
      return {
        existingEntry: entry,
        reason: "title-author-year",
        confidence: "high",
        existingLabel: labelForEntry(entry),
        candidateLabel: labelForCitationResult(candidate),
      };
    }
  }

  return null;
}

/** Migrate legacy flat `LibraryEntry[]` into a single default project (exported for tests / tooling). */
export function migrateLegacyLibrary(entries: LibraryEntry[]): LibraryStoreV1 {
  const id = uuid();
  const now = new Date().toISOString();
  return {
    version: 1,
    activeProjectId: id,
    projects: [
      {
        id,
        name: "默认项目",
        createdAt: now,
        entries: [...entries],
        summaries: [],
      },
    ],
  };
}

export function readStore(): LibraryStoreV1 {
  if (typeof window === "undefined") return createEmptyStore();
  try {
    const rawNew = window.localStorage.getItem(LIBRARY_STORAGE_KEY);
    if (rawNew) {
      const parsed: unknown = JSON.parse(rawNew);
      if (isValidStore(parsed)) return normalizeStore(parsed);
    }
    const rawLegacy = window.localStorage.getItem(LEGACY_LIST_KEY);
    if (rawLegacy) {
      const parsed: unknown = JSON.parse(rawLegacy);
      if (Array.isArray(parsed)) {
        const store = migrateLegacyLibrary(parsed as LibraryEntry[]);
        window.localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(store));
        window.localStorage.removeItem(LEGACY_LIST_KEY);
        dispatchStorageSync(LIBRARY_STORAGE_KEY);
        return store;
      }
    }
  } catch {
    // fall through to fresh store
  }
  const fresh = createEmptyStore();
  window.localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(fresh));
  dispatchStorageSync(LIBRARY_STORAGE_KEY);
  return fresh;
}

function writeStore(store: LibraryStoreV1): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(normalizeStore(store)));
  dispatchStorageSync(LIBRARY_STORAGE_KEY);
}

function projectIndex(store: LibraryStoreV1): number {
  const idx = store.projects.findIndex((p) => p.id === store.activeProjectId);
  return idx === -1 ? 0 : idx;
}

export function useLibrary() {
  const [store, setStore] = useState<LibraryStoreV1 | null>(null);

  useEffect(() => {
    setStore(readStore());
    const onStorage = (event: StorageEvent) => {
      if (event.key === LIBRARY_STORAGE_KEY) setStore(readStore());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const effective = store ?? null;

  const activeProject = useMemo(() => {
    if (!effective) return undefined;
    return effective.projects.find((p) => p.id === effective.activeProjectId) ?? effective.projects[0];
  }, [effective]);

  const entries = activeProject?.entries ?? [];
  const projects = effective?.projects ?? [];
  const activeProjectId = effective?.activeProjectId ?? "";
  const activeProjectName = activeProject?.name ?? "默认项目";

  const updateStore = useCallback((fn: (current: LibraryStoreV1) => LibraryStoreV1) => {
    setStore((prev) => {
      const base = prev ?? readStore();
      const next = normalizeStore(fn(base));
      writeStore(next);
      return next;
    });
  }, []);

  const setActiveProject = useCallback(
    (id: string) => {
      updateStore((s) => {
        if (!s.projects.some((p) => p.id === id)) return s;
        return { ...s, activeProjectId: id };
      });
    },
    [updateStore],
  );

  const createProject = useCallback(
    (name?: string) => {
      const trimmed = (name ?? "").trim() || "新项目";
      const newId = uuid();
      const newProject: ReferenceProject = {
        id: newId,
        name: trimmed,
        createdAt: new Date().toISOString(),
        entries: [],
        summaries: [],
      };
      updateStore((s) => ({
        ...s,
        projects: [...s.projects, newProject],
        activeProjectId: newId,
      }));
    },
    [updateStore],
  );

  const renameProject = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      updateStore((s) => ({
        ...s,
        projects: s.projects.map((p) => (p.id === id ? { ...p, name: trimmed } : p)),
      }));
    },
    [updateStore],
  );

  const deleteProject = useCallback(
    (id: string) => {
      updateStore((s) => {
        const remaining = s.projects.filter((p) => p.id !== id);
        if (remaining.length === 0) return migrateLegacyLibrary([]);
        let activeProjectId = s.activeProjectId;
        if (activeProjectId === id) activeProjectId = remaining[0].id;
        else if (!remaining.some((p) => p.id === activeProjectId)) activeProjectId = remaining[0].id;
        return { ...s, projects: remaining, activeProjectId };
      });
    },
    [updateStore],
  );

  const addFromResult = useCallback(
    (result: CitationResult, source: LibraryEntry["source"]): LibraryEntry => {
      const entry: LibraryEntry = {
        id: uuid(),
        createdAt: new Date().toISOString(),
        source,
        structured: result.structured,
        rendered: result.rendered,
        localePolicy: result.locale_policy,
        crossrefUsed: result.crossref_used,
      };
      updateStore((s) => {
        const idx = projectIndex(s);
        const projects = [...s.projects];
        const p = projects[idx];
        projects[idx] = { ...p, entries: [entry, ...p.entries] };
        return { ...s, projects };
      });
      return entry;
    },
    [updateStore],
  );

  const update = useCallback(
    (id: string, updater: (entry: LibraryEntry) => LibraryEntry) => {
      updateStore((s) => {
        const idx = projectIndex(s);
        const projects = s.projects.map((p, i) =>
          i === idx ? { ...p, entries: p.entries.map((e) => (e.id === id ? updater(e) : e)) } : p,
        );
        return { ...s, projects };
      });
    },
    [updateStore],
  );

  const remove = useCallback(
    (id: string) => {
      updateStore((s) => {
        const idx = projectIndex(s);
        const projects = [...s.projects];
        const p = projects[idx];
        const summaries = (p.summaries ?? []).map((entry) =>
          entry.linkedEntryId === id ? { ...entry, linkedEntryId: null } : entry,
        );
        projects[idx] = { ...p, entries: p.entries.filter((e) => e.id !== id), summaries };
        return { ...s, projects };
      });
    },
    [updateStore],
  );

  const move = useCallback(
    (id: string, direction: -1 | 1) => {
      updateStore((s) => {
        const idx = projectIndex(s);
        const projects = [...s.projects];
        const p = projects[idx];
        const current = [...p.entries];
        const index = current.findIndex((e) => e.id === id);
        if (index === -1) return s;
        const target = index + direction;
        if (target < 0 || target >= current.length) return s;
        [current[index], current[target]] = [current[target], current[index]];
        projects[idx] = { ...p, entries: current };
        return { ...s, projects };
      });
    },
    [updateStore],
  );

  const clear = useCallback(() => {
    updateStore((s) => {
      const idx = projectIndex(s);
      const projects = [...s.projects];
      const p = projects[idx];
      const summaries = (p.summaries ?? []).map((entry) => ({ ...entry, linkedEntryId: null }));
      projects[idx] = { ...p, entries: [], summaries };
      return { ...s, projects };
    });
  }, [updateStore]);

  const addSummary = useCallback(
    (input: {
      summary: LiteratureSummary;
      source: SavedSummaryEntry["source"];
      filename?: string | null;
      outputLanguage: SummaryLanguage;
      linkedEntryId?: string | null;
    }): SavedSummaryEntry => {
      const entry: SavedSummaryEntry = {
        id: uuid(),
        createdAt: new Date().toISOString(),
        source: input.source,
        filename: input.filename ?? null,
        outputLanguage: input.outputLanguage,
        summary: input.summary,
        linkedEntryId: input.linkedEntryId ?? null,
      };
      updateStore((s) => {
        const idx = projectIndex(s);
        const projects = [...s.projects];
        const p = projects[idx];
        const summaries = Array.isArray(p.summaries) ? p.summaries : [];
        const entryIds = new Set(p.entries.map((e) => e.id));
        const normalized: SavedSummaryEntry = {
          ...entry,
          linkedEntryId: entry.linkedEntryId && entryIds.has(entry.linkedEntryId) ? entry.linkedEntryId : null,
        };
        projects[idx] = { ...p, summaries: [normalized, ...summaries] };
        return { ...s, projects };
      });
      return entry;
    },
    [updateStore],
  );

  const removeSummary = useCallback(
    (id: string) => {
      updateStore((s) => {
        const idx = projectIndex(s);
        const projects = [...s.projects];
        const p = projects[idx];
        const summaries = Array.isArray(p.summaries) ? p.summaries : [];
        projects[idx] = { ...p, summaries: summaries.filter((e) => e.id !== id) };
        return { ...s, projects };
      });
    },
    [updateStore],
  );

  const linkSummaryToEntry = useCallback(
    (summaryId: string, entryId: string | null) => {
      updateStore((s) => {
        const idx = projectIndex(s);
        const projects = [...s.projects];
        const p = projects[idx];
        const summaries = Array.isArray(p.summaries) ? p.summaries : [];
        const entryIds = new Set(p.entries.map((e) => e.id));
        const nextLinked = entryId && entryIds.has(entryId) ? entryId : null;
        projects[idx] = {
          ...p,
          summaries: summaries.map((entry) =>
            entry.id === summaryId ? { ...entry, linkedEntryId: nextLinked } : entry,
          ),
        };
        return { ...s, projects };
      });
    },
    [updateStore],
  );

  const summaries = activeProject?.summaries ?? [];

  return {
    entries,
    summaries,
    projects,
    activeProjectId,
    activeProjectName,
    setActiveProject,
    createProject,
    renameProject,
    deleteProject,
    addFromResult,
    update,
    remove,
    move,
    clear,
    addSummary,
    removeSummary,
    linkSummaryToEntry,
  };
}

export function emptyStructured(workType: StructuredCitation["work_type"] = "journal_article"): StructuredCitation {
  return {
    work_type: workType,
    authors: [],
    editors: [],
    missing_fields: [],
    language: null,
    year: null,
    title: null,
    title_original: null,
    title_english: null,
    container_title: null,
    container_title_original: null,
    container_title_english: null,
    volume: null,
    issue: null,
    pages: null,
    publisher: null,
    publisher_place: null,
    edition: null,
    doi: null,
    url: null,
    accessed_date: null,
    notes: null,
    confidence: null,
  };
}

export function defaultLocalePolicy(): LocalePolicy {
  return "en_all";
}
