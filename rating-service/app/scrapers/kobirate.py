from __future__ import annotations

import re
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

from ..models import RatingRecord
from ..normalizer import (
    aliases_for_company,
    clean_rating,
    normalize_company_name,
    normalize_outlook,
    normalize_sector,
    normalize_text_key,
)
from .base import BaseRatingScraper, FetchedPage, parse_date

DATE_RE = re.compile(r"\b\d{1,2}[./]\d{1,2}[./]\d{4}\b")


class KobiRateScraper(BaseRatingScraper):
    source_key = "kobirate"
    source_name = "KobiRate"

    def fetch(self) -> list[FetchedPage]:
        pages = self.fetch_public_urls()
        detail_urls = self._detail_urls(pages)
        if not detail_urls:
            return pages

        headers = {
            "User-Agent": self.settings.user_agent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
        }
        with httpx.Client(
            headers=headers,
            timeout=self.settings.timeout_seconds,
            follow_redirects=True,
        ) as client:
            for detail_url in detail_urls:
                try:
                    response = client.get(detail_url)
                    response.raise_for_status()
                    raw_path = self._save_detail_raw(detail_url, response.text)
                    pages.append(
                        FetchedPage(
                            url=str(response.url),
                            content=response.text,
                            raw_path=raw_path,
                        )
                    )
                except Exception as exc:  # noqa: BLE001 - keep one bad detail page isolated.
                    self.errors.append(f"{detail_url}: {type(exc).__name__}: {exc}")
                finally:
                    time.sleep(max(0.0, self.settings.rate_limit_seconds))
        return pages

    def parse(self, pages: list[FetchedPage]) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for page in pages:
            if "detay.aspx" not in page.url.lower():
                continue
            soup = BeautifulSoup(page.content, "lxml")
            context = _page_context(soup)
            for table in soup.find_all("table"):
                if table.find("table"):
                    continue
                values = _table_key_values(table)
                if not _looks_like_rating_block(values):
                    continue
                company = context.get("company")
                if not company:
                    continue
                rows.append(
                    {
                        "company": company,
                        "sector": context.get("sector"),
                        "rating_date": values.get("derecelendirme rapor tarihi"),
                        "valid_until": _valid_until(values.get("gecerlilik tarihi")),
                        "long_term_rating": values.get("uzun vadeli derecelendirme notu"),
                        "short_term_rating": values.get("kisa vadeli derecelendirme notu"),
                        "outlook": values.get("gorunumu"),
                        "source_url": page.url,
                        "report_url": _public_report_link(page.url, table),
                        "notes": (
                            "KobiRate detail page parsed; public PDF/report URL is only "
                            "stored when the page exposes a direct link."
                        ),
                    }
                )
        return rows

    def normalize(self, rows: list[dict[str, Any]]) -> list[RatingRecord]:
        records: list[RatingRecord] = []
        for row in rows:
            company = str(row.get("company") or "").strip()
            if not company:
                continue
            normalized_company = normalize_company_name(company)
            rating_date = parse_date(row.get("rating_date"))
            records.append(
                RatingRecord(
                    company_name_raw=company,
                    company_name_normalized=normalized_company,
                    company_aliases=aliases_for_company(normalized_company),
                    source_agency=self.source_name,
                    source_url=str(row.get("source_url") or ""),
                    report_url=row.get("report_url"),
                    sector_raw=row.get("sector"),
                    sector_normalized=normalize_sector(row.get("sector")),
                    rating_date=rating_date,
                    publish_date=rating_date,
                    valid_until=parse_date(row.get("valid_until")),
                    long_term_rating_raw=clean_rating(row.get("long_term_rating")),
                    short_term_rating_raw=clean_rating(row.get("short_term_rating")),
                    outlook_raw=row.get("outlook"),
                    outlook_normalized=normalize_outlook(row.get("outlook")),
                    rating_scale="National",
                    country_or_national_scale="TR",
                    notes=row.get("notes"),
                    extraction_confidence=0.9,
                )
            )
        return records

    def _detail_urls(self, pages: list[FetchedPage]) -> list[str]:
        detail_urls: list[str] = []
        seen: set[str] = set()
        for page in pages:
            soup = BeautifulSoup(page.content, "lxml")
            for anchor in soup.find_all("a", href=True):
                href = str(anchor["href"]).strip()
                if "detay.aspx?id=" not in href.lower():
                    continue
                detail_url = urljoin(page.url, href)
                if detail_url in seen:
                    continue
                seen.add(detail_url)
                detail_urls.append(detail_url)
        return detail_urls

    def _save_detail_raw(self, url: str, content: str) -> Path:
        raw_dir = self.settings.raw_dir / self.source_key
        raw_dir.mkdir(parents=True, exist_ok=True)
        parsed = urlparse(url)
        detail_id = (parse_qs(parsed.query).get("id") or ["detail"])[0]
        detail_id = re.sub(r"[^A-Za-z0-9_.-]+", "_", detail_id)
        timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        path = raw_dir / f"{timestamp}_detay-{detail_id}.html"
        path.write_text(content, encoding="utf-8")
        return path


def _page_context(soup: BeautifulSoup) -> dict[str, str | None]:
    context = {"company": None, "sector": None}
    for table in soup.find_all("table"):
        values = _table_key_values(table)
        if "sirket unvani" in values:
            context["company"] = values.get("sirket unvani")
        if "sektoru" in values:
            context["sector"] = values.get("sektoru")
        if context["company"] and context["sector"]:
            break
    if not context["company"]:
        heading = soup.find(["h1", "h2"])
        if heading:
            text = heading.get_text(" ", strip=True)
            if "rapor" not in normalize_text_key(text):
                context["company"] = text
    return context


def _table_key_values(table: Any) -> dict[str, str]:
    values: dict[str, str] = {}
    for tr in table.find_all("tr"):
        cells = [cell.get_text(" ", strip=True) for cell in tr.find_all(["th", "td"])]
        if len(cells) >= 3 and cells[1].strip() == ":":
            key = normalize_text_key(cells[0])
            value = re.sub(r"\s+", " ", cells[2]).strip()
            if key and value:
                values[key] = value
    return values


def _looks_like_rating_block(values: dict[str, str]) -> bool:
    return bool(
        values.get("derecelendirme rapor tarihi")
        and (
            values.get("uzun vadeli derecelendirme notu")
            or values.get("kisa vadeli derecelendirme notu")
        )
    )


def _valid_until(value: str | None) -> str | None:
    if not value:
        return None
    matches = DATE_RE.findall(value)
    return matches[-1] if matches else value


def _public_report_link(page_url: str, table: Any) -> str | None:
    for anchor in table.find_all("a", href=True):
        href = str(anchor["href"]).strip()
        if not href or href == "#" or href.lower().startswith("javascript:"):
            continue
        return urljoin(page_url, href)
    return None
