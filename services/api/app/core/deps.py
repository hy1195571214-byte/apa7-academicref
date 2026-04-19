from __future__ import annotations

from functools import lru_cache

from .config import get_settings
from ..services.crossref import CrossrefClient
from ..services.minimax import MiniMaxClient
from ..services.pipeline import CitationPipeline
from ..services.store import JobStore


@lru_cache
def get_job_store() -> JobStore:
    return JobStore(get_settings())


@lru_cache
def get_minimax_client() -> MiniMaxClient:
    return MiniMaxClient(get_settings())


@lru_cache
def get_crossref_client() -> CrossrefClient:
    return CrossrefClient(get_settings())


def build_pipeline() -> CitationPipeline:
    return CitationPipeline(
        settings=get_settings(),
        minimax=get_minimax_client(),
        crossref=get_crossref_client(),
    )
