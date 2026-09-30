from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


def utc_now() -> datetime:
    return datetime.now(UTC)


class RatingRecord(BaseModel):
    id: str = ""
    company_name_raw: str
    company_name_normalized: str
    company_aliases: list[str] = Field(default_factory=list)
    source_agency: str
    source_url: str
    matched_name: str | None = None
    report_url: str | None = None
    pdf_url: str | None = None
    sector_raw: str | None = None
    sector_normalized: str | None = None
    rating_date: date | None = None
    publish_date: date | None = None
    valid_until: date | None = None
    long_term_rating_raw: str | None = None
    short_term_rating_raw: str | None = None
    national_rating_raw: str | None = None
    outlook_raw: str | None = None
    outlook_normalized: str | None = None
    action_type_raw: str | None = None
    action_type_normalized: str | None = None
    rating_scale: str | None = None
    country_or_national_scale: str | None = None
    notes: str | None = None
    provider_status: Literal[
        "FOUND",
        "NO_MATCH",
        "LOGIN_REQUIRED",
        "BLOCKED",
        "SUBSCRIPTION_REQUIRED",
        "PARSE_ERROR",
    ] = "FOUND"
    match_confidence: float = Field(default=0.7, ge=0, le=1)
    raw_text: str | None = None
    raw_payload: dict[str, Any] | None = None
    error_message: str | None = None
    fetched_at: datetime | None = None
    extraction_confidence: float = Field(default=0.7, ge=0, le=1)
    extracted_at: datetime = Field(default_factory=utc_now)


class NewsRecord(BaseModel):
    id: str = ""
    company_name_raw: str | None = None
    company_name_normalized: str | None = None
    source_name: str
    title: str
    url: str
    published_at: datetime | None = None
    summary: str | None = None
    extracted_at: datetime = Field(default_factory=utc_now)


class RunLog(BaseModel):
    run_id: str
    source: str
    started_at: datetime
    finished_at: datetime | None = None
    status: Literal["success", "partial", "error", "skipped"] = "success"
    records_found: int = 0
    records_added: int = 0
    records_updated: int = 0
    errors: list[str] = Field(default_factory=list)


class RefreshRequest(BaseModel):
    sources: list[str] | None = None
    force: bool = False


class RatingFilters(BaseModel):
    company: str | None = None
    sector: str | None = None
    agency: str | None = None
    latest_only: bool = False
    outlook: str | None = None
    min_date: date | None = None
    max_date: date | None = None


class MCPResult(BaseModel):
    summary: str
    data: Any
    stale: bool = False
    missing: bool = False
    source_errors: list[str] = Field(default_factory=list)
