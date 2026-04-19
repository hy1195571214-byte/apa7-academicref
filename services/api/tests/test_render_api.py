import os

from fastapi.testclient import TestClient

from app.core import deps
from app.main import app
from app.schemas.citation import StructuredCitation
from app.services.pipeline import CitationPipeline


class _StubMiniMax:
    async def render_apa(self, *, structured: StructuredCitation, locale_policy: str) -> dict[str, str]:
        title = structured.title_english or structured.title or ""
        container = structured.container_title_english or structured.container_title or ""
        author = structured.authors[0] if structured.authors else None
        name = (
            author.literal
            if author and author.literal
            else (author.family if author else "Anon")
        )
        year = structured.year or "n.d."
        plain = f"{name} ({year}). {title}. {container}".strip().rstrip(".")
        return {
            "reference_plain": plain + ".",
            "reference_html": plain + ".",
            "in_text_parenthetical": f"({name}, {year})",
            "in_text_narrative": f"{name} ({year})",
        }


class _StubCrossref:
    async def fetch(self, doi: str):  # pragma: no cover - not exercised in these tests
        return None


def _client(tmp_path) -> TestClient:
    os.environ["DATA_DIR"] = str(tmp_path)

    def _build_pipeline() -> CitationPipeline:
        from app.core.config import get_settings

        get_settings.cache_clear()  # type: ignore[attr-defined]
        settings = get_settings()
        return CitationPipeline(settings=settings, minimax=_StubMiniMax(), crossref=_StubCrossref())

    app.dependency_overrides[deps.build_pipeline] = _build_pipeline
    return TestClient(app)


def test_render_journal_article(tmp_path):
    client = _client(tmp_path)
    body = {
        "structured": {
            "work_type": "journal_article",
            "authors": [{"family": "Smith", "given": "A."}],
            "year": 2021,
            "title_english": "On the nature of things",
            "container_title_english": "Nature",
            "volume": "590",
            "pages": "12-20",
        },
        "locale_policy": "en_all",
        "enable_crossref": False,
    }
    response = client.post("/v1/render", json=body)
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["structured"]["work_type"] == "journal_article"
    assert "Smith" in payload["rendered"]["reference_plain"]
    assert "(Smith, 2021)" == payload["rendered"]["in_text_parenthetical"]


def test_render_book_chapter_and_webpage_and_book(tmp_path):
    client = _client(tmp_path)
    cases = [
        {
            "work_type": "book",
            "authors": [{"family": "Doe", "given": "J."}],
            "year": 2019,
            "title_english": "Handbook",
            "publisher": "Routledge",
        },
        {
            "work_type": "book_chapter",
            "authors": [{"family": "Doe", "given": "J."}],
            "year": 2019,
            "title_english": "A chapter",
            "container_title_english": "Handbook",
            "publisher": "Routledge",
        },
        {
            "work_type": "webpage",
            "authors": [{"literal": "WHO", "is_organization": True}],
            "year": 2024,
            "title_english": "Guideline",
            "url": "https://who.int/guideline",
        },
    ]
    for structured in cases:
        response = client.post(
            "/v1/render",
            json={"structured": structured, "locale_policy": "en_all", "enable_crossref": False},
        )
        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["structured"]["work_type"] == structured["work_type"]
        assert payload["rendered"]["reference_plain"]
