"""Acceptance tests for POST /v1/jobs and /v1/jobs/batch parallel execution."""

from __future__ import annotations

import asyncio
import os
from typing import Any

from fastapi.testclient import TestClient
from io import BytesIO

from PIL import Image

from app.main import app
from app.routes import jobs as jobs_module
from app.schemas.citation import CitationResult, RenderedCitation, StructuredCitation


def _png_bytes() -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (4, 4), (255, 255, 255)).save(buffer, format="PNG")
    return buffer.getvalue()


class _StubPipeline:
    """Fake pipeline: sleeps briefly then returns a canned CitationResult."""

    def __init__(self) -> None:
        self.calls: list[str] = []

    async def run_from_document(self, document, *, locale_policy, enable_crossref, use_vision) -> CitationResult:  # noqa: ANN001
        self.calls.append(document.detected_type)
        await asyncio.sleep(0.05)
        return CitationResult(
            structured=StructuredCitation(
                work_type="journal_article",
                title_english="Stub",
            ),
            rendered=RenderedCitation(
                reference_plain="Stub (2024). Stub.",
                reference_html="Stub (2024). Stub.",
                in_text_parenthetical="(Stub, 2024)",
                in_text_narrative="Stub (2024)",
            ),
            locale_policy=locale_policy,
            crossref_used=False,
        )


def _client(tmp_path, monkeypatch) -> tuple[TestClient, _StubPipeline]:
    os.environ["DATA_DIR"] = str(tmp_path)

    from app.core.config import get_settings
    from app.core.deps import get_job_store

    get_settings.cache_clear()  # type: ignore[attr-defined]
    get_job_store.cache_clear()  # type: ignore[attr-defined]

    stub = _StubPipeline()
    monkeypatch.setattr(jobs_module, "build_pipeline", lambda: stub)

    client = TestClient(app)
    return client, stub


def _await_settled(client: TestClient, job_ids: list[str], timeout: float = 5.0) -> list[dict[str, Any]]:
    import time

    deadline = time.monotonic() + timeout
    final: dict[str, dict[str, Any]] = {}
    while time.monotonic() < deadline and len(final) < len(job_ids):
        for job_id in job_ids:
            if job_id in final:
                continue
            response = client.get(f"/v1/jobs/{job_id}")
            assert response.status_code == 200, response.text
            record = response.json()
            if record["status"] in ("succeeded", "failed"):
                final[job_id] = record
        if len(final) < len(job_ids):
            time.sleep(0.05)
    assert len(final) == len(job_ids), f"jobs did not finish in time: {final}"
    return [final[job_id] for job_id in job_ids]


def test_batch_creates_multiple_jobs_and_runs_concurrently(tmp_path, monkeypatch):
    client, stub = _client(tmp_path, monkeypatch)
    with client:
        png = _png_bytes()
        files = [
            ("files", ("one.png", png, "image/png")),
            ("files", ("two.png", png, "image/png")),
            ("files", ("three.png", png, "image/png")),
        ]
        response = client.post(
            "/v1/jobs/batch",
            files=files,
            data={"locale_policy": "en_all", "enable_crossref": "false", "vision": "off"},
        )
        assert response.status_code == 200, response.text
        jobs = response.json()["jobs"]
        assert len(jobs) == 3
        ids = [job["id"] for job in jobs]
        final_records = _await_settled(client, ids)
        assert all(record["status"] == "succeeded" for record in final_records)
        filenames = sorted(record["evidence"]["filename"] for record in final_records)
        assert filenames == ["one.png", "three.png", "two.png"]
        assert len(stub.calls) == 3


def test_single_job_endpoint_still_works(tmp_path, monkeypatch):
    client, _ = _client(tmp_path, monkeypatch)
    with client:
        response = client.post(
            "/v1/jobs",
            files={"file": ("solo.png", _png_bytes(), "image/png")},
            data={"locale_policy": "en_all", "enable_crossref": "false", "vision": "off"},
        )
        assert response.status_code == 200, response.text
        job = response.json()
        [record] = _await_settled(client, [job["id"]])
        assert record["status"] == "succeeded"
        assert record["result"]["rendered"]["reference_plain"].startswith("Stub")


def test_batch_rejects_empty_request(tmp_path, monkeypatch):
    client, _ = _client(tmp_path, monkeypatch)
    with client:
        response = client.post(
            "/v1/jobs/batch",
            data={"locale_policy": "en_all", "enable_crossref": "false", "vision": "off"},
        )
        # FastAPI reports missing required file list as 422
        assert response.status_code in (400, 422)
