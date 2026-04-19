"""Regression: LLM JSON may use null for list-shaped fields."""

import json

import pytest

from app.schemas.citation import StructuredCitation
from app.services.minimax import MiniMaxClient


def test_structured_citation_coerces_null_lists() -> None:
    data = {
        "work_type": "journal_article",
        "title": "T",
        "title_english": "T",
        "authors": None,
        "editors": None,
        "missing_fields": None,
    }
    s = StructuredCitation.model_validate(data)
    assert s.authors == []
    assert s.editors == []
    assert s.missing_fields == []


@pytest.mark.asyncio
async def test_extract_structured_null_lists_from_llm_json(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.core.config import Settings

    async def fake_chat(self, *, model, messages):  # noqa: ANN001
        return json.dumps(
            {
                "work_type": "journal_article",
                "title": "Music",
                "title_english": "Music",
                "authors": None,
                "editors": None,
                "missing_fields": None,
            }
        )

    monkeypatch.setattr(MiniMaxClient, "_chat", fake_chat)
    client = MiniMaxClient(Settings(minimax_api_key="dummy"))
    structured = await client.extract_structured(text="x", images=None, hints=None)
    assert structured.editors == []
    assert structured.authors == []
    assert structured.missing_fields == []
