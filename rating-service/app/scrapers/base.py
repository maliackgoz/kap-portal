from __future__ import annotations

import csv
import re
import time
import uuid
from abc import ABC, abstractmethod
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, date, datetime
from io import StringIO
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx
import pandas as pd
from bs4 import BeautifulSoup
from dateutil import parser as date_parser
from pypdf import PdfReader

from ..config import Settings, get_settings
from ..dedupe import dedupe_records, with_rating_id
from ..models import RatingRecord, RunLog
from ..normalizer import (
    aliases_for_company,
    clean_rating,
    normalize_action,
    normalize_company_name,
    normalize_outlook,
    normalize_sector,
    normalize_text_key,
)


@dataclass(frozen=True)
class FetchedPage:
    url: str
    content: str
    raw_path: Path


class BaseRatingScraper(ABC):
    """Common lifecycle for public-source rating adapters."""

    source_key = "base"
    source_name = "Base"

    def __init__(
        self,
        *,
        urls: Iterable[str] | None = None,
        settings: Settings | None = None,
        manual_import_glob: str | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.urls = list(urls or [])
        self.manual_import_glob = manual_import_glob
        self.errors: list[str] = []

    @abstractmethod
    def fetch(self) -> list[FetchedPage]:
        """Fetch public pages or import files and save raw inputs."""

    @abstractmethod
    def parse(self, pages: list[FetchedPage]) -> list[dict[str, Any]]:
        """Parse raw pages into intermediate dictionaries."""

    @abstractmethod
    def normalize(self, rows: list[dict[str, Any]]) -> list[RatingRecord]:
        """Convert intermediate rows into normalized rating records."""

    def run(self) -> tuple[list[RatingRecord], RunLog]:
        started_at = datetime.now(UTC)
        log = RunLog(
            run_id=str(uuid.uuid4()),
            source=self.source_key,
            started_at=started_at,
            status="success",
        )
        try:
            pages = self.fetch()
            rows = self.parse(pages)
            records = dedupe_records([with_rating_id(record) for record in self.normalize(rows)])
            log.records_found = len(records)
            if self.errors:
                log.errors.extend(self.errors)
                log.status = "partial" if records else "error"
            if not pages and not records and not self.errors:
                log.status = "skipped"
                log.errors.append("Public URL or manual import file bulunamadı.")
        except Exception as exc:  # noqa: BLE001 - scraper errors should be isolated.
            records = []
            log.status = "error"
            log.errors.append(f"{type(exc).__name__}: {exc}")
        log.finished_at = datetime.now(UTC)
        return records, log

    def fetch_public_urls(self) -> list[FetchedPage]:
        pages: list[FetchedPage] = []
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
            for url in self.urls:
                try:
                    response = client.get(url)
                    response.raise_for_status()
                    content_type = response.headers.get("content-type", "")
                    if "pdf" in content_type.lower() or url.lower().endswith(".pdf"):
                        pdf_path = self.save_pdf(url, response.content)
                        text = self.extract_pdf_text(pdf_path)
                        pages.append(FetchedPage(url=url, content=text, raw_path=pdf_path))
                    else:
                        text = response.text
                        raw_path = self.save_raw(url, text)
                        self.download_linked_pdfs(url, text, client)
                        pages.append(FetchedPage(url=url, content=text, raw_path=raw_path))
                except Exception as exc:  # noqa: BLE001 - keep scraper runs resilient.
                    self.errors.append(f"{url}: {type(exc).__name__}: {exc}")
                finally:
                    time.sleep(max(0.0, self.settings.rate_limit_seconds))
        return pages

    def save_raw(self, url: str, content: str) -> Path:
        timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        raw_dir = self.settings.raw_dir / self.source_key
        raw_dir.mkdir(parents=True, exist_ok=True)
        path = raw_dir / f"{timestamp}_{_slug_from_url(url)}.html"
        path.write_text(content, encoding="utf-8")
        return path

    def save_pdf(self, url: str, content: bytes) -> Path:
        pdf_dir = self.settings.pdf_dir / self.source_key
        pdf_dir.mkdir(parents=True, exist_ok=True)
        filename = Path(urlparse(url).path).name or f"{uuid.uuid4()}.pdf"
        filename = re.sub(r"[^A-Za-z0-9_.-]+", "_", filename)
        if not filename.lower().endswith(".pdf"):
            filename += ".pdf"
        path = pdf_dir / filename
        path.write_bytes(content)
        return path

    def download_linked_pdfs(self, page_url: str, html: str, client: httpx.Client) -> list[Path]:
        soup = BeautifulSoup(html, "lxml")
        saved: list[Path] = []
        for anchor in soup.find_all("a", href=True):
            if len(saved) >= self.settings.max_pdf_downloads_per_page:
                break
            href = str(anchor["href"]).strip()
            if ".pdf" not in href.lower():
                continue
            pdf_url = urljoin(page_url, href)
            try:
                response = client.get(pdf_url)
                response.raise_for_status()
                pdf_path = self.save_pdf(pdf_url, response.content)
                text = self.extract_pdf_text(pdf_path)
                if text:
                    pdf_path.with_suffix(".txt").write_text(text, encoding="utf-8")
                saved.append(pdf_path)
                time.sleep(max(0.0, self.settings.rate_limit_seconds))
            except Exception:
                continue
        return saved

    @staticmethod
    def extract_pdf_text(path: Path) -> str:
        try:
            reader = PdfReader(str(path))
            return "\n".join(page.extract_text() or "" for page in reader.pages).strip()
        except Exception:
            return ""


class GenericTableRatingScraper(BaseRatingScraper):
    """Best-effort parser for public pages with changing table structures."""

    def fetch(self) -> list[FetchedPage]:
        pages = self.fetch_public_urls() if self.urls else []
        pages.extend(self._manual_import_pages())
        return pages

    def parse(self, pages: list[FetchedPage]) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for page in pages:
            if page.raw_path.suffix.lower() == ".csv":
                rows.extend(self._parse_csv_page(page))
                continue
            rows.extend(self._parse_html_tables(page))
        return rows

    def normalize(self, rows: list[dict[str, Any]]) -> list[RatingRecord]:
        records: list[RatingRecord] = []
        for row in rows:
            company = first_value(
                row, ["company", "firma", "şirket", "sirket", "kuruluş", "entity"]
            )
            if not company:
                continue
            rating_date = parse_date(
                first_value(row, ["rating_date", "tarih", "date", "rapor tarihi"])
            )
            long_term = clean_rating(
                first_value(
                    row,
                    [
                        "long_term_rating",
                        "u.v.d",
                        "uvd",
                        "uzun vadeli",
                        "ulusal uzun vadeli",
                        "long term",
                    ],
                )
            )
            short_term = clean_rating(
                first_value(
                    row,
                    [
                        "short_term_rating",
                        "k.v.d",
                        "kvd",
                        "kısa vadeli",
                        "ulusal kısa vadeli",
                        "ulusal kisa vadeli",
                        "short term",
                    ],
                )
            )
            source_url = first_value(row, ["source_url", "url"]) or ""
            source_url = source_url or (self.urls[0] if self.urls else "")
            report_url = first_value(row, ["report_url", "rapor", "link"])
            sector_raw = first_value(row, ["sector", "sektör", "sektor"])
            outlook_raw = first_value(row, ["outlook", "görünüm", "gorunum"])
            action_raw = first_value(row, ["action", "açıklama", "aciklama", "aksiyon"])
            normalized_company = normalize_company_name(company)
            records.append(
                RatingRecord(
                    company_name_raw=company,
                    company_name_normalized=normalized_company,
                    company_aliases=aliases_for_company(normalized_company),
                    source_agency=self.source_name,
                    source_url=source_url,
                    report_url=report_url,
                    pdf_url=first_value(row, ["pdf_url", "pdf"]),
                    sector_raw=sector_raw,
                    sector_normalized=normalize_sector(sector_raw),
                    rating_date=rating_date,
                    publish_date=parse_date(first_value(row, ["publish_date", "yayın tarihi"])),
                    valid_until=parse_date(first_value(row, ["valid_until", "geçerlilik"])),
                    long_term_rating_raw=long_term,
                    short_term_rating_raw=short_term,
                    outlook_raw=outlook_raw,
                    outlook_normalized=normalize_outlook(outlook_raw),
                    action_type_raw=action_raw,
                    action_type_normalized=normalize_action(action_raw),
                    rating_scale=first_value(row, ["rating_scale", "ölçek"]) or "National",
                    country_or_national_scale=first_value(
                        row, ["country_or_national_scale", "scale"]
                    )
                    or "TR",
                    notes=first_value(row, ["notes", "notlar"]),
                    extraction_confidence=float(row.get("extraction_confidence") or 0.55),
                )
            )
        return records

    def _manual_import_pages(self) -> list[FetchedPage]:
        if not self.manual_import_glob:
            return []
        pages: list[FetchedPage] = []
        for path in sorted(self.settings.imports_dir.glob(self.manual_import_glob)):
            pages.append(
                FetchedPage(
                    url=str(path), content=path.read_text(encoding="utf-8-sig"), raw_path=path
                )
            )
        return pages

    def _parse_csv_page(self, page: FetchedPage) -> list[dict[str, Any]]:
        handle = StringIO(page.content)
        reader = csv.DictReader(handle)
        rows = []
        for row in reader:
            normalized = {normalize_header(key): value for key, value in row.items()}
            normalized["source_url"] = normalized.get("source_url") or page.url
            rows.append(normalized)
        return rows

    def _parse_html_tables(self, page: FetchedPage) -> list[dict[str, Any]]:
        rows = parse_soup_tables(page)
        if rows:
            return rows
        parsed: list[dict[str, Any]] = []
        try:
            tables = pd.read_html(StringIO(page.content))
        except ValueError:
            return []
        for table in tables:
            table.columns = [normalize_header(str(column)) for column in table.columns]
            if not _looks_like_rating_table(table.columns):
                continue
            for raw in table.to_dict(orient="records"):
                row = {normalize_header(str(key)): _clean_cell(value) for key, value in raw.items()}
                row["source_url"] = page.url
                parsed.append(row)
        return parsed


def parse_soup_tables(page: FetchedPage) -> list[dict[str, Any]]:
    soup = BeautifulSoup(page.content, "lxml")
    rows: list[dict[str, Any]] = []
    for table in soup.find_all("table"):
        headers: list[str] = []
        for tr in table.find_all("tr"):
            cells = tr.find_all(["th", "td"])
            if not cells:
                continue
            values = [_clean_cell(cell.get_text(" ", strip=True)) for cell in cells]
            normalized_values = [normalize_header(value) for value in values]
            if any(
                value in {"firma", "company", "şirket", "sirket"} for value in normalized_values
            ):
                headers = normalized_values
                continue
            if not headers or len(values) < 2:
                continue
            row = {headers[index]: values[index] for index in range(min(len(headers), len(values)))}
            row["source_url"] = page.url
            links = [
                urljoin(page.url, str(anchor["href"])) for anchor in tr.find_all("a", href=True)
            ]
            pdf_links = [link for link in links if ".pdf" in link.lower()]
            if links:
                row["report_url"] = links[0]
            if pdf_links:
                row["pdf_url"] = pdf_links[0]
            if _row_has_company_and_date(row):
                rows.append(row)
    return rows


def first_value(row: dict[str, Any], keys: list[str]) -> str | None:
    normalized = {normalize_header(str(key)): value for key, value in row.items()}
    for key in keys:
        value = normalized.get(normalize_header(key))
        if value is not None and str(value).strip() and str(value).strip().lower() != "nan":
            return str(value).strip()
    return None


def normalize_header(value: str) -> str:
    key = normalize_text_key(value).replace(".", "")
    key = key.replace("ı", "i")
    return re.sub(r"\s+", " ", key).strip()


def parse_date(value: Any) -> date | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() in {"nan", "-", "none"}:
        return None
    try:
        return date_parser.parse(text, dayfirst=True, fuzzy=True).date()
    except (ValueError, OverflowError, TypeError):
        return None


def _slug_from_url(url: str) -> str:
    parsed = urlparse(url)
    value = (Path(parsed.path).stem or parsed.netloc or "page").lower()
    value = re.sub(r"[^a-z0-9_.-]+", "-", value)
    return value[:80] or "page"


def _clean_cell(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).replace("\xa0", " ")
    return re.sub(r"\s+", " ", text).strip()


def _looks_like_rating_table(columns: Iterable[str]) -> bool:
    headers = {normalize_header(column) for column in columns}
    has_company = bool(headers & {"firma", "company", "sirket", "kurulus", "entity"})
    has_date = bool(headers & {"tarih", "date", "rating date", "rapor tarihi"})
    has_rating = bool(
        headers
        & {
            "uvd",
            "u v d",
            "kvd",
            "k v d",
            "long term",
            "short term",
            "uzun vadeli",
            "kisa vadeli",
            "not",
        }
    )
    return has_company and (has_date or has_rating)


def _row_has_company_and_date(row: dict[str, Any]) -> bool:
    company = first_value(row, ["firma", "company", "şirket", "sirket", "kuruluş", "entity"])
    value = first_value(row, ["tarih", "date", "rating_date", "rapor tarihi"])
    return bool(company and (value or first_value(row, ["u.v.d", "uvd", "not", "long term"])))
