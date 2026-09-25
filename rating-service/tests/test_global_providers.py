from __future__ import annotations

from app.scrapers.global_providers import (
    FitchRatingsProvider,
    MoodysRatingsProvider,
    SPGlobalRatingsProvider,
    fuzzy_match_company,
    generate_search_variants,
    normalize_company_name_for_search,
    parse_outlook_from_text,
    parse_rating_date_from_text,
    parse_rating_from_text,
)


def test_global_provider_company_normalization_removes_turkish_suffixes() -> None:
    name = "Aktif Yat\u0131r\u0131m Bankas\u0131 A.\u015e."

    assert normalize_company_name_for_search(name) == "AKTIF YATIRIM BANKASI"


def test_global_provider_search_variants_include_english_forms() -> None:
    variants = generate_search_variants("Aktif Yat\u0131r\u0131m Bankas\u0131 A.\u015e.")
    keys = {normalize_company_name_for_search(item) for item in variants}

    assert "AKTIF YATIRIM BANKASI" in keys
    assert "AKTIF INVESTMENT BANK" in keys
    assert "AKTIF BANK" in keys


def test_global_provider_company_matching_accepts_translated_bank_names() -> None:
    score = fuzzy_match_company(
        "Aktif Yat\u0131r\u0131m Bankas\u0131 A.\u015e.",
        "Aktif Investment Bank A.S.",
    )

    assert score >= 0.75


def test_global_provider_parser_extracts_long_short_outlook_and_date() -> None:
    text = (
        "Fitch Ratings has affirmed Aktif Bank's Long-Term Issuer Default Rating "
        "at B+ with Stable Outlook on June 1, 2026."
    )

    parsed = parse_rating_from_text(text, "Fitch Ratings")

    assert parsed["long_term_rating"] == "B+"
    assert parsed["short_term_rating"] is None
    assert parse_outlook_from_text(text) == "Stable"
    assert parse_rating_date_from_text(text) == "2026-06-01"


def test_global_provider_parser_does_not_treat_short_term_as_long_term() -> None:
    text = "S&P Global Ratings assigned its 'A-1' short-term rating and 'BBB-' long-term rating."

    parsed = parse_rating_from_text(text, "S&P Global Ratings")

    assert parsed["long_term_rating"] == "BBB-"
    assert parsed["short_term_rating"] == "A-1"


def test_global_provider_extracts_official_html_candidates() -> None:
    html = """
    <html>
      <body>
        <div>
          <a href="/entity/aktif-bank/ratings">Aktif Investment Bank</a>
          Fitch Ratings affirmed the Long-Term IDR at B+ with Stable Outlook.
        </div>
        <a href="https://example.com/nope">External</a>
      </body>
    </html>
    """
    provider = FitchRatingsProvider(urls=[])

    candidates = provider._extract_candidates("https://www.fitchratings.com/search?q=Aktif", html)

    assert len(candidates) == 1
    assert candidates[0]["url"] == "https://www.fitchratings.com/entity/aktif-bank/ratings"
    assert "Aktif Investment Bank" in candidates[0]["title"]


def test_global_provider_filters_generic_spglobal_navigation_links() -> None:
    html = """
    <html>
      <body>
        <a href="https://www.spglobal.com/en">S&P Global</a>
        <a href="https://www.spglobal.com/ratings/ar">Arabic</a>
        <a href="https://www.spglobal.com/ratings/en/contact-us">Contact Us</a>
        <a href="/ratings/en/research/articles/260101-aktif-investment-bank-rating-action">
          Aktif Investment Bank Rating Action
        </a>
      </body>
    </html>
    """
    provider = SPGlobalRatingsProvider(urls=[])

    candidates = provider._extract_candidates(
        "https://www.spglobal.com/ratings/en/search?q=Aktif",
        html,
    )

    assert len(candidates) == 1
    assert candidates[0]["url"].endswith(
        "/ratings/en/research/articles/260101-aktif-investment-bank-rating-action"
    )


def test_global_provider_cloudflare_block_message_is_explicit() -> None:
    provider = MoodysRatingsProvider(urls=[])

    message = provider._access_error_message(
        "BLOCKED",
        403,
        "<html><title>Attention Required! | Cloudflare</title></html>",
        "public search",
    )

    assert "Cloudflare/security page" in message


def test_global_provider_searches_priority_companies_before_alphabetical(tmp_path, monkeypatch) -> None:
    data_dir = tmp_path / "data"
    (data_dir / "config").mkdir(parents=True)
    (data_dir / "config" / "companies.yaml").write_text(
        "companies:\n- name: 1000 YATIRIMLAR HOLDİNG A.Ş.\n- name: AKBANK T.A.Ş.\n- name: A1 BAĞIMSIZ DENETİM A.Ş.\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("RATING_MCP_DATA_DIR", str(data_dir))
    monkeypatch.setenv("RATING_MCP_GLOBAL_PROVIDER_MAX_COMPANIES", "3")

    from app.config import get_settings

    get_settings.cache_clear()
    names = FitchRatingsProvider(urls=[], settings=get_settings())._known_company_names()
    get_settings.cache_clear()

    # Oncelik listesi basta, kota dolunca alfabetik kalanlar hic aranmaz, tekrar yok
    assert names[0] == "AKBANK T.A.Ş."
    assert names[:3] == ["AKBANK T.A.Ş.", "TÜRKİYE GARANTİ BANKASI A.Ş.", "TÜRKİYE İŞ BANKASI A.Ş."]
    assert "1000 YATIRIMLAR HOLDİNG A.Ş." not in names
