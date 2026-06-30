from __future__ import annotations

import re
from typing import Any
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from ..models import RatingRecord
from ..normalizer import (
    aliases_for_company,
    clean_rating,
    normalize_company_name,
    normalize_outlook,
    normalize_sector,
)
from .base import BaseRatingScraper, FetchedPage, parse_date

DATE_RE = re.compile(r"\b\d{1,2}[./]\d{1,2}[./]\d{4}\b")


class JCRScraper(BaseRatingScraper):
    source_key = "jcr"
    source_name = "JCR Eurasia"

    def fetch(self) -> list[FetchedPage]:
        return self.fetch_public_urls()

    def parse(self, pages: list[FetchedPage]) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for page in pages:
            soup = BeautifulSoup(page.content, "lxml")
            for table in soup.find_all("table"):
                table_rows = [
                    [cell.get_text(" ", strip=True) for cell in tr.find_all(["th", "td"])]
                    for tr in table.find_all("tr")
                ]
                table_trs = table.find_all("tr")
                for index, cells in enumerate(table_rows):
                    if len(cells) < 8 or cells[1].casefold() != "uzun vade":
                        continue
                    short_cells = table_rows[index + 1] if index + 1 < len(table_rows) else []
                    report_url = _report_url(page.url, table_trs[index])
                    rows.append(
                        {
                            "company": cells[0],
                            "rating_date": _first_date(cells),
                            "long_term_rating": cells[5] if len(cells) > 5 else None,
                            "short_term_rating": short_cells[4] if len(short_cells) > 4 else None,
                            "outlook": cells[6] if len(cells) > 6 else None,
                            "short_term_outlook": (
                                short_cells[5] if len(short_cells) > 5 else None
                            ),
                            "sector": cells[10] if len(cells) > 10 else None,
                            "source_url": page.url,
                            "report_url": report_url,
                            "notes": _jcr_notes(cells),
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
            long_term = clean_rating(row.get("long_term_rating"))
            short_term = clean_rating(row.get("short_term_rating"))
            if not long_term and not short_term:
                continue
            outlook = str(row.get("outlook") or "").strip() or None
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
                    long_term_rating_raw=long_term,
                    short_term_rating_raw=short_term,
                    outlook_raw=outlook,
                    outlook_normalized=normalize_outlook(outlook),
                    rating_scale="National",
                    country_or_national_scale="TR",
                    notes=row.get("notes"),
                    extraction_confidence=0.85,
                )
            )
        return records


def _report_url(page_url: str, row: Any) -> str | None:
    for anchor in row.find_all("a", href=True):
        href = str(anchor["href"]).strip()
        if "documentId=" in href:
            return urljoin(page_url, href)
    return None


def _first_date(cells: list[str]) -> str | None:
    for cell in cells:
        match = DATE_RE.search(cell)
        if match:
            return match.group(0)
    return None


def _jcr_notes(cells: list[str]) -> str | None:
    if len(cells) < 5:
        return None
    return (
        f"Uluslararasi yabanci para: {cells[2]}; "
        f"uluslararasi yerel para: {cells[3]}; "
        f"uluslararasi gorunum: {cells[4]}"
    )
