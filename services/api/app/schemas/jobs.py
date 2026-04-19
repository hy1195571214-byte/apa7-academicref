from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field

from .citation import CitationResult, LocalePolicy

JobStatus = Literal["queued", "running", "succeeded", "failed"]
VisionMode = Literal["off", "conservative", "aggressive"]


class JobCreateOptions(BaseModel):
    locale_policy: LocalePolicy = "en_all"
    enable_crossref: bool = True
    vision: VisionMode = "conservative"


class JobEvidence(BaseModel):
    source: Literal["upload", "pasted_text"] = "upload"
    filename: Optional[str] = None
    mime: Optional[str] = None
    detected_type: Optional[str] = None
    evidence_pages: List[int] = Field(default_factory=list)
    text_preview: Optional[str] = None


class JobRecord(BaseModel):
    id: str
    status: JobStatus
    created_at: datetime
    updated_at: datetime
    options: JobCreateOptions
    evidence: Optional[JobEvidence] = None
    result: Optional[CitationResult] = None
    error: Optional[str] = None
