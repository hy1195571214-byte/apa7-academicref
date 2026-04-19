"""DOI lookup + merge into StructuredCitation."""

from __future__ import annotations

import logging
from typing import Optional

import httpx

from ..core.config import Settings
from ..schemas.citation import Author, StructuredCitation

logger = logging.getLogger(__name__)


CROSSREF_BASE = "https://api.crossref.org/works/"


class CrossrefClient:
    def __init__(self, settings: Settings) -> None:
        self._mailto = settings.crossref_mailto
        self._timeout = settings.request_timeout_seconds

    async def fetch(self, doi: str) -> Optional[dict]:
        params = {}
        if self._mailto:
            params["mailto"] = self._mailto
        url = f"{CROSSREF_BASE}{doi.strip()}"
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.get(url, params=params, headers={
                    "User-Agent": f"apa7-formatter (mailto:{self._mailto or 'unknown'})",
                })
            if response.status_code != 200:
                logger.info("Crossref miss for %s (status=%s)", doi, response.status_code)
                return None
            payload = response.json()
            return payload.get("message")
        except httpx.HTTPError as exc:
            logger.warning("Crossref request failed for %s: %s", doi, exc)
            return None


def merge_crossref_into(citation: StructuredCitation, message: dict) -> StructuredCitation:
    """Prefer Crossref for hard fields (DOI, year, volume, issue, pages)."""

    citation = citation.model_copy(deep=True)

    crossref_authors = _extract_authors(message.get("author"))
    if crossref_authors:
        citation.authors = crossref_authors

    editors = _extract_authors(message.get("editor"))
    if editors:
        citation.editors = editors

    year = _extract_year(message)
    if year is not None:
        citation.year = year

    title = _first(message.get("title"))
    if title and not citation.title_english:
        citation.title_english = title
    if title and not citation.title:
        citation.title = title

    container = _first(message.get("container-title"))
    if container:
        citation.container_title_english = container
        if not citation.container_title:
            citation.container_title = container

    if message.get("volume"):
        citation.volume = str(message.get("volume"))
    if message.get("issue"):
        citation.issue = str(message.get("issue"))
    if message.get("page"):
        citation.pages = str(message.get("page"))

    if not citation.publisher and message.get("publisher"):
        citation.publisher = str(message.get("publisher"))
    if not citation.publisher_place and message.get("publisher-location"):
        citation.publisher_place = str(message.get("publisher-location"))

    if message.get("DOI"):
        citation.doi = str(message.get("DOI"))
    if message.get("URL") and not citation.url:
        citation.url = str(message.get("URL"))

    work_type = (message.get("type") or "").lower()
    if work_type in {"journal-article", "article-journal"}:
        citation.work_type = "journal_article"
    elif work_type in {"book"}:
        citation.work_type = "book"
    elif work_type in {"book-chapter"}:
        citation.work_type = "book_chapter"

    return citation


def _extract_authors(entries) -> list[Author]:
    if not entries:
        return []
    authors: list[Author] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        if entry.get("name"):
            authors.append(Author(literal=entry["name"], is_organization=True))
            continue
        family = entry.get("family")
        given = entry.get("given")
        if family or given:
            authors.append(Author(family=family, given=given))
    return authors


def _extract_year(message: dict) -> Optional[int]:
    for key in ("issued", "published-print", "published-online", "created"):
        container = message.get(key)
        if not container:
            continue
        parts = container.get("date-parts") if isinstance(container, dict) else None
        if not parts:
            continue
        try:
            return int(parts[0][0])
        except (IndexError, TypeError, ValueError):
            continue
    return None


def _first(value):
    if isinstance(value, list) and value:
        return value[0]
    if isinstance(value, str):
        return value
    return None
