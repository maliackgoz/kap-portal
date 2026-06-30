from __future__ import annotations

from app.models import RatingRecord
from app.services.ratings import get_sector_ratings
from app.storage import upsert_jsonl


def test_mcp_style_sector_output(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (data_dir / "config").mkdir()
    (data_dir / "ratings.jsonl").touch()
    (data_dir / "news.jsonl").touch()
    (data_dir / "run_log.jsonl").touch()
    monkeypatch.setenv("RATING_MCP_DATA_DIR", str(data_dir))

    from app.config import get_settings
    from app.normalizer import alias_map

    get_settings.cache_clear()
    alias_map.cache_clear()

    record = RatingRecord(
        company_name_raw="Gelecek Varlık Yönetim A.Ş.",
        company_name_normalized="Gelecek Varlık Yönetim",
        source_agency="TurkRating",
        source_url="https://turkrating.com/test",
        sector_raw="Varlık Yönetim",
        sector_normalized="Varlık Yönetim",
        rating_date="2025-05-12",
        long_term_rating_raw="TR A-",
        short_term_rating_raw="TR A1",
        outlook_raw="Durağan",
        outlook_normalized="Durağan",
    )
    upsert_jsonl(get_settings().ratings_path, [record.model_copy(update={"id": "r1"})])

    result = get_sector_ratings("Varlık Yönetim", "TurkRating")

    assert result["missing"] is False
    assert "summary" in result
    assert result["data"][0]["long_term_rating"] == "TR A-"


def test_sector_output_groups_company_suffix_variants(tmp_path, monkeypatch):
    sector = "Varl\u0131k Y\u00f6netim"
    company = "Hayat Varl\u0131k Y\u00f6netim"
    company_with_suffix = f"{company} \u015eirketi"
    company_legal_name = f"{company} A.\u015e."
    company_suffix_legal_name = f"{company_with_suffix} A.\u015e."
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (data_dir / "config").mkdir()
    (data_dir / "ratings.jsonl").touch()
    (data_dir / "news.jsonl").touch()
    (data_dir / "run_log.jsonl").touch()
    monkeypatch.setenv("RATING_MCP_DATA_DIR", str(data_dir))

    from app.config import get_settings
    from app.normalizer import alias_map

    get_settings.cache_clear()
    alias_map.cache_clear()

    newer = RatingRecord(
        company_name_raw=company_suffix_legal_name,
        company_name_normalized=company_with_suffix,
        source_agency="TurkRating",
        source_url="https://turkrating.com/newer",
        sector_raw=sector,
        sector_normalized=sector,
        rating_date="2020-04-20",
        long_term_rating_raw="TR AA",
        short_term_rating_raw="TR A1",
    )
    older = RatingRecord(
        company_name_raw=company_legal_name,
        company_name_normalized=company,
        source_agency="TurkRating",
        source_url="https://turkrating.com/older",
        sector_raw=sector,
        sector_normalized=sector,
        rating_date="2019-04-19",
        long_term_rating_raw="TR AA",
        short_term_rating_raw="TR A1",
    )
    upsert_jsonl(
        get_settings().ratings_path,
        [newer.model_copy(update={"id": "newer"}), older.model_copy(update={"id": "older"})],
    )

    result = get_sector_ratings(sector, "TurkRating")

    assert len(result["data"]) == 1
    assert result["data"][0]["source_url"] == "https://turkrating.com/newer"


def test_sector_output_marks_old_ratings(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (data_dir / "config").mkdir()
    (data_dir / "ratings.jsonl").touch()
    (data_dir / "news.jsonl").touch()
    (data_dir / "run_log.jsonl").touch()
    monkeypatch.setenv("RATING_MCP_DATA_DIR", str(data_dir))

    from app.config import get_settings
    from app.normalizer import alias_map

    get_settings.cache_clear()
    alias_map.cache_clear()

    record = RatingRecord(
        company_name_raw="Eski VarlÄ±k YÃ¶netim A.Å.",
        company_name_normalized="Eski VarlÄ±k YÃ¶netim",
        source_agency="TurkRating",
        source_url="https://turkrating.com/old",
        sector_raw="VarlÄ±k YÃ¶netim",
        sector_normalized="VarlÄ±k YÃ¶netim",
        rating_date="2018-01-01",
        long_term_rating_raw="TR A",
    )
    upsert_jsonl(get_settings().ratings_path, [record.model_copy(update={"id": "old"})])

    result = get_sector_ratings("VarlÄ±k YÃ¶netim", "TurkRating")

    assert result["old_rating_count"] == 1
    assert result["freshness_caveats"]
    assert result["data"][0]["rating_is_old"] is True
    assert result["data"][0]["freshness_note"]
