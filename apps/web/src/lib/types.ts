export type WorkType = "journal_article" | "book" | "book_chapter" | "webpage";
export type LocalePolicy = "en_all" | "en_bracket";
export type VisionMode = "off" | "conservative" | "aggressive";
export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export interface Author {
  family?: string | null;
  given?: string | null;
  literal?: string | null;
  is_organization?: boolean;
}

export interface StructuredCitation {
  work_type: WorkType;
  language?: string | null;
  authors: Author[];
  editors?: Author[];
  year?: number | null;
  title?: string | null;
  title_original?: string | null;
  title_english?: string | null;
  container_title?: string | null;
  container_title_original?: string | null;
  container_title_english?: string | null;
  volume?: string | null;
  issue?: string | null;
  pages?: string | null;
  publisher?: string | null;
  publisher_place?: string | null;
  edition?: string | null;
  doi?: string | null;
  url?: string | null;
  accessed_date?: string | null;
  notes?: string | null;
  confidence?: number | null;
  missing_fields?: string[];
}

export interface RenderedCitation {
  reference_plain: string;
  reference_html: string;
  in_text_parenthetical: string;
  in_text_narrative: string;
}

export interface CitationResult {
  structured: StructuredCitation;
  rendered: RenderedCitation;
  locale_policy: LocalePolicy;
  crossref_used: boolean;
}

export interface JobEvidence {
  source: "upload" | "pasted_text";
  filename?: string | null;
  mime?: string | null;
  detected_type?: string | null;
  evidence_pages?: number[];
  text_preview?: string | null;
}

export interface JobRecord {
  id: string;
  status: JobStatus;
  created_at: string;
  updated_at: string;
  options: {
    locale_policy: LocalePolicy;
    enable_crossref: boolean;
    vision: VisionMode;
  };
  evidence?: JobEvidence | null;
  result?: CitationResult | null;
  error?: string | null;
}

export interface LibraryEntry {
  id: string;
  createdAt: string;
  source: "upload_job" | "manual";
  structured: StructuredCitation;
  rendered: RenderedCitation;
  localePolicy: LocalePolicy;
  crossrefUsed: boolean;
  notes?: string;
}

export type SummaryLanguage = "zh" | "en";

export interface LiteratureSummary {
  title_guess?: string | null;
  key_claims: string[];
  keywords: string[];
  topic_tags: string[];
}

export interface SummaryBatchItem {
  filename: string;
  summary: LiteratureSummary | null;
  error: string | null;
}

export interface SummaryBatchResponse {
  items: SummaryBatchItem[];
}

export interface SavedSummaryEntry {
  id: string;
  createdAt: string;
  source: "upload" | "paste";
  filename?: string | null;
  outputLanguage: SummaryLanguage;
  summary: LiteratureSummary;
}

export interface ReferenceProject {
  id: string;
  name: string;
  createdAt: string;
  entries: LibraryEntry[];
  summaries?: SavedSummaryEntry[];
}

export interface LibraryStoreV1 {
  version: 1;
  activeProjectId: string;
  projects: ReferenceProject[];
}
