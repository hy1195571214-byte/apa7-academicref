from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException

from ..core.deps import build_pipeline
from ..schemas.citation import CitationResult, RenderRequest
from ..services.pipeline import CitationPipeline

router = APIRouter(prefix="/v1", tags=["render"])


@router.post("/render", response_model=CitationResult)
async def render_citation(
    payload: RenderRequest = Body(...),
    pipeline: CitationPipeline = Depends(build_pipeline),
) -> CitationResult:
    try:
        return await pipeline.render_only(
            payload.structured,
            locale_policy=payload.locale_policy,
            enable_crossref=payload.enable_crossref,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
