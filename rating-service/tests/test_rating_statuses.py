from __future__ import annotations

from app.models import RatingRecord
from app.services.ratings import get_company_ratings, list_available_sources
from app.storage import upsert_jsonl


def test_global_rating_status_counts_are_reported(tmp_path, monkeypatch) -> None:
    data_dir = tmp_path / "data"
    monkeypatch.setenv("RATING_MCP_DATA_DIR", str(data_dir))

    from app.config import get_settings
    from app.normalizer import alias_map

    get_settings.cache_clear()
    alias_map.cache_clear()
    settings = get_settings()

    upsert_jsonl(
        settings.ratings_path,
        [
            RatingRecord(
                id="spglobal-no-match",
                company_name_raw="Q Faktoring",
                company_name_normalized="Q Faktoring",
                source_agency="S&P Global Ratings",
                source_url="https://www.spglobal.com/ratings/en/search?q=Q+Faktoring",
                provider_status="NO_MATCH",
                error_message="NO_MATCH: public search exposed no candidate URL.",
                match_confidence=0,
            ),
            RatingRecord(
                id="moodys-blocked",
                company_name_raw="Q Faktoring",
                company_name_normalized="Q Faktoring",
                source_agency="Moody's Ratings",
                source_url="https://ratings.moodys.com/search?keyword=Q+Faktoring",
                provider_status="BLOCKED",
                error_message="BLOCKED: public search returned HTTP 403; Cloudflare/security page.",
                match_confidence=0,
            ),
        ],
    )

    sources = list_available_sources()["data"]
    spglobal = next(source for source in sources if source["key"] == "spglobal")
    moodys = next(source for source in sources if source["key"] == "moodys")

    assert spglobal["status_counts"] == {"NO_MATCH": 1}
    assert spglobal["searched_count"] == 1
    assert spglobal["no_match_count"] == 1
    assert spglobal["blocked_count"] == 0
    assert spglobal["status_class"] == "empty"

    assert moodys["status_counts"] == {"BLOCKED": 1}
    assert moodys["searched_count"] == 1
    assert moodys["blocked_count"] == 1
    assert moodys["status_class"] == "error"


def test_company_ratings_include_global_failure_reason_and_manual_link(
    tmp_path,
    monkeypatch,
) -> None:
    data_dir = tmp_path / "data"
    monkeypatch.setenv("RATING_MCP_DATA_DIR", str(data_dir))

    from app.config import get_settings
    from app.normalizer import alias_map

    get_settings.cache_clear()
    alias_map.cache_clear()
    settings = get_settings()

    upsert_jsonl(
        settings.ratings_path,
        [
            RatingRecord(
                id="fitch-no-match",
                company_name_raw="Q Faktoring",
                company_name_normalized="Q Faktoring",
                source_agency="Fitch Ratings",
                source_url="https://www.fitchratings.com/search?q=Q+Faktoring",
                provider_status="NO_MATCH",
                error_message=(
                    "NO_MATCH: public search loaded but exposed no company/rating "
                    "candidate URL in server HTML; open source_url for manual control."
                ),
                match_confidence=0,
            )
        ],
    )

    result = get_company_ratings("Q Faktoring", agency="Fitch Ratings")

    assert result["missing"] is False
    assert result["data"] == [
        {
            "company": "Q Faktoring",
            "agency": "Fitch Ratings",
            "rating_date": None,
            "long_term_rating": None,
            "short_term_rating": None,
            "national_rating": None,
            "outlook": None,
            "sector": None,
            "action": None,
            "source_url": "https://www.fitchratings.com/search?q=Q+Faktoring",
            "report_url": None,
            "pdf_url": None,
            "matched_name": None,
            "provider_status": "NO_MATCH",
            "confidence": 0.0,
            "error_message": (
                "NO_MATCH: public search loaded but exposed no company/rating "
                "candidate URL in server HTML; open source_url for manual control."
            ),
            "fetched_at": None,
            "extracted_at": result["data"][0]["extracted_at"],
            "rating_age_days": None,
            "rating_is_old": False,
            "freshness_note": None,
        }
    ]
