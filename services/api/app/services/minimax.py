"""MiniMax client: two-phase extraction (JSON) and APA7 rendering."""

from __future__ import annotations

import base64
import json
import logging
import re
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

logger = logging.getLogger(__name__)


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

    async def _chat(self, *, model: str, messages: list[dict[str, Any]]) -> str:
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

        try:
            async for attempt in AsyncRetrying(
                reraise=True,
                stop=stop_after_attempt(3),
                wait=wait_exponential(multiplier=0.8, min=0.8, max=6),
                retry=retry_if_exception_type((httpx.TransportError, httpx.RemoteProtocolError)),
            ):
                with attempt:
                    async with httpx.AsyncClient(timeout=self._timeout) as client:
                        response = await client.post(url, json=body, headers=headers)
                    if response.status_code >= 500:
                        raise httpx.RemoteProtocolError("upstream 5xx")
                    response.raise_for_status()
                    return _extract_completion_text(response.json())
        except RetryError as exc:  # pragma: no cover - defensive
            raise RuntimeError("MiniMax retries exhausted") from exc
        raise RuntimeError("MiniMax returned no response")


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
