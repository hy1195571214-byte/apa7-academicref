from __future__ import annotations

import asyncio
import logging
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel

from ..core.config import Settings, get_settings
from ..core.deps import build_pipeline, get_job_store
from ..schemas.citation import LocalePolicy
from ..schemas.jobs import JobCreateOptions, JobEvidence, JobRecord, VisionMode
from ..services.ingest import IngestedDocument, ingest
from ..services.ingest import ingest_pasted_text
from ..services.store import JobStore

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/v1/jobs", tags=["jobs"])


class BatchJobsResponse(BaseModel):
    jobs: List[JobRecord]


@router.post("", response_model=JobRecord)
async def create_job(
    request: Request,
    file: Optional[UploadFile] = File(default=None),
    pasted_text: Optional[str] = Form(default=None),
    locale_policy: LocalePolicy = Form(default="en_all"),
    enable_crossref: bool = Form(default=True),
    vision: VisionMode = Form(default="conservative"),
    settings: Settings = Depends(get_settings),
    store: JobStore = Depends(get_job_store),
) -> JobRecord:
    if not file and not pasted_text:
        raise HTTPException(status_code=400, detail="Provide either file or pasted_text")

    options = JobCreateOptions(
        locale_policy=locale_policy,
        enable_crossref=enable_crossref,
        vision=vision,
    )

    if file:
        payload = await file.read()
        document, evidence = _ingest_upload(payload, file.filename, file.content_type, settings)
    else:
        assert pasted_text is not None
        document, evidence = _ingest_paste(pasted_text)

    record = await _enqueue_job(request, store, options, document, evidence)
    return record


@router.post("/batch", response_model=BatchJobsResponse)
async def create_jobs_batch(
    request: Request,
    files: List[UploadFile] = File(...),
    locale_policy: LocalePolicy = Form(default="en_all"),
    enable_crossref: bool = Form(default=True),
    vision: VisionMode = Form(default="conservative"),
    settings: Settings = Depends(get_settings),
    store: JobStore = Depends(get_job_store),
) -> BatchJobsResponse:
    if not files:
        raise HTTPException(status_code=400, detail="Provide at least one file")

    options = JobCreateOptions(
        locale_policy=locale_policy,
        enable_crossref=enable_crossref,
        vision=vision,
    )

    ingested: list[tuple[IngestedDocument, JobEvidence]] = []
    for upload in files:
        payload = await upload.read()
        ingested.append(_ingest_upload(payload, upload.filename, upload.content_type, settings))

    records: list[JobRecord] = []
    for document, evidence in ingested:
        record = await _enqueue_job(request, store, options, document, evidence)
        records.append(record)
    return BatchJobsResponse(jobs=records)


@router.get("/{job_id}", response_model=JobRecord)
async def get_job(job_id: str, store: JobStore = Depends(get_job_store)) -> JobRecord:
    record = await store.get(job_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return record


def _ingest_upload(
    payload: bytes,
    filename: Optional[str],
    content_type: Optional[str],
    settings: Settings,
) -> tuple[IngestedDocument, JobEvidence]:
    if len(payload) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail=f"File {filename or 'upload'} exceeds {settings.max_upload_mb} MB limit",
        )
    try:
        document = ingest(payload, filename or "upload.bin", settings)
    except ValueError as exc:
        raise HTTPException(status_code=415, detail=f"{filename or 'upload'}: {exc}") from exc
    evidence = JobEvidence(
        source="upload",
        filename=filename,
        mime=content_type,
        detected_type=document.detected_type,
        evidence_pages=document.evidence_pages,
        text_preview=document.text[:500] if document.text else None,
    )
    return document, evidence


def _ingest_paste(pasted_text: str) -> tuple[IngestedDocument, JobEvidence]:
    document = ingest_pasted_text(pasted_text)
    evidence = JobEvidence(
        source="pasted_text",
        detected_type=document.detected_type,
        text_preview=document.text[:500],
    )
    return document, evidence


async def _enqueue_job(
    request: Request,
    store: JobStore,
    options: JobCreateOptions,
    document: IngestedDocument,
    evidence: JobEvidence,
) -> JobRecord:
    job_id = uuid.uuid4().hex
    await store.insert(job_id, options)
    await store.update(job_id, evidence=evidence)
    _schedule_job(request, job_id, document, options)
    record = await store.get(job_id)
    if record is None:
        raise HTTPException(status_code=500, detail="Job could not be recorded")
    return record


def _schedule_job(
    request: Request,
    job_id: str,
    document: IngestedDocument,
    options: JobCreateOptions,
) -> None:
    app = request.app
    tasks: set[asyncio.Task[None]] = getattr(app.state, "job_tasks", None) or set()
    app.state.job_tasks = tasks
    semaphore = _loop_semaphore(app)
    task = asyncio.create_task(_run_job(semaphore, job_id, document, options))
    tasks.add(task)
    task.add_done_callback(lambda t: (tasks.discard(t), _log_task_exception(job_id, t)))


def _loop_semaphore(app) -> asyncio.Semaphore:
    """Return a Semaphore bound to the currently running event loop.

    Caching on ``app.state`` avoids reallocating, but Semaphores are tied to
    the loop that created them, so we re-create when the loop changes (e.g.
    across TestClient instances).
    """

    loop = asyncio.get_running_loop()
    cached = getattr(app.state, "job_semaphore", None)
    cached_loop = getattr(app.state, "job_semaphore_loop", None)
    if cached is not None and cached_loop is loop:
        return cached
    settings = get_settings()
    semaphore = asyncio.Semaphore(max(1, settings.max_concurrent_jobs))
    app.state.job_semaphore = semaphore
    app.state.job_semaphore_loop = loop
    # drop stale task references from previous loops so they are not awaited
    app.state.job_tasks = set()
    return semaphore


def _log_task_exception(job_id: str, task: asyncio.Task[None]) -> None:
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        logger.exception("Background job %s crashed", job_id, exc_info=exc)


async def _run_job(
    semaphore: asyncio.Semaphore,
    job_id: str,
    document: IngestedDocument,
    options: JobCreateOptions,
) -> None:
    store = get_job_store()
    async with semaphore:
        await store.update(job_id, status="running")
        try:
            use_vision = options.vision != "off" and bool(document.candidate_images)
            pipeline = build_pipeline()
            result = await pipeline.run_from_document(
                document,
                locale_policy=options.locale_policy,
                enable_crossref=options.enable_crossref,
                use_vision=use_vision,
            )
            await store.update(job_id, status="succeeded", result=result)
        except Exception as exc:  # noqa: BLE001
            logger.exception("Job %s failed", job_id)
            await store.update(job_id, status="failed", error=str(exc))
