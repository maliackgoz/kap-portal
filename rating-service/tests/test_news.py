from __future__ import annotations

from datetime import UTC, datetime

from app.models import NewsRecord
from app.scrapers.news import _looks_like_news_link, parse_datetime
from app.services.news import (
    _build_live_search_config,
    _news_record_matches_query,
    _select_news_sources,
)


def test_bloomberght_numeric_slug_is_treated_as_news_link() -> None:
    assert _looks_like_news_link(
        "ING: Turk Lirasi EMler arasinda populer kalmaya devam edecek",
        "/ing-turk-lirasi-emler-arasinda-populer-kalmaya-devam-edecek-3779531",
    )


def test_economy_section_link_is_treated_as_news_link() -> None:
    assert _looks_like_news_link(
        "Piyasalarda gun ortasi ekonomi haberleri ve son durum",
        "/ekonomi/piyasalarda-gun-ortasi",
    )


def test_yenisafak_gmt_feed_date_keeps_turkey_clock_time() -> None:
    parsed = parse_datetime(
        "Tue, 16 Jun 2026 20:41:14 GMT",
        source_name="Yeni Şafak",
    )

    assert parsed is not None
    assert parsed.isoformat() == "2026-06-16T20:41:14+03:00"


def test_other_gmt_feed_date_keeps_utc_timezone() -> None:
    parsed = parse_datetime(
        "Tue, 16 Jun 2026 20:41:14 GMT",
        source_name="Anadolu Ajansı",
    )

    assert parsed is not None
    assert parsed.isoformat() == "2026-06-16T20:41:14+00:00"


def test_live_news_source_selection_accepts_key_name_and_comma_values() -> None:
    sources = {
        "aa": {"name": "Anadolu Ajansı", "enabled": True},
        "bloomberg": {"name": "BloombergHT", "enabled": True},
        "disabled": {"name": "Kapali", "enabled": False},
    }

    selected = _select_news_sources(sources, ["aa,BloombergHT,Kapali"])

    assert set(selected) == {"aa", "bloomberg"}


def test_live_news_search_config_adds_encoded_search_pages() -> None:
    config = {
        "aa": {
            "name": "Anadolu Ajansı",
            "enabled": True,
            "search_urls": ["https://example.com/arama?q={q}"],
            "rss": ["https://example.com/rss.xml"],
            "pages": ["https://example.com/ekonomi"],
        }
    }

    search_config = _build_live_search_config(config, "uçak düştü")

    assert (
        search_config["aa"]["pages"][0]
        == "https://example.com/arama?q=u%C3%A7ak+d%C3%BC%C5%9Ft%C3%BC"
    )
    assert search_config["aa"]["pages"][1] == "https://example.com/ekonomi"
    assert search_config["aa"]["rss"] == ["https://example.com/rss.xml"]


def test_live_news_query_matching_is_turkish_character_tolerant() -> None:
    record = NewsRecord(
        source_name="A Haber",
        title="Uçak düştü iddiası sonrası havalimanında açıklama",
        url="https://example.com/haber",
        summary="Son dakika gelişmesi",
        published_at=datetime(2026, 6, 16, 20, 41, tzinfo=UTC),
    )

    assert _news_record_matches_query(record, "ucak dustu")
