from __future__ import annotations

from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

from ..config import get_settings, load_companies_config, load_sources_config
from ..models import RatingRecord, RunLog
from ..normalizer import (
    company_match_key,
    is_same_company,
    normalize_outlook,
    normalize_sector,
    normalize_text_key,
)
from ..scrapers import (
    JCRScraper,
    KobiRateScraper,
    SAHAScraper,
    TurkRatingScraper,
)
from ..storage import (
    append_jsonl,
    delete_jsonl_matching,
    export_csv,
    export_markdown,
    read_jsonl,
    upsert_jsonl,
)

SCRAPER_CLASSES = {
    "turkrating": TurkRatingScraper,
    "jcr": JCRScraper,
    "saha": SAHAScraper,
    "kobirate": KobiRateScraper,
}

OLD_RATING_DAYS = 730


def refresh_sources(sources: list[str] | None = None, force: bool = False) -> dict[str, Any]:
    settings = get_settings()
    config = load_sources_config(settings)
    rating_sources = config.get("rating_sources", {}) or {}
    news_sources = config.get("news_sources", {}) or {}
    requested = [source.lower() for source in (sources or rating_sources.keys())]
    summaries: list[dict[str, Any]] = []

    for source_key in requested:
        if source_key == "news":
            from .news import refresh_news_sources

            enabled_news_keys = [
                key for key, value in news_sources.items() if value.get("enabled", True)
            ]
            for news_key in enabled_news_keys:
                summaries.append(refresh_news_sources(source_keys=[news_key]))
            continue

        if source_key in news_sources:
            from .news import refresh_news_sources

            summaries.append(refresh_news_sources(source_keys=[source_key]))
            continue

        source_config = rating_sources.get(source_key)
        scraper_class = SCRAPER_CLASSES.get(source_key)
        if not source_config or not scraper_class:
            log = RunLog(
                run_id=f"missing-{source_key}-{datetime.now(UTC).timestamp()}",
                source=source_key,
                started_at=datetime.now(UTC),
                finished_at=datetime.now(UTC),
                status="error",
                errors=[f"Bilinmeyen veya yapılandırılmamış kaynak: {source_key}"],
            )
            append_jsonl(settings.run_log_path, log)
            summaries.append(_log_summary(log))
            continue
        if not source_config.get("enabled", True):
            log = RunLog(
                run_id=f"disabled-{source_key}-{datetime.now(UTC).timestamp()}",
                source=source_key,
                started_at=datetime.now(UTC),
                finished_at=datetime.now(UTC),
                status="skipped",
                errors=[f"Kaynak devre dışı: {source_key}"],
            )
            append_jsonl(settings.run_log_path, log)
            summaries.append(_log_summary(log))
            continue

        scraper = scraper_class(
            urls=source_config.get("urls") or [],
            settings=settings,
            manual_import_glob=source_config.get("manual_import_glob"),
        )
        records, log = scraper.run()
        if records:
            if source_key == "saha":
                delete_jsonl_matching(
                    settings.ratings_path,
                    lambda row: row.get("source_agency") == "SAHA Rating"
                    and not row.get("long_term_rating_raw")
                    and not row.get("short_term_rating_raw"),
                )
            result = upsert_jsonl(settings.ratings_path, records)
            log.records_added = result["added"]
            log.records_updated = result["updated"]
            delete_jsonl_matching(
                settings.ratings_path,
                lambda row, agency=scraper.source_name: (
                    row.get("source_agency") == agency
                    and not row.get("long_term_rating_raw")
                    and not row.get("short_term_rating_raw")
                    and not row.get("action_type_raw")
                    and not row.get("action_type_normalized")
                    and row.get("provider_status", "FOUND") == "FOUND"
                ),
            )
        append_jsonl(settings.run_log_path, log)
        summary = _log_summary(log)
        summary["force"] = force
        summaries.append(summary)
    return {
        "summary": _refresh_summary_text(summaries),
        "data": summaries,
        "source_errors": [error for item in summaries for error in item.get("errors", [])],
    }


def load_rating_records() -> list[RatingRecord]:
    return [RatingRecord.model_validate(row) for row in read_jsonl(get_settings().ratings_path)]


def load_run_logs(limit: int | None = None) -> list[RunLog]:
    logs = [RunLog.model_validate(row) for row in read_jsonl(get_settings().run_log_path)]
    logs.sort(key=lambda item: item.started_at, reverse=True)
    return logs[:limit] if limit else logs


def filter_ratings(
    *,
    company: str | None = None,
    sector: str | None = None,
    agency: str | None = None,
    latest_only: bool = False,
    outlook: str | None = None,
    min_date: date | None = None,
    max_date: date | None = None,
    records: list[RatingRecord] | None = None,
) -> list[RatingRecord]:
    rows = records or load_rating_records()
    agency_key = normalize_text_key(agency)
    sector_value = normalize_sector(sector)
    outlook_value = normalize_outlook(outlook)

    filtered: list[RatingRecord] = []
    for record in rows:
        if company and not is_same_company(record.company_name_normalized, company):
            continue
        if agency and normalize_text_key(record.source_agency) != agency_key:
            continue
        if sector_value and record.sector_normalized != sector_value:
            continue
        if outlook_value and record.outlook_normalized != outlook_value:
            continue
        if min_date and (record.rating_date is None or record.rating_date < min_date):
            continue
        if max_date and (record.rating_date is None or record.rating_date > max_date):
            continue
        filtered.append(record)

    filtered.sort(key=rating_sort_key, reverse=True)
    if latest_only:
        filtered = latest_ratings(filtered)
    return filtered


def latest_ratings(records: list[RatingRecord]) -> list[RatingRecord]:
    latest: dict[tuple[str, str], RatingRecord] = {}
    for record in sorted(records, key=rating_sort_key, reverse=True):
        key = (company_match_key(record.company_name_normalized), record.source_agency)
        latest.setdefault(key, record)
    return list(latest.values())


def get_company_ratings(
    company_name: str,
    agency: str | None = None,
    include_history: bool = True,
) -> dict[str, Any]:
    records = filter_ratings(company=company_name, agency=agency, latest_only=not include_history)
    return _records_result(
        records,
        empty_summary=f"{company_name} için rating kaydı bulunamadı.",
        ok_summary=f"{company_name} için {len(records)} rating kaydı bulundu.",
    )


def get_sector_ratings(
    sector: str,
    agency: str | None = None,
    latest_only: bool = True,
) -> dict[str, Any]:
    records = filter_ratings(sector=sector, agency=agency, latest_only=latest_only)
    return _records_result(
        records,
        empty_summary=f"{sector} sektörü için rating kaydı bulunamadı.",
        ok_summary=f"{sector} sektörü için {len(records)} rating kaydı bulundu.",
    )


def compare_company_sources(company_name: str) -> dict[str, Any]:
    records = filter_ratings(company=company_name)
    latest = latest_ratings(records)
    latest.sort(key=lambda item: item.source_agency)
    return _records_result(
        latest,
        empty_summary=f"{company_name} için kaynak karşılaştırması yapılamadı; kayıt yok.",
        ok_summary=f"{company_name} için {len(latest)} kaynakta son rating bulundu.",
    )


def get_rating_history(company_name: str, agency: str | None = None) -> dict[str, Any]:
    records = filter_ratings(company=company_name, agency=agency)
    records.sort(key=rating_sort_key)
    return _records_result(
        records,
        empty_summary=f"{company_name} için rating geçmişi bulunamadı.",
        ok_summary=f"{company_name} için kronolojik rating geçmişi hazır.",
    )


def generate_rating_brief(company_or_sector: str, agency: str | None = None) -> dict[str, Any]:
    sector_records = filter_ratings(sector=company_or_sector, agency=agency, latest_only=True)
    if sector_records:
        records = sector_records
        subject_type = "sector"
    else:
        records = filter_ratings(company=company_or_sector, agency=agency, latest_only=False)
        subject_type = "company"

    latest = latest_ratings(records)
    risks = [
        record
        for record in latest
        if record.outlook_normalized == "Negatif"
        or record.action_type_normalized in {"Not Düşürümü", "Geri Çekildi"}
    ]
    changes = [
        record
        for record in records
        if record.action_type_normalized in {"Not Düşürümü", "Not Artırımı", "Geri Çekildi"}
    ]
    missing = not bool(records)
    summary = _brief_text(company_or_sector, subject_type, latest, risks, changes, missing)
    old_records = [record for record in latest if rating_is_old(record)]
    if old_records:
        summary = (
            f"{summary} {len(old_records)} son rating kaydı 24 aydan eski; bunları "
            "tarihsel kayıt olarak göster, şirket aktifliği/iflas/ad değişikliği sonucu çıkarma."
        )
    return {
        "summary": summary,
        "data": {
            "subject": company_or_sector,
            "subject_type": subject_type,
            "latest": table_rows(latest),
            "changes": table_rows(changes),
            "risks": table_rows(risks),
        },
        "missing": missing,
        "stale": data_is_stale(records),
        "old_rating_count": len(old_records),
        "freshness_caveats": [
            "24 aydan eski rating tarihleri sadece tarihsel kaynak kaydıdır; güncel durum "
            "veya şirket aktifliği hakkında tek başına kanıt değildir."
        ]
        if old_records
        else [],
        "source_errors": latest_source_errors(agency=agency),
    }


def list_available_sources() -> dict[str, Any]:
    config = load_sources_config(get_settings())
    logs = load_run_logs()
    by_source: dict[str, RunLog] = {}
    for log in logs:
        by_source.setdefault(log.source, log)

    rating_counts: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"records": 0, "reports": 0, "status_counts": defaultdict(int)}
    )
    for record in load_rating_records():
        stats = rating_counts[record.source_agency]
        stats["records"] += 1
        stats["status_counts"][record.provider_status] += 1
        if record.report_url or record.pdf_url or record.source_url:
            stats["reports"] += 1

    news_counts: dict[str, int] = defaultdict(int)
    try:
        from .news import load_news_records

        for record in load_news_records():
            news_counts[record.source_name] += 1
    except Exception:
        news_counts = defaultdict(int)

    sources = []
    for group in ["rating_sources", "news_sources"]:
        for source_key, item in (config.get(group, {}) or {}).items():
            source_name = item.get("name") or source_key
            source_type = "news" if group == "news_sources" else "rating"
            last = by_source.get(source_key)
            if source_type == "news" and not last:
                last = by_source.get("news")
            record_count = (
                news_counts.get(source_name, 0)
                if source_type == "news"
                else rating_counts[source_name]["records"]
            )
            report_count = 0 if source_type == "news" else rating_counts[source_name]["reports"]
            status_counts = (
                {}
                if source_type == "news"
                else dict(rating_counts[source_name]["status_counts"])
            )
            enabled = bool(item.get("enabled", True))
            sources.append(
                {
                    "key": source_key,
                    "name": source_name,
                    "type": source_type,
                    "enabled": enabled,
                    "last_status": last.status if last else None,
                    "last_refresh": last.finished_at.isoformat()
                    if last and last.finished_at
                    else None,
                    "last_errors": last.errors if last else [],
                    "record_count": record_count,
                    "report_count": report_count,
                    "status_counts": status_counts,
                    "searched_count": sum(status_counts.values()),
                    "found_count": status_counts.get("FOUND", 0),
                    "no_match_count": status_counts.get("NO_MATCH", 0),
                    "login_required_count": status_counts.get("LOGIN_REQUIRED", 0),
                    "subscription_required_count": status_counts.get("SUBSCRIPTION_REQUIRED", 0),
                    "blocked_count": status_counts.get("BLOCKED", 0),
                    "parse_error_count": status_counts.get("PARSE_ERROR", 0),
                    "display_status": _source_display_status(enabled, last, status_counts),
                    "status_class": _source_status_class(enabled, last, status_counts),
                }
            )
    return {"summary": f"{len(sources)} kaynak listelendi.", "data": sources}


def list_known_companies(query: str | None = None) -> dict[str, Any]:
    config = load_companies_config(get_settings())
    names = {item.get("name") for item in config.get("companies", []) or [] if item.get("name")}
    names.update(record.company_name_normalized for record in load_rating_records())
    sorted_names = sorted(str(name) for name in names if name)
    if query:
        query_key = normalize_text_key(query)
        sorted_names = [name for name in sorted_names if query_key in normalize_text_key(name)]
    aliases = {
        item.get("name"): item.get("aliases", [])
        for item in config.get("companies", []) or []
        if item.get("name")
    }
    return {
        "summary": f"{len(sorted_names)} şirket listelendi.",
        "data": [{"company": name, "aliases": aliases.get(name, [])} for name in sorted_names],
    }


def export_latest_csv() -> Path:
    records = latest_ratings(load_rating_records())
    return export_csv(records, get_settings().exports_dir / "latest.csv")


def export_latest_markdown() -> Path:
    records = latest_ratings(load_rating_records())
    return export_markdown(records, get_settings().exports_dir / "latest.md")


def table_rows(records: list[RatingRecord]) -> list[dict[str, Any]]:
    return [
        {
            "company": record.company_name_normalized,
            "agency": record.source_agency,
            "rating_date": record.rating_date.isoformat() if record.rating_date else None,
            "long_term_rating": record.long_term_rating_raw,
            "short_term_rating": record.short_term_rating_raw,
            "national_rating": record.national_rating_raw,
            "outlook": record.outlook_normalized,
            "sector": record.sector_normalized,
            "action": record.action_type_normalized,
            "source_url": record.source_url,
            "report_url": record.report_url,
            "pdf_url": record.pdf_url,
            "matched_name": record.matched_name,
            "provider_status": record.provider_status,
            "confidence": record.match_confidence,
            "error_message": record.error_message,
            "fetched_at": record.fetched_at.isoformat() if record.fetched_at else None,
            "extracted_at": record.extracted_at.isoformat(),
            "rating_age_days": rating_age_days(record),
            "rating_is_old": rating_is_old(record),
            "freshness_note": rating_freshness_note(record),
        }
        for record in records
    ]


def latest_source_errors(agency: str | None = None) -> list[str]:
    logs = load_run_logs()
    config = load_sources_config(get_settings())
    news_source_keys = set((config.get("news_sources", {}) or {}).keys())
    has_specific_news_logs = any(log.source in news_source_keys for log in logs)
    disabled_tokens = _disabled_source_tokens(config)
    agency_key = normalize_text_key(agency)
    errors: list[str] = []
    seen: set[str] = set()
    for log in logs:
        if log.source == "news" and has_specific_news_logs:
            continue
        if _source_disabled(log.source, config):
            continue
        if (
            agency_key
            and normalize_text_key(log.source) != agency_key
            and normalize_text_key(log.source) not in agency_key
        ):
            continue
        if log.source in seen:
            continue
        seen.add(log.source)
        if log.status in {"error", "partial"}:
            errors.extend(
                f"{log.source}: {error}"
                for error in log.errors
                if not _mentions_disabled_source(error, disabled_tokens)
            )
    return errors


def _source_disabled(source_key: str, config: dict[str, Any]) -> bool:
    for group in ["rating_sources", "news_sources"]:
        source_config = (config.get(group, {}) or {}).get(source_key)
        if source_config is not None:
            return not bool(source_config.get("enabled", True))
    return False


def _disabled_source_tokens(config: dict[str, Any]) -> set[str]:
    tokens: set[str] = set()
    for group in ["rating_sources", "news_sources"]:
        for key, source_config in (config.get(group, {}) or {}).items():
            if source_config.get("enabled", True):
                continue
            tokens.add(normalize_text_key(key))
            tokens.add(normalize_text_key(source_config.get("name")))
    return {token for token in tokens if token}


def _mentions_disabled_source(error: str, disabled_tokens: set[str]) -> bool:
    error_key = normalize_text_key(error)
    return any(token in error_key for token in disabled_tokens)


def data_is_stale(records: list[RatingRecord], days: int = 7) -> bool:
    if not records:
        return True
    latest_extract = max(record.extracted_at for record in records)
    return latest_extract < datetime.now(UTC) - timedelta(days=days)


def rating_age_days(record: RatingRecord) -> int | None:
    if not record.rating_date:
        return None
    return (date.today() - record.rating_date).days


def rating_is_old(record: RatingRecord, days: int = OLD_RATING_DAYS) -> bool:
    age = rating_age_days(record)
    return age is not None and age > days


def rating_freshness_note(record: RatingRecord) -> str | None:
    if not rating_is_old(record):
        return None
    return (
        "Rating tarihi 24 aydan eski; bu kaydı tarihsel veri olarak yorumla. "
        "Eski tarih tek başına şirketin aktif olmadığı, iflas ettiği veya ad değiştirdiği "
        "anlamına gelmez."
    )


def rating_sort_key(record: RatingRecord) -> tuple[date, date, datetime]:
    min_day = date.min
    return (
        record.rating_date or min_day,
        record.publish_date or min_day,
        record.extracted_at,
    )


def _records_result(
    records: list[RatingRecord], *, empty_summary: str, ok_summary: str
) -> dict[str, Any]:
    old_records = [record for record in records if rating_is_old(record)]
    summary = empty_summary if not records else ok_summary
    if old_records:
        summary = (
            f"{summary} {len(old_records)} kayıt 24 aydan eski; bunları tarihsel kayıt "
            "olarak göster, şirket aktifliği/iflas/ad değişikliği sonucu çıkarma."
        )
    return {
        "summary": summary,
        "data": table_rows(records),
        "missing": not bool(records),
        "stale": data_is_stale(records),
        "old_rating_count": len(old_records),
        "freshness_caveats": [
            "24 aydan eski rating tarihleri sadece tarihsel kaynak kaydıdır; güncel durum "
            "veya şirket aktifliği hakkında tek başına kanıt değildir."
        ]
        if old_records
        else [],
        "source_errors": latest_source_errors(),
    }


def _log_summary(log: RunLog) -> dict[str, Any]:
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


def _refresh_summary_text(items: list[dict[str, Any]]) -> str:
    ok = sum(1 for item in items if item["status"] == "success")
    partial = sum(1 for item in items if item["status"] == "partial")
    skipped = sum(1 for item in items if item["status"] == "skipped")
    failed = sum(1 for item in items if item["status"] == "error")
    total_records = sum(int(item.get("records_found") or 0) for item in items)
    return (
        f"Yenileme tamamlandı: {ok} başarılı, {partial} kısmi, "
        f"{skipped} atlandı, {failed} hatalı, {total_records} kayıt bulundu."
    )


def _brief_text(
    subject: str,
    subject_type: str,
    latest: list[RatingRecord],
    risks: list[RatingRecord],
    changes: list[RatingRecord],
    missing: bool,
) -> str:
    if missing:
        return f"{subject} için rating verisi bulunamadı; kaynak yenileme gerekebilir."
    scope = "sektör" if subject_type == "sector" else "şirket"
    strongest = _strongest_rating(latest)
    risk_text = (
        f"{len(risks)} negatif görünüm/not düşürümü/geri çekilme sinyali var"
        if risks
        else "negatif görünüm veya not düşürümü sinyali yok"
    )
    change_text = (
        f"{len(changes)} belirgin rating aksiyonu var"
        if changes
        else "belirgin rating değişimi yok"
    )
    return (
        f"{subject} için {scope} özeti: {len(latest)} son rating kaydı var. "
        f"En güçlü UVD: {strongest}. {risk_text}. {change_text}. "
        "Kaynak linkleri tablo verisinde yer alıyor; eksik kaynaklar varsa ayrıca belirtilir."
    )


def _strongest_rating(records: list[RatingRecord]) -> str:
    if not records:
        return "yok"
    buckets: defaultdict[str, list[str]] = defaultdict(list)
    for record in records:
        if record.long_term_rating_raw:
            buckets[record.long_term_rating_raw].append(record.company_name_normalized)
    if not buckets:
        return "yok"
    rating = sorted(buckets)[0]
    return f"{rating} ({', '.join(sorted(buckets[rating])[:3])})"


def _source_display_status(
    enabled: bool,
    log: RunLog | None,
    status_counts: dict[str, int] | None = None,
) -> str:
    if not enabled:
        return "Devre dışı"
    status_counts = status_counts or {}
    if status_counts.get("FOUND", 0) > 0:
        if sum(value for key, value in status_counts.items() if key != "FOUND") > 0:
            return "Kısmi"
        return "Hazır"
    if status_counts.get("LOGIN_REQUIRED", 0) > 0:
        return "Login gerekli"
    if status_counts.get("SUBSCRIPTION_REQUIRED", 0) > 0:
        return "Abonelik gerekli"
    if status_counts.get("BLOCKED", 0) > 0:
        return "Engellendi"
    if status_counts.get("PARSE_ERROR", 0) > 0:
        return "Parse hatası"
    if status_counts.get("NO_MATCH", 0) > 0:
        return "Eşleşme yok"
    if not log:
        return "Bekliyor"
    if log.status == "success" and log.records_found == 0:
        return "Veri yok"
    if log.status == "success":
        return "Hazır"
    if log.status == "partial":
        return "Kısmi"
    if log.status == "skipped":
        return "Manuel"
    return "Hata"


def _source_status_class(
    enabled: bool,
    log: RunLog | None,
    status_counts: dict[str, int] | None = None,
) -> str:
    if not enabled:
        return "disabled"
    status_counts = status_counts or {}
    if status_counts.get("FOUND", 0) > 0:
        if sum(value for key, value in status_counts.items() if key != "FOUND") > 0:
            return "partial"
        return "success"
    if any(
        status_counts.get(key, 0) > 0
        for key in ["LOGIN_REQUIRED", "SUBSCRIPTION_REQUIRED", "BLOCKED"]
    ):
        return "error"
    if status_counts.get("PARSE_ERROR", 0) > 0:
        return "partial"
    if status_counts.get("NO_MATCH", 0) > 0:
        return "empty"
    if not log:
        return "pending"
    if log.status == "success" and log.records_found > 0:
        return "success"
    if log.status == "partial":
        return "partial"
    if log.status == "skipped":
        return "manual"
    if log.status == "success":
        return "empty"
    return "error"
