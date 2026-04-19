"""Compose ingest -> Crossref -> MiniMax into a single citation result."""

from __future__ import annotations

import logging
from typing import Optional

from ..core.config import Settings
from ..schemas.citation import (
    CitationResult,
    LocalePolicy,
    RenderedCitation,
    StructuredCitation,
)
from .crossref import CrossrefClient, merge_crossref_into
from .ingest import IngestedDocument
from .minimax import MiniMaxClient

logger = logging.getLogger(__name__)


class CitationPipeline:
    def __init__(
        self,
        *,
        settings: Settings,
        minimax: MiniMaxClient,
        crossref: CrossrefClient,
    ) -> None:
        self._settings = settings
        self._minimax = minimax
        self._crossref = crossref

    async def run_from_document(
        self,
        document: IngestedDocument,
        *,
        locale_policy: LocalePolicy,
        enable_crossref: bool,
        use_vision: bool,
    ) -> CitationResult:
        hints = {
            "detected_type": document.detected_type,
            "dois_detected": document.dois,
            "locale_policy": locale_policy,
        }
        images = document.candidate_images if use_vision else []
        structured = await self._minimax.extract_structured(
            text=document.text or "",
            images=images,
            hints=hints,
        )
        if not structured.doi and document.dois:
            structured.doi = document.dois[0]

        crossref_used = False
        if enable_crossref and structured.doi:
            message = await self._crossref.fetch(structured.doi)
            if message:
                structured = merge_crossref_into(structured, message)
                crossref_used = True

        rendered = await self._render(structured, locale_policy)
        return CitationResult(
            structured=structured,
            rendered=rendered,
            locale_policy=locale_policy,
            crossref_used=crossref_used,
        )

    async def render_only(
        self,
        structured: StructuredCitation,
        *,
        locale_policy: LocalePolicy,
        enable_crossref: bool,
    ) -> CitationResult:
        crossref_used = False
        if enable_crossref and structured.doi:
            message = await self._crossref.fetch(structured.doi)
            if message:
                structured = merge_crossref_into(structured, message)
                crossref_used = True
        rendered = await self._render(structured, locale_policy)
        return CitationResult(
            structured=structured,
            rendered=rendered,
            locale_policy=locale_policy,
            crossref_used=crossref_used,
        )

    async def _render(
        self,
        structured: StructuredCitation,
        locale_policy: LocalePolicy,
    ) -> RenderedCitation:
        data = await self._minimax.render_apa(
            structured=structured,
            locale_policy=locale_policy,
        )
        return RenderedCitation(
            reference_plain=data["reference_plain"],
            reference_html=data["reference_html"] or _wrap_italics(data["reference_plain"], structured),
            in_text_parenthetical=data["in_text_parenthetical"],
            in_text_narrative=data["in_text_narrative"],
        )


def _wrap_italics(plain: str, structured: StructuredCitation) -> str:
    """Fallback: if model only returned plain text, best-effort italicise the container title."""

    container = structured.container_title_english or structured.container_title
    if container and container in plain:
        return plain.replace(container, f"<em>{container}</em>", 1)
    return plain
