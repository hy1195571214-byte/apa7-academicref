"""Tiny async SQLite store for job records."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Optional

import aiosqlite

from ..core.config import Settings
from ..schemas.jobs import JobEvidence, JobRecord, JobStatus
from ..schemas.citation import CitationResult
from ..schemas.jobs import JobCreateOptions


CREATE_SQL = """
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    options_json TEXT NOT NULL,
    evidence_json TEXT,
    result_json TEXT,
    error TEXT
);
"""


class JobStore:
    def __init__(self, settings: Settings) -> None:
        self._db_path = str(settings.sqlite_path)

    async def init(self) -> None:
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute("PRAGMA journal_mode=WAL")
            await db.execute("PRAGMA busy_timeout=5000")
            await db.execute(CREATE_SQL)
            await db.commit()

    async def insert(self, job_id: str, options: JobCreateOptions) -> JobRecord:
        now = datetime.now(timezone.utc)
        record = JobRecord(
            id=job_id,
            status="queued",
            created_at=now,
            updated_at=now,
            options=options,
        )
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute("PRAGMA busy_timeout=5000")
            await db.execute(
                "INSERT INTO jobs (id, status, created_at, updated_at, options_json) VALUES (?, ?, ?, ?, ?)",
                (
                    record.id,
                    record.status,
                    record.created_at.isoformat(),
                    record.updated_at.isoformat(),
                    record.options.model_dump_json(),
                ),
            )
            await db.commit()
        return record

    async def update(
        self,
        job_id: str,
        *,
        status: Optional[JobStatus] = None,
        evidence: Optional[JobEvidence] = None,
        result: Optional[CitationResult] = None,
        error: Optional[str] = None,
    ) -> None:
        fields: list[str] = []
        values: list[object] = []
        if status is not None:
            fields.append("status = ?")
            values.append(status)
        if evidence is not None:
            fields.append("evidence_json = ?")
            values.append(evidence.model_dump_json())
        if result is not None:
            fields.append("result_json = ?")
            values.append(result.model_dump_json())
        if error is not None:
            fields.append("error = ?")
            values.append(error)
        fields.append("updated_at = ?")
        values.append(datetime.now(timezone.utc).isoformat())
        values.append(job_id)
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute("PRAGMA busy_timeout=5000")
            await db.execute(
                f"UPDATE jobs SET {', '.join(fields)} WHERE id = ?",
                values,
            )
            await db.commit()

    async def get(self, job_id: str) -> Optional[JobRecord]:
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute("PRAGMA busy_timeout=5000")
            async with db.execute(
                "SELECT id, status, created_at, updated_at, options_json, evidence_json, result_json, error FROM jobs WHERE id = ?",
                (job_id,),
            ) as cursor:
                row = await cursor.fetchone()
        if row is None:
            return None
        (id_, status, created_at, updated_at, options_json, evidence_json, result_json, error) = row
        return JobRecord(
            id=id_,
            status=status,
            created_at=datetime.fromisoformat(created_at),
            updated_at=datetime.fromisoformat(updated_at),
            options=JobCreateOptions.model_validate(json.loads(options_json)),
            evidence=JobEvidence.model_validate(json.loads(evidence_json)) if evidence_json else None,
            result=CitationResult.model_validate(json.loads(result_json)) if result_json else None,
            error=error,
        )
