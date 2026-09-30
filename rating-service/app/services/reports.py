from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from ..config import get_settings
from ..normalizer import is_same_company, normalize_text_key
from .news import load_news_records, news_rows
from .ratings import filter_ratings, table_rows


def search_rating_documents(
    query: str,
    company_name: str | None = None,
    agency: str | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    query_key = normalize_text_key(query)
    rating_matches = []
    for record in filter_ratings(company=company_name, agency=agency):
        text = normalize_text_key(
            " ".join(str(value or "") for value in record.model_dump(mode="json").values())
        )
        if query_key in text:
            rating_matches.append(record)

    news_matches = []
    for record in load_news_records():
        if company_name and not (
            record.company_name_normalized
            and is_same_company(record.company_name_normalized, company_name)
        ):
            text = normalize_text_key(f"{record.title} {record.summary or ''}")
            if normalize_text_key(company_name) not in text:
                continue
        text = normalize_text_key(f"{record.title} {record.summary or ''}")
        if query_key in text:
            news_matches.append(record)

    file_matches = _search_files(query_key, company_name=company_name, agency=agency, limit=limit)
    return {
        "summary": (
            f"Aramada {len(rating_matches)} rating, {len(news_matches)} haber, "
            f"{len(file_matches)} dosya eşleşmesi bulundu."
        ),
        "data": {
            "ratings": table_rows(rating_matches[:limit]),
            "news": news_rows(news_matches[:limit]),
            "documents": file_matches[:limit],
        },
        "missing": not (rating_matches or news_matches or file_matches),
        "stale": False,
        "source_errors": [],
    }


def _search_files(
    query_key: str,
    *,
    company_name: str | None,
    agency: str | None,
    limit: int,
) -> list[dict[str, Any]]:
    settings = get_settings()
    roots = [settings.raw_dir, settings.pdf_dir]
    matches: list[dict[str, Any]] = []
    agency_key = normalize_text_key(agency)
    company_key = normalize_text_key(company_name)
    allowed_suffixes = {".html", ".htm", ".txt", ".md", ".csv", ".xml"}
    for root in roots:
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if len(matches) >= limit:
                return matches
            if not path.is_file() or path.suffix.lower() not in allowed_suffixes:
                continue
            if agency_key and agency_key not in normalize_text_key(str(path)):
                continue
            try:
                content = path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            normalized = normalize_text_key(content)
            if company_key and company_key not in normalized:
                continue
            index = normalized.find(query_key)
            if index == -1:
                continue
            matches.append(
                {
                    "path": str(path),
                    "snippet": _snippet(content, query_key),
                    "source_hint": _source_hint(path),
                }
            )
    return matches


def _snippet(content: str, query_key: str, size: int = 260) -> str:
    compact = re.sub(r"\s+", " ", content).strip()
    normalized = normalize_text_key(compact)
    index = normalized.find(query_key)
    if index == -1:
        return compact[:size]
    start = max(0, index - size // 2)
    end = min(len(compact), start + size)
    return compact[start:end]


def _source_hint(path: Path) -> str:
    try:
        return path.parts[-2]
    except IndexError:
        return "unknown"
