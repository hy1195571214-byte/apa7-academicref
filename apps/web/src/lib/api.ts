import type {
  CitationResult,
  JobRecord,
  LiteratureSummary,
  LocalePolicy,
  StructuredCitation,
  SummaryBatchItem,
  SummaryBatchResponse,
  SummaryLanguage,
  VisionMode,
} from "./types";

const API_PREFIX = "/api/backend";

async function parseError(response: Response): Promise<string> {
  try {
    const data = await response.json();
    if (data?.detail) return typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
  } catch {
    // ignore
  }
  return `${response.status} ${response.statusText}`;
}

export async function createJob(input: {
  file?: File;
  pastedText?: string;
  localePolicy: LocalePolicy;
  enableCrossref: boolean;
  vision: VisionMode;
}): Promise<JobRecord> {
  const form = new FormData();
  if (input.file) form.append("file", input.file);
  if (input.pastedText) form.append("pasted_text", input.pastedText);
  form.append("locale_policy", input.localePolicy);
  form.append("enable_crossref", String(input.enableCrossref));
  form.append("vision", input.vision);

  const response = await fetch(`${API_PREFIX}/v1/jobs`, { method: "POST", body: form });
  if (!response.ok) throw new Error(await parseError(response));
  return response.json();
}

export async function createJobsBatch(input: {
  files: File[];
  localePolicy: LocalePolicy;
  enableCrossref: boolean;
  vision: VisionMode;
}): Promise<JobRecord[]> {
  const form = new FormData();
  for (const file of input.files) form.append("files", file);
  form.append("locale_policy", input.localePolicy);
  form.append("enable_crossref", String(input.enableCrossref));
  form.append("vision", input.vision);

  const response = await fetch(`${API_PREFIX}/v1/jobs/batch`, { method: "POST", body: form });
  if (!response.ok) throw new Error(await parseError(response));
  const payload = (await response.json()) as { jobs: JobRecord[] };
  return payload.jobs;
}

export async function getJob(id: string): Promise<JobRecord> {
  const response = await fetch(`${API_PREFIX}/v1/jobs/${id}`, { cache: "no-store" });
  if (!response.ok) throw new Error(await parseError(response));
  return response.json();
}

export async function renderCitation(input: {
  structured: StructuredCitation;
  localePolicy: LocalePolicy;
  enableCrossref: boolean;
}): Promise<CitationResult> {
  const response = await fetch(`${API_PREFIX}/v1/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      structured: input.structured,
      locale_policy: input.localePolicy,
      enable_crossref: input.enableCrossref,
    }),
  });
  if (!response.ok) throw new Error(await parseError(response));
  return response.json();
}

export async function runSummary(input: {
  file?: File;
  pastedText?: string;
  outputLanguage: SummaryLanguage;
  vision: Exclude<VisionMode, "aggressive">;
}): Promise<LiteratureSummary> {
  const form = new FormData();
  if (input.file) form.append("file", input.file);
  if (input.pastedText) form.append("pasted_text", input.pastedText);
  form.append("output_language", input.outputLanguage);
  form.append("vision", input.vision);

  const response = await fetch(`${API_PREFIX}/v1/summary`, { method: "POST", body: form });
  if (!response.ok) throw new Error(await parseError(response));
  return response.json();
}

export async function runSummaryBatch(input: {
  files: File[];
  outputLanguage: SummaryLanguage;
  vision: Exclude<VisionMode, "aggressive">;
}): Promise<SummaryBatchItem[]> {
  const form = new FormData();
  for (const file of input.files) form.append("files", file);
  form.append("output_language", input.outputLanguage);
  form.append("vision", input.vision);

  const response = await fetch(`${API_PREFIX}/v1/summary/batch`, { method: "POST", body: form });
  if (!response.ok) throw new Error(await parseError(response));
  const payload = (await response.json()) as SummaryBatchResponse;
  return payload.items;
}

export async function pollJob(id: string, onUpdate: (record: JobRecord) => void, intervalMs = 1500): Promise<JobRecord> {
  while (true) {
    const record = await getJob(id);
    onUpdate(record);
    if (record.status === "succeeded" || record.status === "failed") return record;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export async function pollJobsUntilSettled(
  ids: string[],
  onUpdate: (record: JobRecord) => void,
  intervalMs = 1500,
): Promise<JobRecord[]> {
  const settle = (id: string) => pollJob(id, onUpdate, intervalMs);
  return Promise.all(ids.map(settle));
}
