from __future__ import annotations

import json
from datetime import UTC, datetime


def test_empty_data_dir_gets_default_config(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    monkeypatch.setenv("RATING_MCP_DATA_DIR", str(data_dir))

    from app.config import get_settings, load_sources_config
    from app.normalizer import alias_map

    get_settings.cache_clear()
    alias_map.cache_clear()

    settings = get_settings()
    sources = load_sources_config(settings)

    assert (data_dir / "config" / "sources.yaml").exists()
    assert (data_dir / "config" / "companies.yaml").exists()
    assert "turkrating" in sources["rating_sources"]
    assert "aa" in sources["news_sources"]


def test_source_report_count_includes_source_url(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    monkeypatch.setenv("RATING_MCP_DATA_DIR", str(data_dir))

    from app.config import get_settings
    from app.normalizer import alias_map
    from app.services.ratings import list_available_sources

    get_settings.cache_clear()
    alias_map.cache_clear()

    settings = get_settings()
    settings.ratings_path.write_text(
        json.dumps(
            {
                "id": "rating_source_url_only",
                "company_name_raw": "Demo A.S.",
                "company_name_normalized": "Demo",
                "company_aliases": [],
                "source_agency": "KobiRate",
                "source_url": "https://www.kobirate.com.tr/detail",
                "long_term_rating_raw": "KR AA",
                "short_term_rating_raw": "KR-1",
                "extracted_at": datetime.now(UTC).isoformat(),
            },
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )

    sources = list_available_sources()["data"]
    kobirate = next(source for source in sources if source["key"] == "kobirate")

    assert kobirate["record_count"] == 1
    assert kobirate["report_count"] == 1
