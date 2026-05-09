"""MiniMax client: two-phase extraction (JSON) and APA7 rendering."""

from __future__ import annotations

import base64
import json
import logging
import re
import time
import uuid
from pathlib import Path
from typing import Any, Iterable, List, Optional

import httpx
from tenacity import (
    AsyncRetrying,
    RetryError,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from ..core.config import Settings
from ..schemas.citation import StructuredCitation
from ..schemas.summary import LiteratureSummary

logger = logging.getLogger(__name__)
_DEBUG_LOG_PATH = Path("/Users/wangyichen/.cursor/projects/apa7th webside/.cursor/debug-030a4d.log")


def _debug_log(*, run_id: str, hypothesis_id: str, location: str, message: str, data: dict) -> None:
    # region agent log
    entry = {
        "sessionId": "030a4d",
        "id": f"log_{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}",
        "timestamp": int(time.time() * 1000),
        "runId": run_id,
        "hypothesisId": hypothesis_id,
        "location": location,
        "message": message,
        "data": data,
    }
    try:
        with _DEBUG_LOG_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        pass
    # endregion


EXTRACTION_SYSTEM_PROMPT = """You extract bibliographic metadata for APA 7th
edition citations. Read the user supplied excerpts (possibly OCR noisy) and
return STRICT JSON matching the schema below. Never invent data; use null when
you are not confident. Prefer Chinese or native text for `title_original`, but
always provide an English translation in `title_english` when the source is
non-English. Prefer official English journal / publisher names when known.

Schema keys:
- work_type: one of "journal_article", "book", "book_chapter", "webpage".
- language: BCP-47 language tag of the source (e.g. "en", "zh").
- authors: array of { family, given, literal, is_organization }. Use `literal`
  (+ is_organization=true) for group authors. For Chinese names, transliterate
  to pinyin in `given`/`family`. `given` must hold initials or given names in
  their original order (do not invert here; the renderer handles inversion).
- editors: same shape as authors (books / chapters only).
- For array-valued keys `authors`, `editors`, and `missing_fields`, use an
  empty JSON array [] when unknown; never use null for these keys (null breaks
  downstream parsing).
- year: integer publication year.
- title: best title to display (English preferred when available).
- title_original: raw non-English title if applicable.
- title_english: English translation or official English title.
- container_title / container_title_english: journal / book name.
- volume: string of digits only (e.g. "12"). Do not include "Vol." or the
  issue number here.
- issue: string of digits only (e.g. "3"). Do not wrap in parentheses.
- pages: string page range using an en dash "\u2013" (e.g. "12\u201324"). Convert
  hyphens "-" or tildes to en dashes. Keep article numbers as-is when a
  range is not available.
- publisher: the publisher name only.
- publisher_place: leave null for APA 7; only populate if the source itself
  reports a place AND the user explicitly needs it. Never infer city or
  country.
- edition: ordinal string such as "2nd" or "Revised"; omit for first editions.
- doi: output only the DOI suffix (e.g. "10.1000/xyz123") without the
  "https://doi.org/" prefix; the renderer adds it. Strip any surrounding
  whitespace or "doi:" prefix.
- url: full URL only when `doi` is absent. Do not store database landing
  pages (e.g. proxy.library.*).
- accessed_date: ISO date "YYYY-MM-DD" for webpages only.
- confidence: 0..1 overall confidence.
- missing_fields: array of schema keys you could not fill.

Respond with JSON only, no markdown fences."""

EXTRACTION_BATCH_SYSTEM_PROMPT = """You are an academic citation parser. Given a block of text
that may contain one or more reference list entries, identify each reference
and extract structured metadata (APA 7th) for each one.

Return a JSON object with this exact structure:
{
  "references": [
    { ... structured citation fields for reference 1 ... },
    { ... structured citation fields for reference 2 ... },
    ...
  ],
  "boundaries": [start_char_index_1, start_char_index_2, ...]
}

Rules:
- Split references by looking for patterns like: author-year at start of a new
  line, numbered references [1], [2], blank lines between entries, or DOIs.
- Each reference may span one or more lines; boundaries indicate the character
  offset in the ORIGINAL text where each reference begins.
- If a field is unknown, use null. For array fields (authors, editors,
  missing_fields) always use [] when unknown, never null.
- work_type: one of "journal_article", "book", "book_chapter", "webpage".
- doi: output only the suffix (e.g. "10.1000/xyz123"), not the full URL.
- confidence: rate your overall confidence for each reference 0..1.
- If no references are found, return {"references": [], "boundaries": []}.
- NEVER invent data. If a reference is incomplete, extract only what is present
  and set confidence accordingly.
- Respond with JSON only, no markdown fences."""


RENDER_SYSTEM_PROMPT = """You format bibliographic JSON into APA 7th edition
output. Return STRICT JSON with exactly these keys:
reference_plain, reference_html, in_text_parenthetical, in_text_narrative.
No markdown, no code fences, no commentary inside any value.

General formatting rules (APA 7th, Publication Manual 2020):
- Authors: invert every name to `Family, I. I.` using initials (no full given
  names). Separate multiple authors with commas, and put `, & ` before the
  final author (e.g. `Smith, J., Doe, A., & Lee, B.`). For a single author,
  no comma before the period. For group/organisation authors (is_organization
  = true or only `literal` provided), output the organisation name verbatim
  without inversion.
- Year: `(YYYY).` right after the author block. Use `(n.d.).` when `year` is
  null. For webpages with a full `accessed_date` but no `year`, use
  `(YYYY, Month D).` only if the structured payload provides that date; never
  invent dates.
- Titles — case and italics:
  * Article, chapter, webpage, and book titles are written in sentence case
    (capitalise only the first word, the first word after a colon, and proper
    nouns). Do not italicise article or chapter titles.
  * Journal / periodical names use title case and ARE italicised.
  * Book titles and standalone report titles are italicised (sentence case
    inside italics).
  * Website names are generally italicised on webpage entries.
- Punctuation and characters:
  * Use an en dash `\u2013` (not a hyphen) for page ranges and year ranges.
  * Separate reference-list elements with `. ` (period + space) and never end
    the entry with a trailing period after a URL/DOI.
  * Do not append editor notes, translator notes, or `[comment]` style
    annotations to the entry; if a field is unknown, omit it gracefully.
- DOIs and URLs:
  * If `doi` is present, output `https://doi.org/<doi>`. If the input already
    starts with `http`, keep it; if it is just the suffix (e.g. `10.1000/xyz`),
    prepend `https://doi.org/`.
  * If no DOI but a stable `url` exists (webpages, online reports), append the
    URL. Do not include database names or retrieval statements except for
    webpages whose content is expected to change AND that lack a publication
    date; in that case write `Retrieved Month D, YYYY, from <url>` using
    `accessed_date`.
- Missing fields: silently omit the segment (including surrounding punctuation)
  rather than printing placeholders like "n.p." or empty parentheses.

Per work_type templates (fill in only the segments whose data exists):

- journal_article:
    `Authors (Year). Article title in sentence case. *Journal Name*,
     *volume*(issue), pages. https://doi.org/...`
  Notes: italicise the journal name AND the volume number; the issue number is
  enclosed in parentheses immediately after the volume and is NOT italicised.
  Page ranges use en dash. Omit `(issue)` when the input has no issue.

- book:
    `Authors (Year). *Book title in sentence case* (n ed.). Publisher.
     https://doi.org/...`
  Notes: italicise the book title only. Include `(n ed.)` only when `edition`
  is present. Do NOT include a publisher location (APA 7 dropped city/country).
  Include the DOI if available; otherwise omit.

- book_chapter:
    `Chapter Authors (Year). Chapter title in sentence case. In I. Editor &
     I. Editor (Eds.), *Book title* (pp. xx\u2013yy). Publisher.
     https://doi.org/...`
  Notes: chapter title is not italicised; book title is. Use `(Ed.)` for a
  single editor and `(Eds.)` for multiple. Use `pp. ` before the chapter page
  range with an en dash. Omit editors segment if none are provided.

- webpage:
    `Authors (Year, Month D). Title of the page in sentence case. *Site Name*.
     https://...`
  Notes: if the site name is essentially the same as the author (e.g.
  organisation that also owns the site), omit the site name to avoid a
  duplicate. Only output `Retrieved ... from` for intentionally dynamic pages
  without a publication date (see DOI/URL rules above).

reference_html rules:
- Produce exactly the same textual content as reference_plain, but wrap ONLY
  the segments APA requires to be italic in `<em>...</em>`:
  * journal name AND volume number (journal articles)
  * book title (books and book chapters)
  * site name (webpages, when rendered)
- Do not italicise article titles, chapter titles, issue numbers, page ranges,
  publishers, editors, or DOIs.
- Do not introduce any tag other than `<em>`. Escape `<`, `>`, `&` inside any
  data you did not wrap yourself.

In-text citations:
- in_text_parenthetical:
  * 1 author: `(Family, Year)`
  * 2 authors: `(Family1 & Family2, Year)` (use `&` inside parentheses)
  * 3+ authors: `(Family1 et al., Year)` (APA 7 uses et al. from the first
    citation onward for 3+ authors)
  * Group author: `(Full Organisation Name, Year)` on first mention; acronyms
    are only acceptable if the input explicitly provides one.
  * Unknown year: `(Family, n.d.)`.
- in_text_narrative:
  * Mirror the parenthetical form but write the author(s) outside parentheses
    with the year in parentheses. Use `and` (not `&`) between two authors:
    e.g. `Smith and Lee (2020)`. For 3+ authors: `Smith et al. (2020)`.
- Do not include page numbers unless a `locator` / `pages` hint is explicitly
  supplied for citing a specific passage; this renderer targets the reference
  list + default in-text forms.

Locale policy:
- If locale_policy == "en_all", render every field in English. Prefer
  `title_english` and `container_title_english` over the original-script
  fields; never leave original-script text in the rendered strings. If only
  a non-English form is available, transliterate (pinyin for Chinese) rather
  than keeping CJK characters.
- Never invent translations; if both English and original are missing, omit
  the segment.

Output constraints:
- The JSON object must contain only the four keys above, all as strings.
- Never emit nulls, markdown, backticks, trailing whitespace, or explanatory
  text."""


SUMMARY_SYSTEM_PROMPT_ZH = """你负责阅读学术文献的文字或配图，并输出该文献的结构化概要。
严格输出 JSON（不要使用 Markdown 代码围栏、也不要额外解说），键固定为：
- title_guess: 若原文有明确标题，填写；否则为 null（字符串或 null）。
- key_claims: 3 到 8 条核心论点或结论，每条一个中文短句（不超过 40 字），按原文出现顺序排列；必须基于原文信息，不得臆造。
- keywords: 5 到 15 个关键词，单个词或短词组，中文优先；若原文本身为英文术语且无广泛中文对应，可保留英文原词。
- topic_tags: 3 到 10 个更高层的话题标签，用于分类与检索，例如学科、研究方法、研究对象等，中文为主、简洁。

通用规则：
- 所有文本使用简体中文输出（除保留的英文专有名词外）。
- 不允许在任何字段里出现 Markdown、编号、前后引号或多余空白。
- 对于数组字段，如果内容未知必须输出空数组 []，禁止使用 null。
- 不要输出 JSON 之外的任何字符。"""


SUMMARY_SYSTEM_PROMPT_EN = """You read an academic work (text or images) and output a structured summary.
Return STRICT JSON only (no markdown fences, no commentary). Keys:
- title_guess: a clear title if present in the source, else null.
- key_claims: 3 to 8 short English sentences stating the main claims or findings, in source order. Ground them in the source; do not invent.
- keywords: 5 to 15 keywords or short phrases relevant to the work.
- topic_tags: 3 to 10 higher-level topical tags suitable for cataloguing (field, method, object of study, etc.).

Rules:
- English throughout.
- No markdown, numbering, stray quotes, or trailing whitespace inside any value.
- For unknown arrays use [] (never null).
- Output JSON only."""


class MiniMaxClient:
    def __init__(self, settings: Settings) -> None:
        self._api_key = settings.minimax_api_key
        self._base_url = settings.minimax_base_url.rstrip("/")
        self._model_text = settings.minimax_model_text
        self._model_vision = settings.minimax_model_vision
        self._timeout = settings.request_timeout_seconds

    @property
    def configured(self) -> bool:
        return bool(self._api_key)

    async def extract_structured(
        self,
        *,
        text: str,
        images: Optional[List[bytes]] = None,
        hints: Optional[dict[str, Any]] = None,
    ) -> StructuredCitation:
        payload = _extraction_prompt(text=text, hints=hints)
        model = self._model_vision if images else self._model_text
        content = _build_user_content(payload, images or [])
        response = await self._chat(
            model=model,
            messages=[
                {"role": "system", "content": EXTRACTION_SYSTEM_PROMPT},
                {"role": "user", "content": content},
            ],
        )
        data = _parse_json(response)
        return StructuredCitation.model_validate(data)

    async def summarize(
        self,
        *,
        text: str,
        images: Optional[List[bytes]] = None,
        language: str = "zh",
    ) -> LiteratureSummary:
        run_id = f"minimax_summary_{int(time.time() * 1000)}"
        system_prompt = SUMMARY_SYSTEM_PROMPT_EN if language == "en" else SUMMARY_SYSTEM_PROMPT_ZH
        header = (
            "Excerpt:\n" if text else "(Visual input only; transcribe and summarise.)\n"
        )
        payload = f"{header}{text}" if text else header
        model = self._model_vision if images else self._model_text
        content = _build_user_content(payload, images or [])
        _debug_log(
            run_id=run_id,
            hypothesis_id="H1_H2_H3",
            location="services/minimax.py:summarize",
            message="Sending summary request to MiniMax",
            data={"model": model, "text_length": len(text or ""), "image_count": len(images or [])},
        )
        try:
            response = await self._chat(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": content},
                ],
            )
            _debug_log(
                run_id=run_id,
                hypothesis_id="H2_H3",
                location="services/minimax.py:summarize",
                message="Received raw summary response",
                data={"response_preview": (response or "")[:200], "response_length": len(response or "")},
            )
            data = _parse_json(response)
            summary = LiteratureSummary.model_validate(data)
            _debug_log(
                run_id=run_id,
                hypothesis_id="H3",
                location="services/minimax.py:summarize",
                message="Summary model validation succeeded",
                data={
                    "key_claims_count": len(summary.key_claims),
                    "keywords_count": len(summary.keywords),
                    "topic_tags_count": len(summary.topic_tags),
                },
            )
            return summary
        except Exception as exc:
            _debug_log(
                run_id=run_id,
                hypothesis_id="H1_H2_H3",
                location="services/minimax.py:summarize",
                message="Summary processing failed",
                data={"error_type": type(exc).__name__, "error": str(exc)},
            )
            raise

    async def render_apa(
        self,
        *,
        structured: StructuredCitation,
        locale_policy: str,
    ) -> dict[str, str]:
        user_payload = {
            "locale_policy": locale_policy,
            "structured": structured.model_dump(mode="json"),
        }
        response = await self._chat(
            model=self._model_text,
            messages=[
                {"role": "system", "content": RENDER_SYSTEM_PROMPT},
                {"role": "user", "content": [{"type": "text", "text": json.dumps(user_payload, ensure_ascii=False)}]},
            ],
        )
        data = _parse_json(response)
        return {
            "reference_plain": str(data.get("reference_plain", "")),
            "reference_html": str(data.get("reference_html", "")),
            "in_text_parenthetical": str(data.get("in_text_parenthetical", "")),
            "in_text_narrative": str(data.get("in_text_narrative", "")),
        }

    async def _chat(
        self,
        *,
        model: str,
        messages: list[dict[str, Any]],
        timeout_override: Optional[float] = None,
    ) -> str:
        if not self._api_key:
            raise RuntimeError("MINIMAX_API_KEY is not configured")
        url = f"{self._base_url}/text/chatcompletion_v2"
        body = {
            "model": model,
            "messages": messages,
            "temperature": 0.1,
        }
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

        timeout = timeout_override if timeout_override is not None else self._timeout

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(url, json=body, headers=headers)
            _debug_log(
                run_id=f"minimax_chat_{int(time.time() * 1000)}",
                hypothesis_id="H1",
                location="services/minimax.py:_chat",
                message="MiniMax HTTP response received",
                data={"status_code": response.status_code, "model": model},
            )
            if response.status_code >= 500:
                raise httpx.HTTPStatusError(
                    f"Server error: {response.status_code}",
                    request=response.request,
                    response=response,
                )
            response.raise_for_status()
            return _extract_completion_text(response.json())
        except httpx.TimeoutException as exc:
            raise
        except httpx.HTTPStatusError:
            raise
        except (httpx.ConnectError, httpx.RemoteProtocolError, httpx.TransportError):
            raise
        except Exception:
            raise


def _extraction_prompt(*, text: str, hints: Optional[dict[str, Any]]) -> str:
    header = "Excerpt:\n" if text else "(Visual input only; transcribe and extract metadata.)\n"
    hint_section = f"\n\nHints: {json.dumps(hints, ensure_ascii=False)}" if hints else ""
    return f"{header}{text}{hint_section}"


def _build_user_content(text: str, images: Iterable[bytes]) -> list[dict[str, Any]]:
    content: list[dict[str, Any]] = [{"type": "text", "text": text}]
    for image in images:
        encoded = base64.b64encode(image).decode("ascii")
        content.append(
            {
                "type": "image_url",
                "image_url": {"url": f"data:image/png;base64,{encoded}"},
            }
        )
    return content


_JSON_BLOCK = re.compile(r"\{[\s\S]*\}", re.MULTILINE)


def _parse_json(raw: str) -> dict[str, Any]:
    text = (raw or "").strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text.split("\n", 1)[1] if "\n" in text else text
        text = text.rsplit("```", 1)[0]
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = _JSON_BLOCK.search(text)
        if not match:
            raise
        return json.loads(match.group(0))


def _extract_completion_text(payload: dict[str, Any]) -> str:
    choices = payload.get("choices") or []
    if not choices:
        raise RuntimeError(f"MiniMax response missing choices: {payload}")
    message = choices[0].get("message") or {}
    content = message.get("content")
    if isinstance(content, list):
        for part in content:
            if part.get("type") == "text" and part.get("text"):
                return part["text"]
    if isinstance(content, str):
        return content
    raise RuntimeError(f"MiniMax response has unknown content shape: {payload}")


async def extract_references_batch(
    client: MiniMaxClient,
    pasted_text: str,
    locale_policy: str = "en_all",
) -> tuple[list[StructuredCitation], list[int]]:
    """Detect and extract multiple reference entries from a block of pasted text.

    Returns (references, boundaries) where boundaries are character offsets in the
    original text where each reference begins.
    """
    payload = (
        f"The following text contains one or more bibliographic references. "
        f"Identify each one and extract structured metadata.\n\n{pasted_text}"
    )
    content = [{"type": "text", "text": payload}]

    response = await client._chat(
        model=client._model_text,
        messages=[
            {"role": "system", "content": EXTRACTION_BATCH_SYSTEM_PROMPT},
            {"role": "user", "content": content},
        ],
        timeout_override=180.0,  # 3 min for batch detection of many references
    )
    data = _parse_json(response)

    raw_refs = data.get("references", [])
    boundaries: list[int] = data.get("boundaries", [])

    if not isinstance(raw_refs, list):
        raw_refs = []

    structured_list: list[StructuredCitation] = []
    for item in raw_refs:
        if not isinstance(item, dict):
            continue
        try:
            structured_list.append(StructuredCitation.model_validate(item))
        except Exception:
            structured_list.append(
                StructuredCitation(
                    title=item.get("title"),
                    doi=item.get("doi"),
                    year=item.get("year"),
                    authors=[],
                )
            )

    return structured_list, boundaries
