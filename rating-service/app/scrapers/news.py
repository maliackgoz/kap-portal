from __future__ import annotations

import csv
import re
import time
import uuid
from datetime import UTC, datetime, timedelta, timezone
from io import StringIO
from typing import Any
from urllib.parse import urljoin

import feedparser
import httpx
from bs4 import BeautifulSoup
from dateutil import parser as date_parser

from ..config import Settings, get_settings
from ..dedupe import dedupe_records, with_news_id
from ..models import NewsRecord, RunLog
from ..normalizer import normalize_company_name, normalize_text_key

RISK_KEYWORDS = [
    "not düşürümü",
    "downgrade",
    "negatif görünüm",
    "temerrüt",
    "dava",
    "icra",
    "takip",
    "yaptırım",
    "sermaye artırımı",
    "birleşme",
    "satın alma",
    "borçlanma aracı",
    "ödeme güçlüğü",
    "konkordato",
    "iflas",
    "yönetim değişikliği",
]

HIGH_RISK = {
    "downgrade",
    "not dusurumu",
    "default",
    "temerrut",
    "konkordato",
    "iflas",
    "odeme guclugu",
    "regulator yaptirimi",
    "yaptirim",
}

MEDIUM_RISK = {
    "negatif gorunum",
    "dava",
    "icra",
    "onemli borclanma",
    "borclanma araci",
    "ortaklik degisimi",
}

CONTEXTUAL_RISK_PATTERNS = {
    "icra": [
        r"\bicra takib",
        r"\bicra daires",
        r"\bicralik",
        r"\bhaciz",
    ],
    "takip": [
        r"\bkanuni takip",
        r"\byasal takip",
        r"\btakipteki alacak",
        r"\btakibe dus",
        r"\btakibe al",
    ],
}

TURKEY_TZ = timezone(timedelta(hours=3))
SOURCE_LOCAL_TIME_FEEDS = {"yeni safak"}


class NewsScraper:
    source_key = "news"

    def __init__(
        self,
        *,
        sources_config: dict[str, Any] | None = None,
        settings: Settings | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.sources_config = sources_config or {}
        self.errors: list[str] = []

    def run(self) -> tuple[list[NewsRecord], RunLog]:
        started_at = datetime.now(UTC)
        log = RunLog(run_id=str(uuid.uuid4()), source="news", started_at=started_at)
        try:
            records = self.fetch_parse_normalize()
            records = dedupe_records([with_news_id(record) for record in records])
            log.records_found = len(records)
            if self.errors:
                log.errors.extend(self.errors)
                log.status = "partial" if records else "error"
            if not records and not self.errors:
                log.status = "skipped"
                log.errors.append("RSS veya manuel haber import kaydı bulunamadı.")
        except Exception as exc:  # noqa: BLE001
            records = []
            log.status = "error"
            log.errors.append(f"{type(exc).__name__}: {exc}")
        log.finished_at = datetime.now(UTC)
        return records, log

    def fetch_parse_normalize(self) -> list[NewsRecord]:
        records: list[NewsRecord] = []
        for source_key, config in self.sources_config.items():
            if not config.get("enabled", True):
                continue
            source_name = str(config.get("name") or source_key)
            for rss_url in config.get("rss", []) or []:
                try:
                    records.extend(self._fetch_rss(source_name, rss_url))
                except Exception as exc:  # noqa: BLE001
                    self.errors.append(
                        f"{source_name} RSS {rss_url}: {type(exc).__name__}: {exc}"
                    )
            for page_url in config.get("pages", []) or []:
                try:
                    records.extend(self._fetch_listing_page(source_name, page_url))
                except Exception as exc:  # noqa: BLE001
                    self.errors.append(
                        f"{source_name} page {page_url}: {type(exc).__name__}: {exc}"
                    )
            glob = config.get("manual_import_glob")
            if glob:
                for path in sorted(self.settings.imports_dir.glob(str(glob))):
                    records.extend(
                        self._parse_manual_csv(source_name, path.read_text(encoding="utf-8-sig"))
                    )
        return records

    def _fetch_rss(self, source_name: str, url: str) -> list[NewsRecord]:
        headers = {"User-Agent": self.settings.user_agent}
        with httpx.Client(
            headers=headers, timeout=self.settings.timeout_seconds, follow_redirects=True
        ) as client:
            response = client.get(url)
            response.raise_for_status()
        raw_dir = self.settings.raw_dir / "news"
        raw_dir.mkdir(parents=True, exist_ok=True)
        raw_path = raw_dir / f"{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}_{source_name}.xml"
        raw_path.write_text(response.text, encoding="utf-8")
        parsed = feedparser.parse(response.text)
        records = []
        for entry in parsed.entries:
            title = str(getattr(entry, "title", "")).strip()
            link = str(getattr(entry, "link", "")).strip()
            if not title or not link:
                continue
            summary = re.sub("<[^>]+>", " ", str(getattr(entry, "summary", "")))
            records.append(
                self._make_record(
                    source_name, title, link, summary, getattr(entry, "published", None)
                )
            )
        time.sleep(max(0.0, self.settings.rate_limit_seconds))
        return records

    def _fetch_listing_page(self, source_name: str, url: str) -> list[NewsRecord]:
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                f"AppleWebKit/537.36 {self.settings.user_agent}"
            )
        }
        with httpx.Client(
            headers=headers,
            timeout=self.settings.timeout_seconds,
            follow_redirects=True,
        ) as client:
            response = client.get(url)
            response.raise_for_status()

        raw_dir = self.settings.raw_dir / "news"
        raw_dir.mkdir(parents=True, exist_ok=True)
        safe_source = re.sub(r"[^A-Za-z0-9_.-]+", "_", source_name)
        raw_path = raw_dir / f"{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}_{safe_source}.html"
        raw_path.write_text(response.text, encoding="utf-8")

        soup = BeautifulSoup(response.text, "lxml")
        seen: set[str] = set()
        records: list[NewsRecord] = []
        for anchor in soup.find_all("a", href=True):
            title = re.sub(r"\s+", " ", anchor.get_text(" ", strip=True)).strip()
            href = str(anchor["href"]).strip()
            if not _looks_like_news_link(title, href):
                continue
            absolute = urljoin(str(response.url), href)
            if absolute in seen:
                continue
            seen.add(absolute)
            records.append(
                self._make_record(
                    source_name=source_name,
                    title=title,
                    url=absolute,
                    summary=None,
                    published=None,
                )
            )
        time.sleep(max(0.0, self.settings.rate_limit_seconds))
        return records[:50]

    def _parse_manual_csv(self, source_name: str, content: str) -> list[NewsRecord]:
        records: list[NewsRecord] = []
        for row in csv.DictReader(StringIO(content)):
            title = row.get("title") or row.get("başlık") or row.get("baslik") or ""
            url = row.get("url") or row.get("link") or ""
            if not title or not url:
                continue
            records.append(
                self._make_record(
                    source_name=row.get("source_name") or source_name,
                    title=title,
                    url=url,
                    summary=row.get("summary") or row.get("özet") or row.get("ozet"),
                    published=row.get("published_at") or row.get("published") or row.get("tarih"),
                    company=row.get("company") or row.get("firma"),
                )
            )
        return records

    def _make_record(
        self,
        source_name: str,
        title: str,
        url: str,
        summary: str | None,
        published: Any,
        company: str | None = None,
    ) -> NewsRecord:
        text = f"{title} {summary or ''}"
        matched = match_risk_keywords(text)
        level = classify_risk(matched)
        event_type = ", ".join(matched) if matched else "nötr haber"
        normalized_company = normalize_company_name(company, fuzzy=True) if company else None
        return NewsRecord(
            company_name_raw=company,
            company_name_normalized=normalized_company,
            source_name=source_name,
            title=title.strip(),
            url=url.strip(),
            published_at=parse_datetime(published, source_name=source_name),
            summary=(summary or "").strip() or None,
            event_type=event_type,
            risk_level=level,
            matched_keywords=matched,
        )


def match_risk_keywords(text: str) -> list[str]:
    text_key = normalize_text_key(text)
    matched: list[str] = []
    contextual_keys = set(CONTEXTUAL_RISK_PATTERNS)
    for keyword in RISK_KEYWORDS:
        keyword_key = normalize_text_key(keyword)
        if keyword_key in contextual_keys:
            continue
        if keyword_key in text_key:
            matched.append(keyword)
    for keyword_key, patterns in CONTEXTUAL_RISK_PATTERNS.items():
        if any(re.search(pattern, text_key) for pattern in patterns):
            matched.append(keyword_key)
    return matched


def classify_risk(keywords: list[str]) -> str:
    normalized = {normalize_text_key(keyword) for keyword in keywords}
    if normalized & HIGH_RISK:
        return "high"
    if normalized & MEDIUM_RISK:
        return "medium"
    return "low"


def parse_datetime(value: Any, *, source_name: str | None = None) -> datetime | None:
    if not value:
        return None
    text = str(value)
    try:
        parsed = date_parser.parse(text, dayfirst=True, fuzzy=True)
    except (TypeError, ValueError, OverflowError):
        return None
    if _source_uses_local_feed_time(source_name) and _has_utc_marker(text):
        return parsed.replace(tzinfo=None).replace(tzinfo=TURKEY_TZ)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed


def _source_uses_local_feed_time(source_name: str | None) -> bool:
    if not source_name:
        return False
    return normalize_text_key(source_name) in SOURCE_LOCAL_TIME_FEEDS


def _has_utc_marker(value: str) -> bool:
    text = value.strip().upper()
    return text.endswith("GMT") or text.endswith("UTC") or text.endswith("Z")


def _looks_like_news_link(title: str, href: str) -> bool:
    if len(title) < 25:
        return False
    lowered = href.lower()
    if any(skip in lowered for skip in ["/p/", "#", "javascript:", "mailto:"]):
        return False
    if any(
        part in lowered
        for part in [
            "/tr/ekonomi/",
            "/haber",
            "/piyasa",
            "/ekonomi/",
            "/finans/",
            "/son-dakika",
        ]
    ):
        return True
    return bool(re.search(r"/[a-z0-9-]+-\d{6,}/?$", lowered))
