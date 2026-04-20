from __future__ import annotations

import asyncio
import logging
from typing import Literal, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from ..core.config import Settings, get_settings
from ..core.deps import get_minimax_client
from ..schemas.summary import (
    LiteratureSummary,
    SummaryBatchItem,
    SummaryBatchResponse,
    SummaryLanguage,
)
from ..services.ingest import IngestedDocument, ingest, ingest_pasted_text
from ..services.minimax import MiniMaxClient

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/v1", tags=["summary"])

VisionMode = Literal["off", "conservative"]


async def summarise_ingested(
    document: IngestedDocument,
    *,
    output_language: SummaryLanguage,
    vision: VisionMode,
    minimax: MiniMaxClient,
) -> LiteratureSummary:
    use_vision = vision != "off" and bool(document.candidate_images)
    text_is_thin = len((document.text or "").strip()) < 200
    images = document.candidate_images if (use_vision and text_is_thin) else []

    if not document.text and not images:
        raise HTTPException(
            status_code=422,
            detail="No readable text was extracted; try enabling vision or pasting the text directly.",
        )

    try:
        return await minimax.summarize(
            text=document.text or "",
            images=images or None,
            language=output_language,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/summary", response_model=LiteratureSummary)
async def summarise_document(
    file: Optional[UploadFile] = File(default=None),
    pasted_text: Optional[str] = Form(default=None),
    output_language: SummaryLanguage = Form(default="zh"),
    vision: VisionMode = Form(default="conservative"),
    settings: Settings = Depends(get_settings),
    minimax: MiniMaxClient = Depends(get_minimax_client),
) -> LiteratureSummary:
    if not file and not pasted_text:
        raise HTTPException(status_code=400, detail="Provide either file or pasted_text")

    if file:
        payload = await file.read()
        if len(payload) > settings.max_upload_mb * 1024 * 1024:
            raise HTTPException(
                status_code=413,
                detail=f"File exceeds {settings.max_upload_mb} MB limit",
            )
        try:
            document = ingest(payload, file.filename or "upload.bin", settings)
        except ValueError as exc:
            raise HTTPException(status_code=415, detail=str(exc)) from exc
    else:
        assert pasted_text is not None
        document = ingest_pasted_text(pasted_text)

    return await summarise_ingested(
        document,
        output_language=output_language,
        vision=vision,
        minimax=minimax,
    )


@router.post("/summary/batch", response_model=SummaryBatchResponse)
async def summarise_documents_batch(
    files: list[UploadFile] = File(...),
    output_language: SummaryLanguage = Form(default="zh"),
    vision: VisionMode = Form(default="conservative"),
    settings: Settings = Depends(get_settings),
    minimax: MiniMaxClient = Depends(get_minimax_client),
) -> SummaryBatchResponse:
    if not files:
        raise HTTPException(status_code=400, detail="Provide at least one file")

    prepared: list[tuple[str, Optional[IngestedDocument], Optional[str]]] = []
    for upload in files:
        filename = upload.filename or "upload.bin"
        try:
            payload = await upload.read()
            if len(payload) > settings.max_upload_mb * 1024 * 1024:
                prepared.append((filename, None, f"File exceeds {settings.max_upload_mb} MB limit"))
                continue
            document = ingest(payload, filename, settings)
            prepared.append((filename, document, None))
        except ValueError as exc:
            prepared.append((filename, None, str(exc)))
        except Exception as exc:  # noqa: BLE001
            logger.exception("summary batch ingest failed for %s", filename)
            prepared.append((filename, None, f"Ingest failed: {exc}"))

    semaphore = asyncio.Semaphore(max(1, settings.max_concurrent_jobs))

    async def process(index: int, entry: tuple[str, Optional[IngestedDocument], Optional[str]]) -> SummaryBatchItem:
        filename, document, error = entry
        if document is None:
            return SummaryBatchItem(filename=filename, error=error)
        async with semaphore:
            try:
                summary = await summarise_ingested(
                    document,
                    output_language=output_language,
                    vision=vision,
                    minimax=minimax,
                )
                return SummaryBatchItem(filename=filename, summary=summary)
            except HTTPException as exc:
                return SummaryBatchItem(filename=filename, error=str(exc.detail))
            except Exception as exc:  # noqa: BLE001
                logger.exception("summary batch generation failed for %s", filename)
                return SummaryBatchItem(filename=filename, error=f"Summary failed: {exc}")

    items = await asyncio.gather(*(process(i, entry) for i, entry in enumerate(prepared)))
    return SummaryBatchResponse(items=list(items))
