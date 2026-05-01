from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, Form, HTTPException
from pydantic import BaseModel

from ..core.config import Settings, get_settings
from ..schemas.citation import LocalePolicy, StructuredCitation
from ..services.minimax import MiniMaxClient, extract_references_batch

router = APIRouter(prefix="/v1/references", tags=["references"])


class DetectReferencesResponse(BaseModel):
    references: List[StructuredCitation]
    boundaries: List[int]  # character offsets in original text


@router.post("/detect", response_model=DetectReferencesResponse)
async def detect_references(
    pasted_text: str = Form(...),
    locale_policy: LocalePolicy = Form(default="en_all"),
    settings: Settings = Depends(get_settings),
) -> DetectReferencesResponse:
    if not pasted_text.strip():
        raise HTTPException(status_code=400, detail="pasted_text cannot be empty")

    client = MiniMaxClient(settings)
    if not client.configured:
        raise HTTPException(status_code=503, detail="MiniMax API key not configured")

    references, boundaries = await extract_references_batch(
        client,
        pasted_text,
        locale_policy=locale_policy,
    )

    return DetectReferencesResponse(references=references, boundaries=boundaries)
