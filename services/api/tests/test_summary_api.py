"""Acceptance tests for POST /v1/summary and /v1/summary/batch."""

from __future__ import annotations

import json
import os
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.main import app
from app.schemas.summary import LiteratureSummary
from app.services.minimax import MiniMaxClient


def _png_bytes() -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (4, 4), (255, 255, 255)).save(buffer, format="PNG")
    return buffer.getvalue()


@pytest.fixture
def client(tmp_path, monkeypatch) -> TestClient:
    os.environ["DATA_DIR"] = str(tmp_path)
    os.environ["MINIMAX_API_KEY"] = "stub-key"

    from app.core.config import get_settings
    from app.core.deps import get_job_store, get_minimax_client

    get_settings.cache_clear()  # type: ignore[attr-defined]
    get_job_store.cache_clear()  # type: ignore[attr-defined]
    get_minimax_client.cache_clear()  # type: ignore[attr-defined]

    async def fake_chat(self, *, model, messages):  # noqa: ANN001
        return json.dumps(
            {
                "title_guess": "Stub Title",
                "key_claims": ["论点一", "论点二", "论点三"],
                "keywords": ["学习", "动机"],
                "topic_tags": ["教育学"],
            }
        )

    monkeypatch.setattr(MiniMaxClient, "_chat", fake_chat)
    return TestClient(app)


def test_summary_from_pasted_text(client: TestClient) -> None:
    response = client.post(
        "/v1/summary",
        data={
            "pasted_text": "这是一段足够长的中文摘要示例，用于测试概要接口。" * 10,
            "output_language": "zh",
            "vision": "off",
        },
    )
    assert response.status_code == 200, response.text
    data = response.json()
    summary = LiteratureSummary.model_validate(data)
    assert summary.title_guess == "Stub Title"
    assert len(summary.key_claims) == 3
    assert summary.topic_tags == ["教育学"]


def test_summary_rejects_empty_request(client: TestClient) -> None:
    response = client.post("/v1/summary", data={"output_language": "zh", "vision": "off"})
    assert response.status_code == 400


def test_summary_coerces_null_lists(client: TestClient, monkeypatch) -> None:
    async def fake_chat(self, *, model, messages):  # noqa: ANN001
        return json.dumps(
            {
                "title_guess": None,
                "key_claims": None,
                "keywords": None,
                "topic_tags": None,
            }
        )

    monkeypatch.setattr(MiniMaxClient, "_chat", fake_chat)
    response = client.post(
        "/v1/summary",
        data={
            "pasted_text": "足够长的正文用于走到模型调用。" * 20,
            "output_language": "zh",
            "vision": "off",
        },
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["key_claims"] == []
    assert data["keywords"] == []
    assert data["topic_tags"] == []


def test_summary_batch_processes_multiple_files(client: TestClient) -> None:
    png = _png_bytes()
    response = client.post(
        "/v1/summary/batch",
        files=[
            ("files", ("a.png", png, "image/png")),
            ("files", ("b.png", png, "image/png")),
            ("files", ("c.png", png, "image/png")),
        ],
        data={"output_language": "zh", "vision": "conservative"},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    items = payload["items"]
    assert len(items) == 3
    assert [item["filename"] for item in items] == ["a.png", "b.png", "c.png"]
    for item in items:
        assert item["error"] is None
        assert item["summary"]["title_guess"] == "Stub Title"


def test_summary_batch_reports_per_item_errors(client: TestClient, monkeypatch) -> None:
    call_count = {"n": 0}

    async def flaky_chat(self, *, model, messages):  # noqa: ANN001
        call_count["n"] += 1
        if call_count["n"] == 2:
            raise RuntimeError("stubbed minimax outage")
        return json.dumps(
            {
                "title_guess": "Stub",
                "key_claims": ["论点"],
                "keywords": ["关键词"],
                "topic_tags": ["标签"],
            }
        )

    monkeypatch.setattr(MiniMaxClient, "_chat", flaky_chat)
    png = _png_bytes()
    response = client.post(
        "/v1/summary/batch",
        files=[
            ("files", ("ok-1.png", png, "image/png")),
            ("files", ("fails.png", png, "image/png")),
            ("files", ("ok-2.png", png, "image/png")),
        ],
        data={"output_language": "zh", "vision": "conservative"},
    )
    assert response.status_code == 200, response.text
    items = response.json()["items"]
    assert len(items) == 3
    failed = [item for item in items if item["error"]]
    succeeded = [item for item in items if item["summary"]]
    assert len(failed) == 1
    assert failed[0]["filename"] == "fails.png"
    assert "stubbed minimax outage" in failed[0]["error"]
    assert len(succeeded) == 2


def test_summary_batch_rejects_empty_files(client: TestClient) -> None:
    response = client.post("/v1/summary/batch", data={"output_language": "zh", "vision": "off"})
    assert response.status_code in (400, 422)
