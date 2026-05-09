from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from pathlib import Path
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


async def summarise_ingested(
    document: IngestedDocument,
    *,
    output_language: SummaryLanguage,
    vision: VisionMode,
    minimax: MiniMaxClient,
) -> LiteratureSummary:
    run_id = f"summary_{int(time.time() * 1000)}"
    use_vision = vision != "off" and bool(document.candidate_images)
    text_is_thin = len((document.text or "").strip()) < 200
    images = document.candidate_images if (use_vision and text_is_thin) else []
    _debug_log(
        run_id=run_id,
        hypothesis_id="H2_H3",
        location="routes/summary.py:summarise_ingested",
        message="Prepared summary payload",
        data={
            "text_length": len(document.text or ""),
            "candidate_images": len(document.candidate_images or []),
            "selected_images": len(images or []),
            "vision": vision,
            "text_is_thin": text_is_thin,
            "use_vision": use_vision,
        },
    )

    if not document.text and not images:
        _debug_log(
            run_id=run_id,
            hypothesis_id="H4",
            location="routes/summary.py:summarise_ingested",
            message="Rejected due to no text and no images",
            data={},
        )
        raise HTTPException(
            status_code=422,
            detail="No readable text was extracted; try enabling vision or pasting the text directly.",
        )

    try:
        summary = await minimax.summarize(
            text=document.text or "",
            images=images or None,
            language=output_language,
        )
        _debug_log(
            run_id=run_id,
            hypothesis_id="H2_H3",
            location="routes/summary.py:summarise_ingested",
            message="MiniMax summary call succeeded",
            data={
                "key_claims_count": len(summary.key_claims),
                "keywords_count": len(summary.keywords),
                "topic_tags_count": len(summary.topic_tags),
            },
        )
        return summary
    except RuntimeError as exc:
        _debug_log(
            run_id=run_id,
            hypothesis_id="H1",
            location="routes/summary.py:summarise_ingested",
            message="MiniMax runtime error",
            data={"error_type": type(exc).__name__, "error": str(exc)},
        )
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        _debug_log(
            run_id=run_id,
            hypothesis_id="H1_H2_H3",
            location="routes/summary.py:summarise_ingested",
            message="Unhandled summary exception",
            data={"error_type": type(exc).__name__, "error": str(exc)},
        )
        raise


@router.post("/summary", response_model=LiteratureSummary)
async def summarise_document(
    file: Optional[UploadFile] = File(default=None),
    pasted_text: Optional[str] = Form(default=None),
    output_language: SummaryLanguage = Form(default="zh"),
    vision: VisionMode = Form(default="conservative"),
    settings: Settings = Depends(get_settings),
    minimax: MiniMaxClient = Depends(get_minimax_client),
) -> LiteratureSummary:
    request_run_id = f"summary_req_{int(time.time() * 1000)}"
    _debug_log(
        run_id=request_run_id,
        hypothesis_id="H4",
        location="routes/summary.py:summarise_document",
        message="Summary request received",
        data={"has_file": bool(file), "has_pasted_text": bool(pasted_text), "vision": vision},
    )
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
            _debug_log(
                run_id=request_run_id,
                hypothesis_id="H4",
                location="routes/summary.py:summarise_document",
                message="File ingest succeeded",
                data={"filename": file.filename or "upload.bin", "payload_size": len(payload)},
            )
        except ValueError as exc:
            _debug_log(
                run_id=request_run_id,
                hypothesis_id="H4",
                location="routes/summary.py:summarise_document",
                message="File ingest value error",
                data={"error_type": type(exc).__name__, "error": str(exc)},
            )
            raise HTTPException(status_code=415, detail=str(exc)) from exc
        except Exception as exc:  # noqa: BLE001
            _debug_log(
                run_id=request_run_id,
                hypothesis_id="H4",
                location="routes/summary.py:summarise_document",
                message="File ingest unexpected error",
                data={"error_type": type(exc).__name__, "error": str(exc)},
            )
            raise
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
