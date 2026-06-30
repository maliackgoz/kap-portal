from __future__ import annotations

from typing import Any

from fastmcp import FastMCP

from .services.news import get_recent_company_news as service_get_recent_company_news
from .services.ratings import (
    compare_company_sources as service_compare_company_sources,
)
from .services.ratings import (
    generate_rating_brief as service_generate_rating_brief,
)
from .services.ratings import (
    get_company_ratings as service_get_company_ratings,
)
from .services.ratings import (
    get_rating_history as service_get_rating_history,
)
from .services.ratings import (
    get_sector_ratings as service_get_sector_ratings,
)
from .services.ratings import (
    list_available_sources as service_list_available_sources,
)
from .services.ratings import (
    list_known_companies as service_list_known_companies,
)
from .services.ratings import (
    refresh_sources,
)
from .services.reports import search_rating_documents as service_search_rating_documents

mcp = FastMCP(
    name="Rating MCP",
    instructions=(
        "Turkish credit rating data tools. Return structured JSON and Turkish summaries "
        "with source links, rating dates, freshness caveats, and source refresh errors. "
        "Never infer bankruptcy, inactivity, sector exit, or name change from an old "
        "rating date unless an explicit source says so; describe old ratings as "
        "historical records only."
    ),
)


@mcp.tool
def refresh_rating_sources(sources: list[str] | None = None, force: bool = False) -> dict[str, Any]:
    """Refresh selected rating/news sources and return a run summary."""

    return refresh_sources(sources=sources, force=force)


@mcp.tool
def get_sector_ratings(
    sector: str,
    agency: str | None = None,
    latest_only: bool = True,
) -> dict[str, Any]:
    """Return a rating table for a sector such as Varlık Yönetim."""

    return service_get_sector_ratings(sector=sector, agency=agency, latest_only=latest_only)


@mcp.tool
def get_company_ratings(
    company_name: str,
    agency: str | None = None,
    include_history: bool = True,
) -> dict[str, Any]:
    """Return all matching ratings for a company."""

    return service_get_company_ratings(
        company_name=company_name,
        agency=agency,
        include_history=include_history,
    )


@mcp.tool
def compare_company_rating_sources(company_name: str) -> dict[str, Any]:
    """Return the latest rating per agency for the same company."""

    return service_compare_company_sources(company_name)


@mcp.tool
def get_rating_history(company_name: str, agency: str | None = None) -> dict[str, Any]:
    """Return a chronological company rating history."""

    return service_get_rating_history(company_name=company_name, agency=agency)


@mcp.tool
def get_recent_company_news(
    company_name: str,
    days: int = 30,
    risk_level: str | None = None,
) -> dict[str, Any]:
    """Return recent company news with keyword risk classification."""

    return service_get_recent_company_news(
        company_name=company_name, days=days, risk_level=risk_level
    )


@mcp.tool
def search_rating_documents(
    query: str,
    company_name: str | None = None,
    agency: str | None = None,
) -> dict[str, Any]:
    """Search ratings, news, raw HTML, extracted text, and PDF text."""

    return service_search_rating_documents(query=query, company_name=company_name, agency=agency)


@mcp.tool
def generate_rating_brief(company_or_sector: str, agency: str | None = None) -> dict[str, Any]:
    """Generate a Turkish executive summary for a company or sector."""

    return service_generate_rating_brief(company_or_sector=company_or_sector, agency=agency)


@mcp.tool
def list_available_sources() -> dict[str, Any]:
    """Return configured sources and last refresh status."""

    return service_list_available_sources()


@mcp.tool
def list_known_companies(query: str | None = None) -> dict[str, Any]:
    """Return normalized company names and aliases."""

    return service_list_known_companies(query=query)
