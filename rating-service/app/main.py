from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request, status
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from .config import get_settings
from .mcp_server import mcp
from .models import RefreshRequest
from .services.news import filter_news, load_news_records, news_rows, search_live_news
from .services.ratings import (
    export_latest_csv,
    export_latest_markdown,
    filter_ratings,
    get_company_ratings,
    get_sector_ratings,
    list_available_sources,
    load_rating_records,
    load_run_logs,
    refresh_sources,
    table_rows,
)
from .services.reports import search_rating_documents

settings = get_settings()
mcp_app = mcp.http_app(path="/")
app = FastAPI(
    title="Rating MCP Server",
    description="DB-free Turkish rating cache with REST UI and HTTP MCP tools.",
    version="0.1.0",
    lifespan=mcp_app.lifespan,
)

templates = Jinja2Templates(directory=str(Path(__file__).parent / "ui" / "templates"))
static_dir = Path(__file__).parent / "ui" / "static"
static_dir.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")


@app.middleware("http")
async def optional_api_key_auth(request: Request, call_next):
    api_key = settings.api_key
    if not api_key:
        return await call_next(request)

    public_paths = {"/health"}
    if request.url.path in public_paths:
        return await call_next(request)

    auth = request.headers.get("authorization", "")
    expected = f"Bearer {api_key}"
    if auth != expected:
        return JSONResponse(
            {"detail": "Missing or invalid Authorization bearer token."},
            status_code=status.HTTP_401_UNAUTHORIZED,
        )
    return await call_next(request)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/", response_class=HTMLResponse)
def dashboard(request: Request) -> HTMLResponse:
    ratings = table_rows(filter_ratings(latest_only=True))[:100]
    news = news_rows(filter_news(days=30))[:50]
    run_logs = load_run_logs(limit=30)
    sources = [source for source in list_available_sources()["data"] if source["enabled"]]
    visible_logs = _dashboard_run_logs(
        run_logs,
        visible_source_keys={source["key"] for source in sources},
    )
    last_refresh = next((log.finished_at for log in run_logs if log.finished_at), None)
    stats = {
        "rating_total": len(load_rating_records()),
        "news_total": len(load_news_records()),
        "last_refresh": last_refresh.isoformat() if last_refresh else "Yok",
        "mcp_url": f"{str(request.base_url).rstrip('/')}/mcp/",
    }
    return templates.TemplateResponse(
        request,
        "dashboard.html",
        {
            "ratings": ratings,
            "news": news,
            "run_logs": visible_logs,
            "sources": sources,
            "stats": stats,
            "api_key_enabled": bool(settings.api_key),
        },
    )


@app.post("/api/refresh")
def api_refresh(payload: RefreshRequest) -> dict:
    return refresh_sources(sources=payload.sources, force=payload.force)


@app.post("/api/refresh/fitch")
def api_refresh_fitch() -> dict:
    return refresh_sources(sources=["fitch"], force=True)


@app.post("/api/refresh/spglobal")
def api_refresh_spglobal() -> dict:
    return refresh_sources(sources=["spglobal"], force=True)


@app.post("/api/refresh/moodys")
def api_refresh_moodys() -> dict:
    return refresh_sources(sources=["moodys"], force=True)


@app.get("/api/ratings")
def api_ratings(
    company: str | None = None,
    sector: str | None = None,
    agency: str | None = None,
    latest_only: bool = False,
    outlook: str | None = None,
    min_date: date | None = None,
    max_date: date | None = None,
) -> dict:
    records = filter_ratings(
        company=company,
        sector=sector,
        agency=agency,
        latest_only=latest_only,
        outlook=outlook,
        min_date=min_date,
        max_date=max_date,
    )
    return {"summary": f"{len(records)} rating kaydı döndü.", "data": table_rows(records)}


@app.get("/api/ratings/company/{company_name}")
def api_company_ratings(
    company_name: str,
    agency: str | None = None,
    include_history: bool = True,
) -> dict:
    return get_company_ratings(
        company_name=company_name, agency=agency, include_history=include_history
    )


@app.get("/api/ratings/sector/{sector_name}")
def api_sector_ratings(
    sector_name: str,
    agency: str | None = None,
    latest_only: bool = True,
) -> dict:
    return get_sector_ratings(sector=sector_name, agency=agency, latest_only=latest_only)


@app.get("/api/news")
def api_news(
    company: str | None = None,
    source: str | None = None,
    days: int | None = Query(default=None, ge=1, le=3650),
    risk_level: str | None = None,
) -> dict:
    records = filter_news(company=company, source=source, days=days, risk_level=risk_level)
    return {"summary": f"{len(records)} haber kaydı döndü.", "data": news_rows(records)}


@app.get("/api/news/search")
def api_news_search(
    q: str,
    sources: list[str] | None = Query(default=None),
    limit: int = Query(default=80, ge=1, le=200),
) -> dict:
    return search_live_news(query=q, sources=sources, limit=limit)


@app.get("/api/sources")
def api_sources() -> dict:
    return list_available_sources()


@app.get("/api/search")
def api_search(
    q: str,
    company: str | None = None,
    agency: str | None = None,
) -> dict:
    return search_rating_documents(query=q, company_name=company, agency=agency)


@app.get("/api/export/latest.csv")
def api_export_latest_csv() -> FileResponse:
    path = export_latest_csv()
    return FileResponse(path, media_type="text/csv", filename="latest.csv")


@app.get("/api/export/latest.md")
def api_export_latest_markdown() -> FileResponse:
    path = export_latest_markdown()
    return FileResponse(path, media_type="text/markdown", filename="latest.md")


@app.get("/api/run-log")
def api_run_log(limit: int | None = Query(default=100, ge=1, le=1000)) -> dict:
    logs = [log.model_dump(mode="json") for log in load_run_logs(limit=limit)]
    return {"summary": f"{len(logs)} run log kaydı döndü.", "data": logs}


@app.get("/favicon.ico", include_in_schema=False)
def favicon() -> RedirectResponse:
    return RedirectResponse("/static/favicon.svg")


@app.exception_handler(HTTPException)
def http_exception_handler(_: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)


app.mount("/mcp", mcp_app)


def _dashboard_run_logs(
    run_logs: list[Any],
    *,
    visible_source_keys: set[str],
) -> list[dict[str, Any]]:
    rows = []
    allowed = visible_source_keys | {"news"}
    for log in run_logs:
        if log.source not in allowed:
            continue
        rows.append(
            {
                "source": log.source,
                "status": log.status,
                "records_found": log.records_found,
                "records_added": log.records_added,
                "records_updated": log.records_updated,
                "finished_at": log.finished_at.isoformat() if log.finished_at else "",
                "error_summary": _short_error(log.errors),
                "status_class": log.status,
            }
        )
        if len(rows) >= 12:
            break
    return rows


def _short_error(errors: list[str]) -> str:
    if not errors:
        return ""
    text = "; ".join(errors)
    ssl_eof = (
        "ConnectError: [SSL: UNEXPECTED_EOF_WHILE_READING] EOF occurred "
        "in violation of protocol (_ssl.c:1016)"
    )
    replacements = {
        "HTTPStatusError: Server error '502 Bad Gateway'": "502 Bad Gateway",
        ssl_eof: "SSL bağlantı hatası",
        "Public URL or manual import file bulunamadı.": "Manuel import bekliyor",
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    if len(text) > 180:
        return text[:177].rstrip() + "..."
    return text
