"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { v4 as uuid } from "uuid";
import type {
  CitationResult,
  LibraryEntry,
  LibraryStoreV1,
  LocalePolicy,
  ReferenceProject,
  StructuredCitation,
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
  const activeOk = store.projects.some((p) => p.id === store.activeProjectId);
  if (activeOk) return store;
  return { ...store, activeProjectId: store.projects[0].id };
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
        projects[idx] = { ...p, entries: p.entries.filter((e) => e.id !== id) };
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
      projects[idx] = { ...projects[idx], entries: [] };
      return { ...s, projects };
    });
  }, [updateStore]);

  return {
    entries,
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
