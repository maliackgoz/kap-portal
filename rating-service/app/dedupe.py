from __future__ import annotations

import hashlib
from typing import Any

from pydantic import BaseModel


def deterministic_rating_id(record: Any) -> str:
    row = _as_dict(record)
    parts = [
        row.get("source_agency"),
        row.get("company_name_normalized"),
        row.get("rating_date"),
        row.get("long_term_rating_raw"),
        row.get("short_term_rating_raw"),
        row.get("national_rating_raw"),
        row.get("provider_status"),
    ]
    return "rating_" + _hash_parts(parts)


def deterministic_news_id(record: Any) -> str:
    row = _as_dict(record)
    parts = [
        row.get("source_name"),
        row.get("company_name_normalized"),
        row.get("title"),
        row.get("url"),
    ]
    return "news_" + _hash_parts(parts)


def with_rating_id(record: Any) -> Any:
    if isinstance(record, BaseModel):
        return record.model_copy(update={"id": record.id or deterministic_rating_id(record)})
    row = dict(record)
    row["id"] = row.get("id") or deterministic_rating_id(row)
    return row


def with_news_id(record: Any) -> Any:
    if isinstance(record, BaseModel):
        return record.model_copy(update={"id": record.id or deterministic_news_id(record)})
    row = dict(record)
    row["id"] = row.get("id") or deterministic_news_id(row)
    return row


def dedupe_records(records: list[Any], key: str = "id") -> list[Any]:
    seen: set[str] = set()
    deduped: list[Any] = []
    for record in records:
        row = _as_dict(record)
        value = str(row.get(key, ""))
        if not value or value in seen:
            continue
        seen.add(value)
        deduped.append(record)
    return deduped


def _hash_parts(parts: list[Any]) -> str:
    material = "|".join("" if part is None else str(part).strip().lower() for part in parts)
    return hashlib.sha256(material.encode("utf-8")).hexdigest()[:24]


def _as_dict(record: Any) -> dict[str, Any]:
    if isinstance(record, BaseModel):
        return record.model_dump(mode="json")
    return dict(record)
