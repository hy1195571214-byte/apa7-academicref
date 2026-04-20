from __future__ import annotations

from typing import Any, List, Literal, Optional

from pydantic import BaseModel, Field, model_validator

SummaryLanguage = Literal["zh", "en"]


class LiteratureSummary(BaseModel):
    """Structured summary of an academic work."""

    title_guess: Optional[str] = None
    key_claims: List[str] = Field(default_factory=list)
    keywords: List[str] = Field(default_factory=list)
    topic_tags: List[str] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _coerce_null_list_fields(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        for key in ("key_claims", "keywords", "topic_tags"):
            if data.get(key) is None:
                data[key] = []
        return data


class SummaryBatchItem(BaseModel):
    """Single result within a batch summarisation response."""

    filename: str
    summary: Optional[LiteratureSummary] = None
    error: Optional[str] = None


class SummaryBatchResponse(BaseModel):
    items: List[SummaryBatchItem] = Field(default_factory=list)
