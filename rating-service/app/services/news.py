from __future__ import annotations

from copy import deepcopy
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import quote_plus

from ..config import get_settings, load_sources_config
from ..dedupe import dedupe_records, with_news_id
from ..models import NewsRecord
from ..normalizer import is_same_company, normalize_text_key
from ..scrapers.news import NewsScraper
from ..storage import append_jsonl, read_jsonl, upsert_jsonl


def refresh_news_sources(source_keys: list[str] | None = None) -> dict[str, Any]:
    settings = get_settings()
    config = load_sources_config(settings)
    news_sources = config.get("news_sources", {}) or {}
    if source_keys:
        selected = {source.lower() for source in source_keys}
        news_sources = {
            key: value for key, value in news_sources.items() if key.lower() in selected
        }
    scraper = NewsScraper(sources_config=news_sources, settings=settings)
    records, log = scraper.run()
    if source_keys and len(source_keys) == 1:
        log.source = source_keys[0]
    if records:
        result = upsert_jsonl(settings.news_path, records)
        log.records_added = result["added"]
        log.records_updated = result["updated"]
    append_jsonl(settings.run_log_path, log)
    return {
        "source": log.source,
        "status": log.status,
        "records_found": log.records_found,
        "records_added": log.records_added,
        "records_updated": log.records_updated,
        "started_at": log.started_at.isoformat(),
        "finished_at": log.finished_at.isoformat() if log.finished_at else None,
        "errors": log.errors,
    }


def load_news_records() -> list[NewsRecord]:
    return [NewsRecord.model_validate(row) for row in read_jsonl(get_settings().news_path)]


def filter_news(
    *,
    company: str | None = None,
    source: str | None = None,
    days: int | None = None,
    risk_level: str | None = None,
) -> list[NewsRecord]:
    records = load_news_records()
    source_key = normalize_text_key(source)
    risk_key = normalize_text_key(risk_level)
    cutoff = datetime.now(UTC) - timedelta(days=days or 36500)

    filtered = []
    for record in records:
        if source and normalize_text_key(record.source_name) != source_key:
            continue
        if risk_level and normalize_text_key(record.risk_level) != risk_key:
            continue
        effective_date = record.published_at or record.extracted_at
        if days and effective_date < cutoff:
            continue
        if company and not _news_matches_company(record, company):
            continue
        filtered.append(record)
    filtered.sort(
        key=lambda item: item.published_at or item.extracted_at,
        reverse=True,
    )
    return filtered


def search_live_news(
    *,
    query: str,
    sources: list[str] | None = None,
    limit: int = 80,
) -> dict[str, Any]:
    query_key = normalize_text_key(query)
    if not query_key:
        return {
            "summary": "Canli haber aramasi icin konu veya baslik yazilmali.",
            "data": [],
            "missing": True,
            "stale": False,
            "source_errors": [],
        }

    settings = get_settings()
    config = load_sources_config(settings)
    selected_sources = _select_news_sources(config.get("news_sources", {}) or {}, sources)
    if not selected_sources:
        return {
            "summary": "Secili canli haber kaynagi bulunamadi.",
            "data": [],
            "missing": True,
            "stale": False,
            "source_errors": [],
        }

    search_config = _build_live_search_config(selected_sources, query)
    scraper = NewsScraper(sources_config=search_config, settings=settings)
    records = scraper.fetch_parse_normalize()
    records = dedupe_records([with_news_id(record) for record in records])
    matches = [record for record in records if _news_record_matches_query(record, query_key)]
    matches.sort(key=lambda item: item.published_at or item.extracted_at, reverse=True)
    rows = news_rows(matches[:limit])

    return {
        "summary": f"{len(rows)} canli haber sonucu dondu.",
        "data": rows,
        "missing": not bool(rows),
        "stale": False,
        "source_errors": scraper.errors,
        "searched_sources": [
            str(source.get("name") or key) for key, source in selected_sources.items()
        ],
    }


def get_recent_company_news(
    company_name: str,
    days: int = 30,
    risk_level: str | None = None,
) -> dict[str, Any]:
    records = filter_news(company=company_name, days=days, risk_level=risk_level)
    return {
        "summary": (
            f"{company_name} için son {days} günde {len(records)} haber bulundu."
            if records
            else f"{company_name} için son {days} günde haber bulunamadı."
        ),
        "data": news_rows(records),
        "missing": not bool(records),
        "stale": False,
        "source_errors": [],
    }


def news_rows(records: list[NewsRecord]) -> list[dict[str, Any]]:
    return [
        {
            "company": record.company_name_normalized,
            "source": record.source_name,
            "title": record.title,
            "url": record.url,
            "published_at": record.published_at.isoformat() if record.published_at else None,
            "summary": record.summary,
            "event_type": record.event_type,
            "risk_level": record.risk_level,
            "matched_keywords": record.matched_keywords,
            "extracted_at": record.extracted_at.isoformat(),
        }
        for record in records
    ]


def _news_matches_company(record: NewsRecord, company: str) -> bool:
    if record.company_name_normalized and is_same_company(record.company_name_normalized, company):
        return True
    haystack = normalize_text_key(f"{record.title} {record.summary or ''}")
    return normalize_text_key(company) in haystack


def _select_news_sources(
    news_sources: dict[str, Any],
    requested: list[str] | None,
) -> dict[str, Any]:
    tokens = _source_tokens(requested)
    selected: dict[str, Any] = {}
    for key, config in news_sources.items():
        if not config.get("enabled", True):
            continue
        if tokens and not _source_matches(key, config, tokens):
            continue
        selected[key] = config
    return selected


def _source_tokens(requested: list[str] | None) -> set[str]:
    tokens: set[str] = set()
    for value in requested or []:
        for part in str(value).split(","):
            token = normalize_text_key(part)
            if token:
                tokens.add(token)
    return tokens


def _source_matches(key: str, config: dict[str, Any], tokens: set[str]) -> bool:
    candidates = {
        normalize_text_key(key),
        normalize_text_key(str(config.get("name") or "")),
    }
    return bool(candidates & tokens)


def _build_live_search_config(
    selected_sources: dict[str, Any],
    query: str,
) -> dict[str, Any]:
    search_config: dict[str, Any] = {}
    encoded_query = quote_plus(query.strip())
    for key, config in selected_sources.items():
        source_config = deepcopy(config)
        search_pages = [
            str(url).format(q=encoded_query, query=encoded_query)
            for url in source_config.pop("search_urls", []) or []
        ]
        source_config.pop("manual_import_glob", None)
        source_config["pages"] = search_pages + list(source_config.get("pages", []) or [])
        search_config[key] = source_config
    return search_config


def _news_record_matches_query(record: NewsRecord, query_key: str) -> bool:
    if not query_key:
        return True
    haystack = normalize_text_key(
        " ".join(
            [
                record.title,
                record.summary or "",
                record.company_name_normalized or "",
                record.source_name,
                record.event_type or "",
                " ".join(record.matched_keywords),
            ]
        )
    )
    if query_key in haystack:
        return True
    tokens = [token for token in query_key.split() if len(token) > 1]
    return bool(tokens) and all(token in haystack for token in tokens)
