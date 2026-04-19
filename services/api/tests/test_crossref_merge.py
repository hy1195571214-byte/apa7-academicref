from app.schemas.citation import Author, StructuredCitation
from app.services.crossref import merge_crossref_into


def _base() -> StructuredCitation:
    return StructuredCitation(work_type="journal_article")


def test_merge_overwrites_hard_fields_and_fills_english_title():
    message = {
        "type": "journal-article",
        "title": ["Evolution of climate attribution"],
        "container-title": ["Nature Climate Change"],
        "volume": "11",
        "issue": "3",
        "page": "201-205",
        "issued": {"date-parts": [[2023]]},
        "DOI": "10.1038/example",
        "URL": "https://doi.org/10.1038/example",
        "author": [
            {"given": "Alex", "family": "Kim"},
            {"name": "World Health Organization"},
        ],
    }
    citation = _base()
    citation.title = "评估气候变化归因"
    citation.title_original = "评估气候变化归因"

    merged = merge_crossref_into(citation, message)

    assert merged.work_type == "journal_article"
    assert merged.title_english == "Evolution of climate attribution"
    assert merged.container_title_english == "Nature Climate Change"
    assert merged.volume == "11"
    assert merged.issue == "3"
    assert merged.pages == "201-205"
    assert merged.year == 2023
    assert merged.doi == "10.1038/example"
    assert [a.model_dump() for a in merged.authors] == [
        Author(family="Kim", given="Alex").model_dump(),
        Author(literal="World Health Organization", is_organization=True).model_dump(),
    ]


def test_merge_keeps_user_publisher_when_crossref_missing():
    citation = _base()
    citation.publisher = "Springer"
    merged = merge_crossref_into(citation, {"title": ["x"], "issued": {"date-parts": [[2020]]}})
    assert merged.publisher == "Springer"
