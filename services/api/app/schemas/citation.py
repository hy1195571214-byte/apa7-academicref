from __future__ import annotations

from typing import Any, List, Literal, Optional

from pydantic import BaseModel, Field, model_validator

WorkType = Literal["journal_article", "book", "book_chapter", "webpage"]
LocalePolicy = Literal["en_all", "en_bracket"]


class Author(BaseModel):
    family: Optional[str] = None
    given: Optional[str] = None
    literal: Optional[str] = None
    is_organization: bool = False


class StructuredCitation(BaseModel):
    """Normalised metadata used by both upload and manual-add flows."""

    work_type: WorkType = "journal_article"
    language: Optional[str] = None

    authors: List[Author] = Field(default_factory=list)
    year: Optional[int] = None
    title: Optional[str] = None
    title_original: Optional[str] = None
    title_english: Optional[str] = None

    container_title: Optional[str] = None
    container_title_original: Optional[str] = None
    container_title_english: Optional[str] = None

    volume: Optional[str] = None
    issue: Optional[str] = None
    pages: Optional[str] = None

    publisher: Optional[str] = None
    publisher_place: Optional[str] = None

    editors: List[Author] = Field(default_factory=list)
    edition: Optional[str] = None

    doi: Optional[str] = None
    url: Optional[str] = None
    accessed_date: Optional[str] = None

    notes: Optional[str] = None
    confidence: Optional[float] = None
    missing_fields: List[str] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _coerce_null_list_fields(cls, data: Any) -> Any:
        """LLM JSON often uses null for absent arrays; Pydantic rejects null for List fields."""
        if not isinstance(data, dict):
            return data
        for key in ("authors", "editors", "missing_fields"):
            if data.get(key) is None:
                data[key] = []
        return data


class RenderedCitation(BaseModel):
    reference_plain: str
    reference_html: str
    in_text_parenthetical: str
    in_text_narrative: str


class CitationResult(BaseModel):
    structured: StructuredCitation
    rendered: RenderedCitation
    locale_policy: LocalePolicy = "en_all"
    crossref_used: bool = False


class RenderRequest(BaseModel):
    structured: StructuredCitation
    locale_policy: LocalePolicy = "en_all"
    enable_crossref: bool = True
